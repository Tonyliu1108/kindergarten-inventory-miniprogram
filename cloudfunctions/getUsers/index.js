const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  try {
    // 1. 查询当前登录用户
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

    // 2. 只有管理员可以查看用户列表
    if (currentUser.role !== "admin") {
      return {
        success: false,
        message: "只有管理员可以查看用户列表"
      };
    }

    // 3. 查询所有用户
    const userRes = await db.collection("users")
      .orderBy("createdAt", "desc")
      .limit(100)
      .get();

    const users = (userRes.data || []).map(item => {
      return {
        _id: item._id,
        name: item.name || "",
        role: item.role || "teacher",
        status: item.status || "active",
        createdAt: item.createdAt || ""
      };
    });

    return {
      success: true,
      users
    };

  } catch (err) {
    console.error("获取用户列表失败：", err);

    return {
      success: false,
      message: "获取用户列表失败",
    };
  }
};
