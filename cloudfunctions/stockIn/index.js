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
    remark,
    receiptFileID,
    receiptFileName,
    tempReceiptId
  } = event;

  if (!skuId) {
    return {
      success: false,
      message: "缺少库存ID"
    };
  }

  const inQuantity = Number(quantity);

  if (!Number.isInteger(inQuantity) || inQuantity <= 0) {
    return {
      success: false,
      message: "入库数量必须是正整数"
    };
  }

  if (inQuantity > 200) {
    return {
      success: false,
      message: "单次入库数量不能超过200"
    };
  }

  const cleanReason = String(reason || "补货").trim();
  const cleanRemark = String(remark || "").trim();
  const cleanReceiptFileID = String(receiptFileID || "").trim();
  const cleanReceiptFileName = String(receiptFileName || "purchase_receipt.jpg").trim().slice(0, 120);
  const cleanTempReceiptId = String(tempReceiptId || "").trim();

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

  if (!cleanReceiptFileID) {
    return {
      success: false,
      message: "请先上传采购清单"
    };
  }

  if (!cleanTempReceiptId) {
    return {
      success: false,
      message: "采购清单未登记"
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
        message: "账号未开通，不能操作入库"
      };
    }

    const user = userRes.data[0];
    if (user.role !== "admin") {
      return {
        success: false,
        message: "只有管理员可以操作入库"
      };
    }
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
          message: "物品已停用或已删除，不能入库"
        };
      }

      const beforeStock = Number(sku.stock || 0);
      const afterStock = beforeStock + inQuantity;

      const receiptRes = await transaction.collection("purchase_receipts")
        .doc(cleanTempReceiptId)
        .get();

      const receipt = receiptRes.data;

      if (!receipt) {
        return {
          success: false,
          message: "采购清单不存在"
        };
      }

      if (
        receipt.status !== "temp" ||
        receipt.source !== "stockInTemp" ||
        receipt.uploadedByOpenid !== openid ||
        receipt.fileID !== cleanReceiptFileID
      ) {
        return {
          success: false,
          message: "采购清单状态异常"
        };
      }

      const purchaseReceiptId = cleanTempReceiptId;

      // 3. 增加入库库存并写入入库记录，保持库存和流水一致
      await transaction.collection("item_skus")
        .doc(skuId)
        .update({
          data: {
            stock: _.inc(inQuantity),
            updatedAt: db.serverDate()
          }
        });

      const stockRecordRes = await transaction.collection("stock_records").add({
        data: {
          type: "in",
          skuId,
          itemName: sku.itemName,
          category: sku.category,
          size: sku.size,
          quantity: inQuantity,
          unit: sku.unit,
          beforeStock,
          afterStock,

          operatorId: user._id,
          operatorOpenid: openid,
          operatorName: user.name,
          operatorRole: user.role,

          reason: cleanReason,
          remark: cleanRemark,
          purchaseReceiptId,
          purchaseReceiptFileID: cleanReceiptFileID,

          createdAt: db.serverDate()
        }
      });

      const stockRecordId = stockRecordRes && (stockRecordRes._id || stockRecordRes.id) || "";

      if (purchaseReceiptId && stockRecordId) {
        await transaction.collection("purchase_receipts")
          .doc(purchaseReceiptId)
          .update({
            data: {
              fileName: cleanReceiptFileName || receipt.fileName || "purchase_receipt.jpg",
              remark: cleanRemark,
              status: "active",
              source: "stockIn",
              skuId,
              itemName: sku.itemName,
              category: sku.category,
              size: sku.size,
              quantity: inQuantity,
              unit: sku.unit,
              stockRecordId,
              updatedAt: db.serverDate()
            }
          });
      }

      return {
        success: true,
        message: "入库成功",
        data: {
          itemName: sku.itemName,
          size: sku.size,
          quantity: inQuantity,
          unit: sku.unit,
          beforeStock,
          afterStock
        }
      };
    });

    return result;

  } catch (err) {
    console.error("入库失败：", err);

    return {
      success: false,
      message: "入库失败",
    };
  }
};
