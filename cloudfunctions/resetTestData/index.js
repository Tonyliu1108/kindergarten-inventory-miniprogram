const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

const RESET_ENABLED = process.env.ALLOW_TEST_DATA_RESET === "true";
const CONFIRM_TOKEN = String(process.env.RESET_TEST_DATA_CONFIRMATION || "").trim();
const DELETE_BATCH_SIZE = 100;
const MAX_DELETE_ROUNDS = 300;
const MAX_FILE_REF_SAMPLE = 1000;

async function getCurrentAdmin(openid) {
  const userRes = await db.collection("users")
    .where({
      openid,
      status: "active"
    })
    .limit(1)
    .get();

  const user = userRes.data && userRes.data[0];

  if (!user) {
    return {
      success: false,
      message: "账号未开通"
    };
  }

  if (user.role !== "admin") {
    return {
      success: false,
      message: "只有管理员可以清理测试数据"
    };
  }

  return {
    success: true,
    user
  };
}

async function countCollection(collectionName) {
  const res = await db.collection(collectionName).count();
  return res.total || 0;
}

async function getPurchaseReceiptFileRefs() {
  const count = await countCollection("purchase_receipts");
  const refs = [];
  let skip = 0;

  while (refs.length < MAX_FILE_REF_SAMPLE) {
    const res = await db.collection("purchase_receipts")
      .field({
        fileID: true,
        fileName: true,
        source: true,
        status: true,
        createdAt: true,
        itemName: true
      })
      .skip(skip)
      .limit(100)
      .get();

    const data = res.data || [];

    if (data.length === 0) {
      break;
    }

    data.forEach(item => {
      if (item.fileID || item.fileName) {
        refs.push({
          _id: item._id,
          fileID: item.fileID || "",
          fileName: item.fileName || "",
          source: item.source || "",
          status: item.status || "",
          itemName: item.itemName || "",
          createdAt: item.createdAt || null
        });
      }
    });

    skip += data.length;

    if (data.length < 100) {
      break;
    }
  }

  return {
    count,
    referencedFileCount: refs.length,
    refs: refs.slice(0, 100),
    truncated: refs.length > 100
  };
}

async function deleteCollection(collectionName) {
  let removed = 0;
  let rounds = 0;

  while (rounds < MAX_DELETE_ROUNDS) {
    rounds++;

    const res = await db.collection(collectionName)
      .where({
        _id: _.exists(true)
      })
      .field({
        _id: true
      })
      .limit(DELETE_BATCH_SIZE)
      .get();

    const ids = (res.data || []).map(item => item._id).filter(Boolean);

    if (ids.length === 0) {
      return {
        removed,
        complete: true,
        rounds
      };
    }

    for (let i = 0; i < ids.length; i++) {
      await db.collection(collectionName).doc(ids[i]).remove();
      removed++;
    }
  }

  return {
    removed,
    complete: false,
    rounds
  };
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const action = String(event && event.action || "dryRun").trim();
  const confirm = String(event && event.confirm || "").trim();

  try {
    const adminResult = await getCurrentAdmin(openid);

    if (!adminResult.success) {
      return adminResult;
    }

    const before = {
      itemSkus: await countCollection("item_skus"),
      stockRecords: await countCollection("stock_records"),
      users: await countCollection("users"),
      purchaseReceipts: await getPurchaseReceiptFileRefs()
    };

    if (action !== "clean") {
      return {
        success: true,
        dryRun: true,
        message: "仅统计，未删除任何数据",
        before,
        note: "云函数不会删除 users，也不会删除 purchase_receipts 或云存储文件。"
      };
    }

    if (!RESET_ENABLED || !CONFIRM_TOKEN) {
      return {
        success: false,
        message: "测试数据清理功能未启用，未删除任何数据",
        before
      };
    }

    if (confirm !== CONFIRM_TOKEN) {
      return {
        success: false,
        message: "确认口令不正确，未删除任何数据",
        before
      };
    }

    const itemSkusDelete = await deleteCollection("item_skus");
    const stockRecordsDelete = await deleteCollection("stock_records");

    const after = {
      itemSkus: await countCollection("item_skus"),
      stockRecords: await countCollection("stock_records"),
      users: await countCollection("users"),
      purchaseReceipts: await getPurchaseReceiptFileRefs()
    };

    return {
      success: true,
      dryRun: false,
      message: "测试库存数据已清理；users、purchase_receipts 和云存储文件未删除。",
      before,
      deleted: {
        itemSkus: itemSkusDelete,
        stockRecords: stockRecordsDelete
      },
      after
    };
  } catch (err) {
    console.error("清理测试数据失败：", err);

    return {
      success: false,
      message: "清理测试数据失败"
    };
  }
};
