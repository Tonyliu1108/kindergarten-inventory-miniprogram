const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

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

// 生成记录查询条件
function buildRecordWhere(type, openid, isAdmin, range) {
  const where = {
    createdAt: _.gte(range.start).and(_.lt(range.end))
  };

  if (Array.isArray(type)) {
    where.type = _.in(type);
  } else {
    where.type = type;
  }

  if (!isAdmin) {
    where.operatorOpenid = openid;
  }

  return where;
}

function isAddRecord(item) {
  const type = item && item.type ? String(item.type) : "";
  const reason = item && item.reason ? String(item.reason) : "";
  const beforeStock = Number(item && item.beforeStock);
  const afterStock = Number(item && item.afterStock);
  const quantity = Number(item && item.quantity);

  if (["add", "create", "new", "addSku"].includes(type)) {
    return true;
  }

  if (reason === "新增物品") {
    return true;
  }

  return beforeStock === 0 && afterStock > 0 && afterStock === quantity;
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

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

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
      const rejectedApplication = await getLatestRejectedApplication(openid);

      return {
        success: false,
        needRegister: true,
        openid: openid,
        rejectedApplication: rejectedApplication,
        message: "账号未开通"
      };
    }

    const currentUser = userRes.data[0];
    const isAdmin = currentUser.role === "admin";
    const range = getChinaTodayRange();

    const todayInCountPromise = db.collection("stock_records")
      .where(buildRecordWhere(["in", "add", "create", "new", "addSku"], openid, isAdmin, range))
      .count();

    const todayOutCountPromise = db.collection("stock_records")
      .where(buildRecordWhere("out", openid, isAdmin, range))
      .count();

    const todayExchangeCountPromise = db.collection("stock_records")
      .where(buildRecordWhere("exchange", openid, isAdmin, range))
      .count();

    const activeItemCountPromise = db.collection("item_skus")
      .where({
        status: "active"
      })
      .count();

    const skuWarningPromise = db.collection("item_skus")
      .where({
        status: "active"
      })
      .field({
        stock: true,
        safetyStock: true
      })
      .limit(1000)
      .get();

    const pendingApplicationPromise = isAdmin
      ? db.collection("user_applications")
        .where({
          status: "pending"
        })
        .count()
      : Promise.resolve({ total: 0 });

    const [
      todayInRes,
      todayOutRes,
      todayExchangeRes,
      activeItemRes,
      skuRes,
      appRes
    ] = await Promise.all([
      todayInCountPromise,
      todayOutCountPromise,
      todayExchangeCountPromise,
      activeItemCountPromise,
      skuWarningPromise,
      pendingApplicationPromise
    ]);

    let warningCount = 0;
    let dangerCount = 0;

    const skuList = skuRes.data || [];

    for (let i = 0; i < skuList.length; i++) {
      const item = skuList[i];

      const stock = Number(item.stock || 0);
      const safetyStock = Number(item.safetyStock || 0);

      if (stock === 0) {
        dangerCount++;
      } else if (stock <= safetyStock) {
        warningCount++;
      }
    }

    return {
      success: true,
      needRegister: false,
      user: currentUser,
      stats: {
        todayInCount: todayInRes.total || 0,
        todayOutCount: todayOutRes.total || 0,
        todayExchangeCount: todayExchangeRes.total || 0,
        activeItemCount: activeItemRes.total || 0,
        warningCount: warningCount,
        dangerCount: dangerCount,
        warningTotalCount: warningCount + dangerCount,
        pendingApplicationCount: appRes.total || 0
      }
    };

  } catch (err) {
    console.error("获取首页数据失败：", err);

    return {
      success: false,
      needRegister: false,
      message: "获取首页数据失败",
    };
  }
};
