const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  const skuId = String(event.skuId || "").trim();
  const actualStock = Number(event.actualStock);
  const reason = String(event.reason || "").trim();
  const remark = String(event.remark || "").trim();

  if (!skuId) {
    return {
      success: false,
      message: "缺少物品ID"
    };
  }

  if (!Number.isInteger(actualStock) || actualStock < 0) {
    return {
      success: false,
      message: "实际库存必须是非负整数"
    };
  }

  if (actualStock > 99999) {
    return {
      success: false,
      message: "实际库存数量过大"
    };
  }

  if (!reason) {
    return {
      success: false,
      message: "请选择盘点原因"
    };
  }

  if (reason === "其他" && !remark) {
    return {
      success: false,
      message: "原因选择其他时，请填写备注"
    };
  }

  if (reason.length > 30 || remark.length > 200) {
    return {
      success: false,
      message: "原因或备注内容过长"
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

    // 2. 只有管理员可以盘点校准
    if (user.role !== "admin") {
      return {
        success: false,
        message: "只有管理员可以进行库存盘点"
      };
    }

    const result = await db.runTransaction(async transaction => {
      // 3. 查询物品
      const skuRes = await transaction.collection("item_skus")
        .doc(skuId)
        .get();

      const sku = skuRes.data;

      if (!sku) {
        return {
          success: false,
          message: "物品不存在"
        };
      }

      if (sku.status !== "active") {
        return {
          success: false,
          message: "物品已停用或已删除，不能盘点"
        };
      }

      const beforeStock = Number(sku.stock || 0);
      const afterStock = actualStock;
      const adjustQuantity = afterStock - beforeStock;

      if (adjustQuantity === 0) {
        return {
          success: true,
          noChange: true,
          message: "库存一致，无需调整"
        };
      }

      // 4. 更新库存并写入盘点记录，保持库存和流水一致
      await transaction.collection("item_skus")
        .doc(skuId)
        .update({
          data: {
            stock: afterStock,
            updatedAt: db.serverDate(),
            updatedBy: user._id,
            updatedByName: user.name
          }
        });

      await transaction.collection("stock_records").add({
        data: {
          type: "adjust",
          skuId: skuId,
          itemSkuId: skuId,

          itemName: sku.itemName || "",
          category: sku.category || "",
          size: sku.size || "",
          unit: sku.unit || "",

          quantity: Math.abs(adjustQuantity),
          adjustQuantity: adjustQuantity,

          beforeStock: beforeStock,
          afterStock: afterStock,

          reason: reason,
          remark: remark,

          operatorOpenid: openid,
          operatorName: user.name,
          operatorRole: user.role,

          createdAt: db.serverDate()
        }
      });

      return {
        success: true,
        message: "库存盘点调整成功",
        beforeStock: beforeStock,
        afterStock: afterStock,
        adjustQuantity: adjustQuantity
      };
    });

    return result;

  } catch (err) {
    console.error("库存盘点调整失败：", err);

    return {
      success: false,
      message: "库存盘点调整失败",
    };
  }
};
