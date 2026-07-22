const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  const {
    name,
    targetOpenid,
    role = "teacher"
  } = event || {};

  const cleanName = String(name || "").trim();
  const cleanOpenid = String(targetOpenid || "").trim();
  const cleanRole = String(role || "teacher").trim();

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
  
  if (!cleanOpenid) {
    return {
      success: false,
      message: "请输入 openid"
    };
  }
  
  if (cleanOpenid.length > 64) {
    return {
      success: false,
      message: "openid长度异常"
    };
  }

  if (!["teacher", "admin"].includes(cleanRole)) {
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

    // 2. 只有管理员可以新增用户
    if (currentUser.role !== "admin") {
      return {
        success: false,
        message: "只有管理员可以新增用户"
      };
    }

    // 3. 检查 openid 是否已存在
    const existRes = await db.collection("users")
      .where({
        openid: cleanOpenid
      })
      .limit(1)
      .get();

    if (existRes.data.length > 0) {
      return {
        success: false,
        message: "该 openid 已存在，不能重复添加"
      };
    }

    // 4. 新增用户
    await db.collection("users").add({
      data: {
        name: cleanName,
        openid: cleanOpenid,
        role: cleanRole,
        status: "active",
        createdAt: db.serverDate(),
        createdBy: currentUser._id,
        createdByName: currentUser.name
      }
    });

    return {
      success: true,
      message: "新增用户成功"
    };

  } catch (err) {
    console.error("新增用户失败：", err);

    return {
      success: false,
      message: "新增用户失败",
    };
  }
};
