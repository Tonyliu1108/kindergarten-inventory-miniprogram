const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

async function getLatestRejectedApplication(openid) {
  const rejectedRes = await db.collection("user_applications")
    .where({
      openid: openid,
      status: "rejected"
    })
    .orderBy("reviewedAt", "desc")
    .limit(1)
    .get();

  if (!rejectedRes.data || rejectedRes.data.length === 0) {
    return null;
  }

  const application = rejectedRes.data[0];

  return {
    _id: application._id,
    name: application.name || "",
    rejectReason: application.rejectReason || "",
    reviewedByName: application.reviewedByName || "",
    reviewedAt: application.reviewedAt || null
  };
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  try {
    const userRes = await db.collection("users")
      .where({
        openid: openid,
        status: "active"
      })
      .limit(1)
      .get();

    if (userRes.data.length === 0) {
      const rejectedApplication = await getLatestRejectedApplication(openid);

      return {
        success: false,
        needRegister: true,
        rejectedApplication: rejectedApplication,
        message: "账号未开通，请联系管理员"
      };
    }

    const user = userRes.data[0];

    return {
      success: true,
      needRegister: false,
      user: {
        _id: user._id,
        name: user.name,
        role: user.role,
        status: user.status
      }
    };
  } catch (err) {
    return {
      success: false,
      needRegister: false,
      message: "登录失败",
    };
  }
};
