const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  const {
    skuId,
    quantity,
    reason,
    remark
  } = event;

  if (!skuId) {
    return {
      success: false,
      message: "缺少库存ID"
    };
  }

  const outQuantity = Number(quantity);

  if (!Number.isInteger(outQuantity) || outQuantity <= 0) {
    return {
      success: false,
      message: "出库数量必须是正整数"
    };
  }

  if (outQuantity > 200) {
    return {
      success: false,
      message: "单次出库数量不能超过200"
    };
  }

  const cleanReason = String(reason || "领取").trim();
  const cleanRemark = String(remark || "").trim();

  if (cleanReason === "其他" && !cleanRemark) {
    return {
      success: false,
      message: "选择其他原因时必须填写备注"
    };
  }

  if (cleanReason.length > 30 || cleanRemark.length > 200) {
    return {
      success: false,
      message: "原因或备注内容过长"
    };
  }

  try {
    // 1. 查询当前用户
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
        message: "账号未开通，不能操作出库"
      };
    }

    const user = userRes.data[0];

    const result = await db.runTransaction(async transaction => {
      // 2. 查询库存记录
      const skuRes = await transaction.collection("item_skus")
        .doc(skuId)
        .get();

      const sku = skuRes.data;

      if (!sku) {
        return {
          success: false,
          message: "库存记录不存在"
        };
      }

      if (sku.status !== "active") {
        return {
          success: false,
          message: "物品已停用或已删除，不能出库"
        };
      }

      const beforeStock = Number(sku.stock || 0);

      if (beforeStock < outQuantity) {
        return {
          success: false,
          message: "库存不足，当前库存只有 " + sku.stock + sku.unit
        };
      }

      const afterStock = beforeStock - outQuantity;

      // 3. 扣减库存并写入出库记录，保持库存和流水一致
      const updateRes = await transaction.collection("item_skus")
        .where({
          _id: skuId,
          stock: _.gte(outQuantity)
        })
        .update({
          data: {
            stock: _.inc(-outQuantity),
            updatedAt: db.serverDate()
          }
        });

      if (!updateRes.stats || updateRes.stats.updated === 0) {
        return {
          success: false,
          message: "库存不足或库存已被其他人修改，请刷新后重试"
        };
      }

      await transaction.collection("stock_records").add({
        data: {
          type: "out",
          skuId,
          itemName: sku.itemName,
          category: sku.category,
          size: sku.size,
          quantity: outQuantity,
          unit: sku.unit,
          beforeStock,
          afterStock,

          operatorId: user._id,
          operatorOpenid: openid,
          operatorName: user.name,
          operatorRole: user.role,

          reason: cleanReason,
          remark: cleanRemark,
          createdAt: db.serverDate()
        }
      });

      return {
        success: true,
        message: "出库成功",
        data: {
          itemName: sku.itemName,
          size: sku.size,
          quantity: outQuantity,
          unit: sku.unit,
          beforeStock,
          afterStock
        }
      };
    });

    return result;

  } catch (err) {
    console.error("出库失败：", err);

    return {
      success: false,
      message: "出库失败",
    };
  }
};
