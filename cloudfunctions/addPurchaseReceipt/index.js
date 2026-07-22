const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

function trimText(value) {
  return String(value || "").trim();
}

function limitText(value, maxLength) {
  return trimText(value).slice(0, maxLength);
}

function isAllowedReceiptFile(fileID) {
  return fileID.length <= 500 &&
    /\/purchase_receipts\/[^/?#]+\.(?:jpg|jpeg|png)$/i.test(fileID);
}

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

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  const fileID = trimText(event && event.fileID);
  const fileName = limitText(event && event.fileName, 120);
  const purchaseDate = limitText(event && event.purchaseDate, 20);
  const supplier = limitText(event && event.supplier, 80);
  const remark = limitText(event && event.remark, 300);

  if (!isAllowedReceiptFile(fileID)) {
    return {
      success: false,
      message: "采购清单图片无效"
    };
  }

  try {
    const adminRes = await getCurrentAdmin(openid);

    if (!adminRes.success) {
      return adminRes;
    }

    const user = adminRes.user;

    const addRes = await db.collection("purchase_receipts").add({
      data: {
        fileID: fileID,
        fileName: fileName || "purchase_receipt.jpg",
        fileType: "image",
        purchaseDate: purchaseDate,
        supplier: supplier,
        remark: remark,
        status: "active",
        uploadedBy: user._id,
        uploadedByName: user.name || "",
        uploadedByOpenid: openid,
        createdAt: db.serverDate(),
        updatedAt: db.serverDate()
      }
    });

    return {
      success: true,
      message: "采购清单已保存",
      receiptId: addRes._id
    };
  } catch (err) {
    console.error("保存采购清单失败：", err);

    return {
      success: false,
      message: "保存采购清单失败",
    };
  }
};
