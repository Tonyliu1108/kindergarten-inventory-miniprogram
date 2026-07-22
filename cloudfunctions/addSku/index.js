const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  const {
    itemName,
    category,
    size,
    stock,
    safetyStock,
    unit,
    location,
    receiptFileID,
    receiptFileName,
    tempReceiptId
  } = event || {};

  const cleanItemName = String(itemName || "").trim();
  const cleanCategory = String(category || "").trim();
  const cleanSize = String(size || "").trim();
  const cleanUnit = String(unit || "").trim();
  const cleanLocation = String(location || "").trim();
  const cleanReceiptFileID = String(receiptFileID || "").trim();
  const cleanReceiptFileName = String(receiptFileName || "purchase_receipt.jpg").trim().slice(0, 120);
  const cleanTempReceiptId = String(tempReceiptId || "").trim();

  const stockNumber = Number(stock);
  const safetyStockNumber = Number(safetyStock);

  if (!cleanItemName) {
    return {
      success: false,
      message: "请输入物品名称"
    };
  }

  if (cleanItemName.length > 30) {
    return {
      success: false,
      message: "物品名称最多30个字"
    };
  }

  if (!cleanCategory) {
    return {
      success: false,
      message: "请选择或输入分类"
    };
  }

  if (cleanCategory.length > 20) {
    return {
      success: false,
      message: "分类最多20个字"
    };
  }

  if (!cleanSize) {
    return {
      success: false,
      message: "请输入尺码或规格"
    };
  }

  if (cleanSize.length > 20) {
    return {
      success: false,
      message: "尺码/规格最多20个字"
    };
  }

  if (!Number.isInteger(stockNumber) || stockNumber < 0) {
    return {
      success: false,
      message: "库存数量必须是非负整数"
    };
  }

  if (stockNumber > 99999) {
    return {
      success: false,
      message: "库存数量过大"
    };
  }

  if (!Number.isInteger(safetyStockNumber) || safetyStockNumber < 0) {
    return {
      success: false,
      message: "安全库存必须是非负整数"
    };
  }

  if (!cleanUnit) {
    return {
      success: false,
      message: "请输入单位"
    };
  }

  if (cleanUnit.length > 10) {
    return {
      success: false,
      message: "单位最多10个字"
    };
  }

  if (!cleanLocation) {
    return {
      success: false,
      message: "请输入存放位置"
    };
  }

  if (cleanLocation.length > 20) {
    return {
      success: false,
      message: "位置最多20个字"
    };
  }

  if (safetyStockNumber > 99999) {
    return {
      success: false,
      message: "安全库存数量过大"
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
        message: "账号未开通"
      };
    }

    const user = userRes.data[0];

    // 2. 只有管理员可以新增物品
    if (user.role !== "admin") {
      return {
        success: false,
        message: "只有管理员可以新增物品"
      };
    }

    // 3. 检查是否重复
    const existRes = await db.collection("item_skus")
      .where({
        itemName: cleanItemName,
        category: cleanCategory,
        size: cleanSize
      })
      .limit(1)
      .get();

    if (existRes.data.length > 0) {
      return {
        success: false,
        message: "该物品和尺码已存在，不能重复添加"
      };
    }

    const result = await db.runTransaction(async transaction => {
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
        receipt.source !== "addSkuTemp" ||
        receipt.uploadedByOpenid !== openid ||
        receipt.fileID !== cleanReceiptFileID
      ) {
        return {
          success: false,
          message: "采购清单状态异常"
        };
      }

      // 4. 新增物品
      const addRes = await transaction.collection("item_skus").add({
        data: {
          itemName: cleanItemName,
          category: cleanCategory,
          size: cleanSize,
          stock: stockNumber,
          safetyStock: safetyStockNumber,
          unit: cleanUnit,
          location: cleanLocation,
          status: "active",
          createdAt: db.serverDate(),
          updatedAt: db.serverDate(),
          createdBy: user._id,
          createdByName: user.name
        }
      });

      const skuId = addRes._id;
      const stockRecordRes = await transaction.collection("stock_records").add({
        data: {
          type: "add",
          skuId: skuId,
          itemSkuId: skuId,
          itemName: cleanItemName,
          category: cleanCategory,
          size: cleanSize,
          quantity: stockNumber,
          unit: cleanUnit,
          beforeStock: 0,
          afterStock: stockNumber,
          operatorId: user._id,
          operatorOpenid: openid,
          operatorName: user.name,
          operatorRole: user.role,
          reason: "新增物品",
          remark: "",
          purchaseReceiptId: cleanTempReceiptId,
          purchaseReceiptFileID: cleanReceiptFileID,
          createdAt: db.serverDate()
        }
      });

      const stockRecordId = stockRecordRes && (stockRecordRes._id || stockRecordRes.id) || "";

      await transaction.collection("purchase_receipts")
        .doc(cleanTempReceiptId)
        .update({
          data: {
            fileName: cleanReceiptFileName || receipt.fileName || "purchase_receipt.jpg",
            status: "active",
            source: "addSku",
            skuId: skuId,
            itemName: cleanItemName,
            category: cleanCategory,
            size: cleanSize,
            quantity: stockNumber,
            unit: cleanUnit,
            stockRecordId: stockRecordId,
            updatedAt: db.serverDate()
          }
        });

      return {
        success: true,
        message: "新增物品成功"
      };
    });

    return result;

  } catch (err) {
    console.error("新增物品失败：", err);

    return {
      success: false,
      message: "新增物品失败",
    };
  }
};
