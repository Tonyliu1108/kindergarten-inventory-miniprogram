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
    oldSkuId,
    newSkuId,
    quantity,
    reason,
    remark
  } = event;

  if (!oldSkuId || !newSkuId) {
    return {
      success: false,
      message: "缺少原尺码或新尺码库存ID"
    };
  }

  if (oldSkuId === newSkuId) {
    return {
      success: false,
      message: "原尺码和新尺码不能相同"
    };
  }

  const exchangeQuantity = Number(quantity);

  if (!Number.isInteger(exchangeQuantity) || exchangeQuantity <= 0) {
    return {
      success: false,
      message: "换码数量必须是正整数"
    };
  }

  if (exchangeQuantity > 200) {
    return {
      success: false,
      message: "单次换码数量不能超过200"
    };
  }

  const cleanReason = String(reason || "尺码更换").trim();
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
        message: "账号未开通，不能操作换码"
      };
    }

    const user = userRes.data[0];

    const result = await db.runTransaction(async transaction => {
      // 2. 查询原尺码库存
      const oldSkuRes = await transaction.collection("item_skus")
        .doc(oldSkuId)
        .get();

      const oldSku = oldSkuRes.data;

      if (!oldSku) {
        return {
          success: false,
          message: "原尺码库存不存在"
        };
      }

      // 3. 查询新尺码库存
      if (oldSku.status !== "active") {
        return {
          success: false,
          message: "原尺码库存不是启用状态，不能换码"
        };
      }

      const newSkuRes = await transaction.collection("item_skus")
        .doc(newSkuId)
        .get();

      const newSku = newSkuRes.data;

      if (!newSku) {
        return {
          success: false,
          message: "新尺码库存不存在"
        };
      }

      if (newSku.status !== "active") {
        return {
          success: false,
          message: "新尺码库存不是启用状态，不能换码"
        };
      }

      if (oldSku.itemName !== newSku.itemName) {
        return {
          success: false,
          message: "只能在同一种物品之间换码"
        };
      }

      if (oldSku.category !== newSku.category) {
        return {
          success: false,
          message: "只能在同一分类的物品之间换码"
        };
      }

      const oldBeforeStock = Number(oldSku.stock || 0);
      const newBeforeStock = Number(newSku.stock || 0);

      if (newBeforeStock < exchangeQuantity) {
        return {
          success: false,
          message: "新尺码库存不足，当前只有 " + newBeforeStock + newSku.unit
        };
      }

      // 4. 同一事务内扣新尺码、加原尺码并写入换码记录
      const updateNewRes = await transaction.collection("item_skus")
        .where({
          _id: newSkuId,
          status: "active",
          stock: _.gte(exchangeQuantity)
        })
        .update({
          data: {
            stock: _.inc(-exchangeQuantity),
            updatedAt: db.serverDate()
          }
        });

      if (!updateNewRes.stats || updateNewRes.stats.updated === 0) {
        return {
          success: false,
          message: "新尺码库存不足或已被修改，请刷新后重试"
        };
      }

      const updateOldRes = await transaction.collection("item_skus")
        .where({
          _id: oldSkuId,
          status: "active"
        })
        .update({
          data: {
            stock: _.inc(exchangeQuantity),
            updatedAt: db.serverDate()
          }
        });

      if (!updateOldRes.stats || updateOldRes.stats.updated === 0) {
        const rollbackError = new Error("原尺码库存已被修改，请刷新后重试");
        rollbackError.businessResult = {
          success: false,
          message: rollbackError.message
        };
        throw rollbackError;
      }

      const oldAfterStock = oldBeforeStock + exchangeQuantity;
      const newAfterStock = newBeforeStock - exchangeQuantity;

      await transaction.collection("stock_records").add({
        data: {
          type: "exchange",

          oldSkuId,
          newSkuId,
          skuId: newSkuId,

          itemName: oldSku.itemName,
          category: oldSku.category,
          size: oldSku.size + " → " + newSku.size,
          oldSize: oldSku.size,
          newSize: newSku.size,

          quantity: exchangeQuantity,
          unit: oldSku.unit || newSku.unit,

          oldBeforeStock,
          oldAfterStock,
          newBeforeStock,
          newAfterStock,

          beforeStock: newBeforeStock,
          afterStock: newAfterStock,

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
        message: "换码成功",
        data: {
          itemName: oldSku.itemName,
          oldSize: oldSku.size,
          newSize: newSku.size,
          quantity: exchangeQuantity,
          unit: oldSku.unit || newSku.unit,
          oldBeforeStock,
          oldAfterStock,
          newBeforeStock,
          newAfterStock
        }
      };
    });

    return result;

  } catch (err) {
    console.error("换码失败：", err);

    if (err && err.businessResult) {
      return err.businessResult;
    }

    return {
      success: false,
      message: "换码失败",
    };
  }
};
