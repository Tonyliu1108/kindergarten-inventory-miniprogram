const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function normalizeLimit(value) {
  const limit = Number(value);

  if (!Number.isInteger(limit) || limit <= 0) {
    return DEFAULT_LIMIT;
  }

  return Math.min(limit, MAX_LIMIT);
}

function normalizeSkip(value) {
  const skip = Number(value);

  if (!Number.isInteger(skip) || skip < 0) {
    return 0;
  }

  return skip;
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function pickSku(item) {
  return {
    _id: item._id,
    itemName: item.itemName || "",
    category: item.category || "",
    size: item.size || "",
    stock: toNumber(item.stock),
    safetyStock: toNumber(item.safetyStock),
    unit: item.unit || "",
    location: item.location || "",
    status: item.status || "active",
    createdAt: item.createdAt || "",
    updatedAt: item.updatedAt || ""
  };
}

function pickUser(user) {
  return {
    _id: user._id,
    name: user.name || "",
    role: user.role || "teacher",
    status: user.status || "active"
  };
}

function buildActiveWhere() {
  return {
    status: "active"
  };
}

async function getLatestRejectedApplication(openid) {
  const rejectedRes = await db.collection("user_applications")
    .where({
      openid: openid,
      status: "rejected"
    })
    .orderBy("reviewedAt", "desc")
    .limit(1)
    .get();

  if (!rejectedRes.data || rejectedRes.data.length === 0) {
    return null;
  }

  const application = rejectedRes.data[0];

  return {
    _id: application._id,
    name: application.name || "",
    rejectReason: application.rejectReason || "",
    reviewedByName: application.reviewedByName || "",
    reviewedAt: application.reviewedAt || null
  };
}

async function getCurrentUser(openid) {
  const userRes = await db.collection("users")
    .where({
      openid,
      status: "active"
    })
    .limit(1)
    .get();

  return userRes.data && userRes.data[0];
}

function deny(message) {
  return {
    success: false,
    message
  };
}

async function listSkus(where, skip, limit) {
  const res = await db.collection("item_skus")
    .where(where)
    .skip(skip)
    .limit(limit)
    .get();

  const items = (res.data || []).map(pickSku);

  return {
    items,
    hasMore: items.length === limit
  };
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const mode = String(event && event.mode || "active").trim();
  const skuId = String(event && event.skuId || "").trim();
  const skip = normalizeSkip(event && event.skip);
  const limit = normalizeLimit(event && event.limit);
  const includeUser = !!(event && event.includeUser);

  try {
    const user = await getCurrentUser(openid);

    if (!user && includeUser) {
      const rejectedApplication = await getLatestRejectedApplication(openid);

      return {
        success: false,
        needRegister: true,
        message: "账号未开通",
        rejectedApplication
      };
    }

    if (!user) {
      return deny("账号未开通");
    }

    const isAdmin = user.role === "admin";

    if (mode === "manage") {
      if (!isAdmin) {
        return deny("只有管理员可以查看物品管理列表");
      }

      const result = await listSkus({
        status: _.neq("deleted")
      }, skip, limit);

      return {
        success: true,
        items: result.items,
        hasMore: result.hasMore
      };
    }

    if (mode === "warnings") {
      if (!isAdmin) {
        return deny("只有管理员可以查看库存预警");
      }

      const result = await listSkus(buildActiveWhere(), skip, limit);
      const warningItems = result.items.filter(item => {
        return item.stock <= 0 || item.stock <= item.safetyStock;
      });

      return {
        success: true,
        items: warningItems,
        hasMore: result.hasMore
      };
    }

    if (mode === "detail") {
      if (!skuId) {
        return deny("缺少物品ID");
      }

      const res = await db.collection("item_skus")
        .where({
          _id: skuId,
          status: "active"
        })
        .limit(1)
        .get();

      const sku = res.data && res.data[0];

      if (!sku) {
        return deny("物品不存在或已停用");
      }

      return {
        success: true,
        sku: pickSku(sku)
      };
    }

    if (mode === "related") {
      if (!skuId) {
        return deny("缺少物品ID");
      }

      const oldRes = await db.collection("item_skus")
        .where({
          _id: skuId,
          status: "active"
        })
        .limit(1)
        .get();

      const oldSku = oldRes.data && oldRes.data[0];

      if (!oldSku) {
        return deny("原物品不存在或已停用");
      }

      const relatedRes = await db.collection("item_skus")
        .where({
          itemName: oldSku.itemName,
          category: oldSku.category,
          status: "active"
        })
        .limit(MAX_LIMIT)
        .get();

      const items = (relatedRes.data || [])
        .filter(item => item._id !== oldSku._id)
        .map(pickSku);

      return {
        success: true,
        sku: pickSku(oldSku),
        items
      };
    }

    const result = await listSkus(buildActiveWhere(), skip, limit);

    const response = {
      success: true,
      items: result.items,
      hasMore: result.hasMore
    };

    if (includeUser) {
      response.user = pickUser(user);
    }

    return response;
  } catch (err) {
    console.error("获取物品数据失败：", err);

    return {
      success: false,
      message: "获取物品数据失败",
    };
  }
};
