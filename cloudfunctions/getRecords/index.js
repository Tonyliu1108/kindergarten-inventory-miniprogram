const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;

function trimText(value) {
  return String(value || "").trim();
}

// 获取中国时区今天的开始和结束时间
function getChinaTodayRange() {
  const now = new Date();

  const utcTime = now.getTime() + now.getTimezoneOffset() * 60000;
  const chinaNow = new Date(utcTime + 8 * 60 * 60 * 1000);

  const y = chinaNow.getFullYear();
  const m = chinaNow.getMonth();
  const d = chinaNow.getDate();

  const start = new Date(Date.UTC(y, m, d, -8, 0, 0));
  const end = new Date(Date.UTC(y, m, d + 1, -8, 0, 0));

  return {
    start: start,
    end: end
  };
}

function parseDateOnlyToChinaStart(value) {
  const text = trimText(value);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return null;
  }

  const parts = text.split("-");
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  const date = new Date(Date.UTC(year, month - 1, day, -8, 0, 0));

  if (isNaN(date.getTime())) {
    return null;
  }

  return date;
}

// 根据筛选类型生成时间范围
function getDateRange(dateType, startDate, endDate) {
  if (!dateType || dateType === "all") {
    return null;
  }

  const todayRange = getChinaTodayRange();

  if (dateType === "today") {
    return todayRange;
  }

  if (dateType === "7days") {
    return {
      start: new Date(todayRange.start.getTime() - 6 * 24 * 60 * 60 * 1000),
      end: todayRange.end
    };
  }

  if (dateType === "30days") {
    return {
      start: new Date(todayRange.start.getTime() - 29 * 24 * 60 * 60 * 1000),
      end: todayRange.end
    };
  }

  if (dateType === "custom") {
    const start = parseDateOnlyToChinaStart(startDate);
    const endStart = parseDateOnlyToChinaStart(endDate);

    if (!start || !endStart) {
      return {
        error: "请选择有效的开始和结束日期"
      };
    }

    if (start.getTime() > todayRange.start.getTime()) {
      return {
        error: "开始日期不能超过今天"
      };
    }

    if (endStart.getTime() > todayRange.start.getTime()) {
      return {
        error: "结束日期不能超过今天"
      };
    }

    if (start.getTime() > endStart.getTime()) {
      return {
        error: "开始日期不能晚于结束日期"
      };
    }

    return {
      start: start,
      end: new Date(endStart.getTime() + 24 * 60 * 60 * 1000)
    };
  }

  return null;
}

function normalizeRecordType(item) {
  const type = item && item.type ? String(item.type) : "";
  const reason = item && item.reason ? String(item.reason) : "";
  const beforeStock = Number(item && item.beforeStock);
  const afterStock = Number(item && item.afterStock);
  const quantity = Number(item && item.quantity);

  if (["add", "create", "new", "addSku"].includes(type)) {
    return "add";
  }

  if (reason === "新增物品") {
    return "add";
  }

  if (beforeStock === 0 && afterStock > 0 && afterStock === quantity) {
    return "add";
  }

  return type;
}

function normalizeLimit(value) {
  const limit = Number(value);

  if (!Number.isInteger(limit) || limit <= 0) {
    return DEFAULT_LIMIT;
  }

  return Math.min(limit, MAX_LIMIT);
}

function pickUser(user) {
  return {
    _id: user._id,
    name: user.name || "",
    role: user.role || "teacher",
    status: user.status || "active"
  };
}

function pickRecord(record, isAdmin) {
  const safeRecord = {
    _id: record._id,
    type: record.type || "",
    skuId: record.skuId || record.itemSkuId || "",
    itemSkuId: record.itemSkuId || record.skuId || "",
    oldSkuId: record.oldSkuId || "",
    newSkuId: record.newSkuId || "",
    itemName: record.itemName || "",
    category: record.category || "",
    size: record.size || "",
    oldSize: record.oldSize || "",
    newSize: record.newSize || "",
    quantity: record.quantity || 0,
    unit: record.unit || "",
    beforeStock: record.beforeStock,
    afterStock: record.afterStock,
    oldBeforeStock: record.oldBeforeStock,
    oldAfterStock: record.oldAfterStock,
    newBeforeStock: record.newBeforeStock,
    newAfterStock: record.newAfterStock,
    adjustQuantity: record.adjustQuantity,
    reason: record.reason || "",
    remark: record.remark || "",
    operatorName: record.operatorName || "",
    operatorRole: record.operatorRole || "",
    createdAt: record.createdAt || ""
  };

  if (isAdmin) {
    safeRecord.operatorId = record.operatorId || "";
  }

  return safeRecord;
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  const type = trimText(event && event.type);
  const dateType = trimText(event && event.dateType) || "all";
  const startDate = trimText(event && event.startDate);
  const endDate = trimText(event && event.endDate);
  const limit = normalizeLimit(event && event.limit);

  try {
    // 1. 查询当前用户
    const userRes = await db.collection("users")
      .where({
        openid: openid,
        status: "active"
      })
      .limit(1)
      .get();

    if (!userRes.data || userRes.data.length === 0) {
      return {
        success: false,
        message: "账号未开通"
      };
    }

    const user = userRes.data[0];
    const isAdmin = user.role === "admin";

    // 2. 拼接查询条件
    const where = {};

    // 类型筛选：in / out / exchange / adjust；入库筛选同时包含新增物品
    if (type && type !== "in") {
      where.type = type;
    }

    // 普通老师只能看自己的记录
    if (!isAdmin) {
      where.operatorOpenid = openid;
    }

    // 日期筛选
    const range = getDateRange(dateType, startDate, endDate);

    if (range && range.error) {
      return {
        success: false,
        message: range.error
      };
    }

    if (range) {
      where.createdAt = _.gte(range.start).and(_.lt(range.end));
    }

    // 3. 查询记录
    const recordRes = await db.collection("stock_records")
      .where(where)
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();

    let records = recordRes.data || [];

    for (let i = 0; i < records.length; i++) {
      const normalizedType = normalizeRecordType(records[i]);
      if (normalizedType) {
        records[i].type = normalizedType;
      }
    }

    if (type === "in") {
      records = records.filter(item => item.type === "in" || item.type === "add");
    }

    return {
      success: true,
      user: pickUser(user),
      records: records.map(item => pickRecord(item, isAdmin))
    };

  } catch (err) {
    console.error("获取出入库记录失败：", err);

    return {
      success: false,
      message: "获取记录失败",
    };
  }
};
