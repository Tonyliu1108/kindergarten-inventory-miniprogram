const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  const { name } = event || {};
  const cleanName = String(name || "").trim();

  if (!cleanName) {
    return {
      success: false,
      message: "请输入姓名"
    };
  }

  if (cleanName.length > 10) {
    return {
      success: false,
      message: "姓名最多10个字"
    };
  }

  try {
    // 1. 如果已经是正式用户，不允许重复申请
    const userRes = await db.collection("users")
      .where({
        openid
      })
      .limit(1)
      .get();

    if (userRes.data.length > 0) {
      const user = userRes.data[0];

      if (user.status === "active") {
        return {
          success: false,
          message: "该账号已开通，无需重复申请"
        };
      }

      if (user.status === "disabled") {
        return {
          success: false,
          message: "该账号已被停用，请联系管理员"
        };
      }
    }

    // 2. 检查是否已有待审核申请
    const pendingRes = await db.collection("user_applications")
      .where({
        openid,
        status: "pending"
      })
      .limit(1)
      .get();

    if (pendingRes.data.length > 0) {
      return {
        success: false,
        message: "你已提交申请，请等待管理员审核"
      };
    }

    // 3. 写入申请记录
    await db.collection("user_applications").add({
      data: {
        name: cleanName,
        openid,
        status: "pending",
        createdAt: db.serverDate()
      }
    });

    return {
      success: true,
      message: "申请已提交，请等待管理员审核"
    };

  } catch (err) {
    console.error("提交申请失败：", err);

    return {
      success: false,
      message: "提交申请失败",
    };
  }
};