const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

function trimText(value) {
  return String(value || "").trim();
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
  const receiptId = trimText((event && (event.receiptId || event.id)) || "");

  if (!receiptId) {
    return {
      success: false,
      message: "缺少采购清单ID"
    };
  }

  try {
    const adminRes = await getCurrentAdmin(openid);

    if (!adminRes.success) {
      return adminRes;
    }

    const user = adminRes.user;

    const receiptRes = await db.collection("purchase_receipts")
      .doc(receiptId)
      .get();

    if (!receiptRes.data || receiptRes.data.status === "deleted") {
      return {
        success: false,
        message: "采购清单不存在"
      };
    }

    if (receiptRes.data.fileID) {
      const deleteRes = await cloud.deleteFile({
        fileList: [receiptRes.data.fileID]
      });
      const fileResult = deleteRes.fileList && deleteRes.fileList[0];

      if (!fileResult || fileResult.status !== 0) {
        throw new Error("cloud file deletion failed");
      }
    }

    await db.collection("purchase_receipts")
      .doc(receiptId)
      .update({
        data: {
          status: "deleted",
          fileID: "",
          fileName: "",
          supplier: "",
          remark: "",
          uploadedByName: "",
          uploadedByOpenid: "",
          deletedAt: db.serverDate(),
          deletedBy: user._id,
          deletedByName: user.name || "",
          updatedAt: db.serverDate()
        }
      });

    return {
      success: true,
      message: "采购清单已删除"
    };
  } catch (err) {
    console.error("删除采购清单失败：", err);

    return {
      success: false,
      message: "删除采购清单失败",
    };
  }
};
