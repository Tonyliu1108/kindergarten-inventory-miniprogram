const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

function pickApplication(application) {
  return {
    _id: application._id,
    name: application.name || "",
    status: application.status || "pending",
    createdAt: application.createdAt || ""
  };
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  try {
    // 1. 查询当前用户
    const currentUserRes = await db.collection("users")
      .where({
        openid,
        status: "active"
      })
      .limit(1)
      .get();

    if (currentUserRes.data.length === 0) {
      return {
        success: false,
        message: "账号未开通"
      };
    }

    const currentUser = currentUserRes.data[0];

    // 2. 只有管理员可以查看申请
    if (currentUser.role !== "admin") {
      return {
        success: false,
        message: "只有管理员可以查看申请"
      };
    }

    // 3. 查询待审核申请
    const appRes = await db.collection("user_applications")
      .where({
        status: "pending"
      })
      .orderBy("createdAt", "desc")
      .limit(100)
      .get();

    return {
      success: true,
      applications: (appRes.data || []).map(pickApplication)
    };

  } catch (err) {
    console.error("获取申请列表失败：", err);

    return {
      success: false,
      message: "获取申请列表失败",
    };
  }
};
