const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  const { skuId, status } = event || {};

  if (!skuId) {
    return {
      success: false,
      message: "缺少物品ID"
    };
  }

  if (!["active", "disabled"].includes(status)) {
    return {
      success: false,
      message: "状态不合法"
    };
  }

  try {
    const userRes = await db.collection("users")
      .where({
        openid,
        status: "active"
      })
      .limit(1)
      .get();

    if (userRes.data.length === 0) {
      return {
        success: false,
        message: "账号未开通"
      };
    }

    const user = userRes.data[0];

    if (user.role !== "admin") {
      return {
        success: false,
        message: "只有管理员可以修改物品状态"
      };
    }

    const skuRes = await db.collection("item_skus")
      .where({
        _id: skuId
      })
      .limit(1)
      .get();

    const sku = skuRes.data && skuRes.data[0];

    if (!sku) {
      return {
        success: false,
        message: "物品不存在"
      };
    }

    if (sku.status === "deleted") {
      return {
        success: false,
        message: "已删除物品不能重新启用或停用"
      };
    }

    await db.collection("item_skus")
      .doc(skuId)
      .update({
        data: {
          status,
          updatedAt: db.serverDate()
        }
      });

    return {
      success: true,
      message: status === "active" ? "已启用物品" : "已停用物品"
    };

  } catch (err) {
    console.error("修改物品状态失败：", err);

    return {
      success: false,
      message: "修改物品状态失败",
    };
  }
};
