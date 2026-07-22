const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

const EXPIRE_HOURS = 48;
const LIMIT = 100;
const TIMER_TRIGGER_NAME = "cleanupTempPurchaseReceiptsTimer";

function isExpectedTimerEvent(event, wxContext) {
  return Boolean(
    event &&
    event.Type === "Timer" &&
    event.TriggerName === TIMER_TRIGGER_NAME &&
    !(wxContext && wxContext.OPENID)
  );
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();

  if (!isExpectedTimerEvent(event, wxContext)) {
    return {
      success: false,
      message: "该函数仅允许由已配置的定时触发器调用"
    };
  }

  const expiredBefore = new Date(Date.now() - EXPIRE_HOURS * 60 * 60 * 1000);

  try {
    const res = await db.collection("purchase_receipts")
      .where({
        status: "temp",
        source: _.in(["stockInTemp", "addSkuTemp"]),
        createdAt: _.lt(expiredBefore)
      })
      .limit(LIMIT)
      .get();

    const receipts = res.data || [];
    let deletedFileCount = 0;
    let updatedRecordCount = 0;
    let failureCount = 0;

    for (let i = 0; i < receipts.length; i++) {
      const receipt = receipts[i];

      try {
        if (receipt.fileID) {
          const deleteRes = await cloud.deleteFile({
            fileList: [receipt.fileID]
          });

          const fileResult = deleteRes.fileList && deleteRes.fileList[0];
          if (!fileResult || fileResult.status !== 0) {
            throw new Error("cloud file deletion failed");
          }

          deletedFileCount++;
        }

        await db.collection("purchase_receipts")
          .doc(receipt._id)
          .update({
            data: {
              status: "deleted",
              fileID: "",
              fileName: "",
              uploadedByName: "",
              uploadedByOpenid: "",
              deletedReason: "temp_expired",
              deletedAt: db.serverDate(),
              updatedAt: db.serverDate()
            }
          });

        updatedRecordCount++;
      } catch (err) {
        console.error("清理临时采购清单失败：", receipt._id, err);
        failureCount++;
      }
    }

    return {
      success: true,
      expiredBefore: expiredBefore.toISOString(),
      scannedCount: receipts.length,
      deletedFileCount,
      updatedRecordCount,
      failureCount
    };
  } catch (err) {
    console.error("清理临时采购清单任务失败：", err);

    return {
      success: false,
      message: "清理临时采购清单失败"
    };
  }
};
