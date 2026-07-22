const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

async function getCurrentAdmin(openid) {
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
      message: "无权限访问"
    };
  }

  return {
    success: true,
    user: user
  };
}

function pickReceipt(item) {
  return {
    _id: item._id,
    fileID: item.fileID || "",
    fileName: item.fileName || "",
    fileType: item.fileType || "image",
    purchaseDate: item.purchaseDate || "",
    supplier: item.supplier || "",
    remark: item.remark || "",
    uploadedByName: item.uploadedByName || "",
    createdAt: item.createdAt || "",
    updatedAt: item.updatedAt || ""
  };
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  try {
    const adminRes = await getCurrentAdmin(openid);

    if (!adminRes.success) {
      return adminRes;
    }

    const receiptRes = await db.collection("purchase_receipts")
      .where({
        status: "active"
      })
      .orderBy("createdAt", "desc")
      .limit(100)
      .get();

    return {
      success: true,
      receipts: (receiptRes.data || []).map(pickReceipt)
    };
  } catch (err) {
    console.error("获取采购清单失败：", err);

    return {
      success: false,
      message: "获取采购清单失败",
    };
  }
};
