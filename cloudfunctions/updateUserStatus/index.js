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
    status
  } = event || {};

  if (!userId) {
    return {
      success: false,
      message: "缺少用户ID"
    };
  }

  if (!["active", "disabled"].includes(status)) {
    return {
      success: false,
      message: "状态不合法"
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

    // 2. 只有管理员可以改用户状态
    if (currentUser.role !== "admin") {
      return {
        success: false,
        message: "只有管理员可以修改用户状态"
      };
    }

    // 3. 防止管理员把自己停用
    if (currentUser._id === userId && status === "disabled") {
      return {
        success: false,
        message: "不能停用当前登录的管理员账号"
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

    if (targetUser.role === "admin" && status === "disabled") {
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

    // 4. 更新状态
    await db.collection("users")
      .doc(userId)
      .update({
        data: {
          status,
          updatedAt: db.serverDate()
        }
      });

    return {
      success: true,
      message: status === "active" ? "已启用账号" : "已停用账号"
    };

  } catch (err) {
    console.error("修改用户状态失败：", err);

    return {
      success: false,
      message: "修改用户状态失败",
    };
  }
};
