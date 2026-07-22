const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  const {
    userId,
    role
  } = event || {};

  if (!userId) {
    return {
      success: false,
      message: "缺少用户ID"
    };
  }

  if (!["teacher", "admin"].includes(role)) {
    return {
      success: false,
      message: "角色不合法"
    };
  }

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

    // 2. 只有管理员可以修改角色
    if (currentUser.role !== "admin") {
      return {
        success: false,
        message: "只有管理员可以修改角色"
      };
    }

    // 3. 防止管理员修改自己的角色
    if (currentUser._id === userId) {
      return {
        success: false,
        message: "不能修改当前登录账号的角色"
      };
    }

    const targetUserRes = await db.collection("users")
      .where({
        _id: userId
      })
      .limit(1)
      .get();

    const targetUser = targetUserRes.data && targetUserRes.data[0];

    if (!targetUser) {
      return {
        success: false,
        message: "用户不存在"
      };
    }

    if (targetUser.role === "admin" && role !== "admin") {
      const adminCountRes = await db.collection("users")
        .where({
          role: "admin",
          status: "active"
        })
        .count();

      if (adminCountRes.total <= 1) {
        return {
          success: false,
          message: "至少需要保留一个启用中的管理员"
        };
      }
    }

    // 4. 更新角色
    await db.collection("users")
      .doc(userId)
      .update({
        data: {
          role,
          updatedAt: db.serverDate()
        }
      });

    return {
      success: true,
      message: role === "admin" ? "已设置为管理员" : "已设置为老师"
    };

  } catch (err) {
    console.error("修改用户角色失败：", err);

    return {
      success: false,
      message: "修改用户角色失败",
    };
  }
};
