const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  const skuId = String(event.skuId || "").trim();

  if (!skuId) {
    return {
      success: false,
      message: "缺少物品ID"
    };
  }

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

    if (user.role !== "admin") {
      return {
        success: false,
        message: "只有管理员可以删除物品"
      };
    }

    // 2. 查询物品
    const skuRes = await db.collection("item_skus")
      .doc(skuId)
      .get();

    const sku = skuRes.data;

    if (!sku) {
      return {
        success: false,
        message: "物品不存在"
      };
    }

    if (sku.status === "deleted") {
      return {
        success: false,
        message: "该物品已删除"
      };
    }

    const stock = Number(sku.stock || 0);

    // 3. 为了库存账安全，库存不为 0 不允许删除
    if (stock > 0) {
      return {
        success: false,
        message: "当前库存不为0，请先出库或盘点为0后再删除"
      };
    }

    // 4. 软删除
    await db.collection("item_skus")
      .doc(skuId)
      .update({
        data: {
          status: "deleted",
          deletedAt: db.serverDate(),
          deletedBy: user._id,
          deletedByName: user.name
        }
      });

    return {
      success: true,
      message: "物品已删除"
    };

  } catch (err) {
    console.error("删除物品失败：", err);

    return {
      success: false,
      message: "删除物品失败",
    };
  }
};