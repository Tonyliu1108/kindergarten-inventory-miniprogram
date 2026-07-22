const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

const APPROVED_ROLE = "teacher";

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const adminOpenid = wxContext.OPENID;

  const {
    applicationId,
    action,
    role = APPROVED_ROLE,
    rejectReason = ""
  } = event || {};

  if (!applicationId) {
    return {
      success: false,
      message: "缺少申请ID"
    };
  }

  if (!["approve", "reject"].includes(action)) {
    return {
      success: false,
      message: "审核操作不合法"
    };
  }

  if (role !== APPROVED_ROLE) {
    return {
      success: false,
      message: "申请审核只能开通老师账号"
    };
  }

  const cleanRejectReason = String(rejectReason || "").trim();

  if (action === "reject" && !cleanRejectReason) {
    return {
      success: false,
      message: "请填写拒绝原因"
    };
  }

  if (cleanRejectReason.length > 100) {
    return {
      success: false,
      message: "拒绝原因最多100个字"
    };
  }

  try {
    // 1. 查询当前管理员
    const adminRes = await db.collection("users")
      .where({
        openid: adminOpenid,
        status: "active"
      })
      .limit(1)
      .get();

    if (adminRes.data.length === 0) {
      return {
        success: false,
        message: "账号未开通"
      };
    }

    const adminUser = adminRes.data[0];

    if (adminUser.role !== "admin") {
      return {
        success: false,
        message: "只有管理员可以审核申请"
      };
    }

    const result = await db.runTransaction(async transaction => {
      // 2. 查询申请
      const appRes = await transaction.collection("user_applications")
        .where({
          _id: applicationId
        })
        .limit(1)
        .get();

      const application = appRes.data && appRes.data[0];

      if (!application) {
        return {
          success: false,
          message: "申请不存在"
        };
      }

      if (application.status !== "pending") {
        return {
          success: false,
          message: "该申请已处理"
        };
      }

      // 3. 拒绝申请
      if (action === "reject") {
        await transaction.collection("user_applications")
          .doc(applicationId)
          .update({
            data: {
              status: "rejected",
              rejectReason: cleanRejectReason,
              reviewedAt: db.serverDate(),
              reviewedBy: adminUser._id,
              reviewedByName: adminUser.name
            }
          });

        return {
          success: true,
          message: "已拒绝申请"
        };
      }

      // 4. 通过申请：检查 users 是否已经存在
      const existUserRes = await transaction.collection("users")
        .where({
          openid: application.openid
        })
        .limit(1)
        .get();

      if (existUserRes.data.length > 0) {
        const existUser = existUserRes.data[0];

        await transaction.collection("users")
          .doc(existUser._id)
          .update({
            data: {
              name: application.name,
              role: APPROVED_ROLE,
              status: "active",
              updatedAt: db.serverDate()
            }
          });
      } else {
        await transaction.collection("users").add({
          data: {
            name: application.name,
            openid: application.openid,
            role: APPROVED_ROLE,
            status: "active",
            createdAt: db.serverDate(),
            createdBy: adminUser._id,
            createdByName: adminUser.name
          }
        });
      }

      // 5. 更新申请状态
      await transaction.collection("user_applications")
        .doc(applicationId)
        .update({
          data: {
            status: "approved",
            role: APPROVED_ROLE,
            reviewedAt: db.serverDate(),
            reviewedBy: adminUser._id,
            reviewedByName: adminUser.name
          }
        });

      return {
        success: true,
        message: "已通过申请"
      };
    });

    return result;

  } catch (err) {
    console.error("审核申请失败：", err);

    return {
      success: false,
      message: "审核申请失败",
    };
  }
};
