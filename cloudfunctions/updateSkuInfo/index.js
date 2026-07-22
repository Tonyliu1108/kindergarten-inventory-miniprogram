const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  const {
    skuId,
    itemName,
    category,
    size,
    safetyStock,
    unit,
    location
  } = event || {};

  const cleanSkuId = String(skuId || "").trim();
  const cleanItemName = String(itemName || "").trim();
  const cleanCategory = String(category || "").trim();
  const cleanSize = String(size || "").trim();
  const cleanUnit = String(unit || "").trim();
  const cleanLocation = String(location || "").trim();
  const safetyStockNumber = Number(safetyStock);

  if (!cleanSkuId) {
    return {
      success: false,
      message: "缺少物品ID"
    };
  }

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
      message: "请输入分类"
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

  if (!Number.isInteger(safetyStockNumber) || safetyStockNumber < 0) {
    return {
      success: false,
      message: "安全库存必须是非负整数"
    };
  }

  if (safetyStockNumber > 99999) {
    return {
      success: false,
      message: "安全库存数量过大"
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

    // 2. 只有管理员可以修改物品信息
    if (user.role !== "admin") {
      return {
        success: false,
        message: "只有管理员可以修改物品信息"
      };
    }

    // 3. 查询当前物品是否存在
    const skuRes = await db.collection("item_skus")
      .doc(cleanSkuId)
      .get();

    if (!skuRes.data) {
      return {
        success: false,
        message: "物品不存在"
      };
    }

    // 4. 检查是否和其他物品重复
    const existRes = await db.collection("item_skus")
      .where({
        itemName: cleanItemName,
        category: cleanCategory,
        size: cleanSize
      })
      .limit(10)
      .get();

    const duplicated = existRes.data.some(item => item._id !== cleanSkuId);

    if (duplicated) {
      return {
        success: false,
        message: "该物品名称、分类和尺码已存在"
      };
    }

    // 5. 更新基础信息，不直接修改库存数量
    await db.collection("item_skus")
      .doc(cleanSkuId)
      .update({
        data: {
          itemName: cleanItemName,
          category: cleanCategory,
          size: cleanSize,
          safetyStock: safetyStockNumber,
          unit: cleanUnit,
          location: cleanLocation,
          updatedAt: db.serverDate(),
          updatedBy: user._id,
          updatedByName: user.name
        }
      });

    return {
      success: true,
      message: "物品信息已更新"
    };

  } catch (err) {
    console.error("修改物品信息失败：", err);

    return {
      success: false,
      message: "修改物品信息失败",
    };
  }
};
