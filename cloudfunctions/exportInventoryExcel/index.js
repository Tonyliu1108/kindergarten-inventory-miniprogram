const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

const QUERY_LIMIT = 100;
const MAX_EXPORT_COUNT = 5000;
const MAX_INLINE_FILE_SIZE = 800 * 1024;

function padNumber(value) {
  return value < 10 ? "0" + value : String(value);
}

function formatDateOnly(value) {
  const date = value || new Date();

  return date.getFullYear() + "-" +
    padNumber(date.getMonth() + 1) + "-" +
    padNumber(date.getDate());
}

function formatDateTime(value) {
  if (!value) return "";

  let date;

  if (value instanceof Date) {
    date = value;
  } else if (value && value.$date) {
    date = new Date(value.$date);
  } else {
    date = new Date(value);
  }

  if (!date || isNaN(date.getTime())) return "";

  return date.getFullYear() + "-" +
    padNumber(date.getMonth() + 1) + "-" +
    padNumber(date.getDate()) + " " +
    padNumber(date.getHours()) + ":" +
    padNumber(date.getMinutes());
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function trimText(value) {
  return String(value || "").trim();
}

function parseDateOnly(value) {
  const text = trimText(value);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return null;
  }

  const parts = text.split("-");
  const date = new Date(
    Number(parts[0]),
    Number(parts[1]) - 1,
    Number(parts[2])
  );

  if (isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function getDateRange(dateType, startDate, endDate) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (dateType === "today") {
    return {
      start: todayStart,
      end: now,
      label: formatDateOnly(todayStart)
    };
  }

  if (dateType === "7days") {
    const start = new Date(todayStart);
    start.setDate(start.getDate() - 6);
    return {
      start,
      end: now,
      label: formatDateOnly(start) + "至" + formatDateOnly(now)
    };
  }

  if (dateType === "30days") {
    const start = new Date(todayStart);
    start.setDate(start.getDate() - 29);
    return {
      start,
      end: now,
      label: formatDateOnly(start) + "至" + formatDateOnly(now)
    };
  }

  if (dateType === "custom") {
    const start = parseDateOnly(startDate);
    const endDay = parseDateOnly(endDate);

    if (!start || !endDay) {
      return {
        error: "请选择有效的开始和结束日期"
      };
    }

    if (start.getTime() > todayStart.getTime()) {
      return {
        error: "开始日期不能超过今天"
      };
    }

    if (endDay.getTime() > todayStart.getTime()) {
      return {
        error: "结束日期不能超过今天"
      };
    }

    const end = new Date(endDay);
    end.setHours(23, 59, 59, 999);

    if (start.getTime() > end.getTime()) {
      return {
        error: "开始日期不能晚于结束日期"
      };
    }

    return {
      start,
      end,
      label: formatDateOnly(start) + "至" + formatDateOnly(endDay)
    };
  }

  return {
    start: null,
    end: null,
    label: "全部"
  };
}

async function getCurrentAdmin(openid) {
  const userRes = await db.collection("users")
    .where({
      openid: openid,
      status: "active"
    })
    .limit(1)
    .get();

  if (!userRes.data || userRes.data.length === 0) {
    return {
      success: false,
      message: "账号未开通"
    };
  }

  const user = userRes.data[0];

  if (user.role !== "admin") {
    return {
      success: false,
      message: "只有管理员可以导出库存总览"
    };
  }

  return {
    success: true,
    user: user
  };
}

async function getAllSkus() {
  let items = [];
  let skip = 0;

  while (items.length < MAX_EXPORT_COUNT) {
    const res = await db.collection("item_skus")
      .where({
        status: _.neq("deleted")
      })
      .skip(skip)
      .limit(QUERY_LIMIT)
      .get();

    const data = res.data || [];
    items = items.concat(data);

    if (data.length < QUERY_LIMIT) {
      break;
    }

    skip += QUERY_LIMIT;
  }

  return items.slice(0, MAX_EXPORT_COUNT).sort((a, b) => {
    const left = String(a.category || "") + String(a.itemName || "") + String(a.size || "");
    const right = String(b.category || "") + String(b.itemName || "") + String(b.size || "");
    return left.localeCompare(right, "zh-Hans-CN");
  });
}

async function getStockRecords(range) {
  let records = [];
  let skip = 0;
  let query = {};

  if (range.start && range.end) {
    query.createdAt = _.gte(range.start).and(_.lte(range.end));
  } else if (range.start) {
    query.createdAt = _.gte(range.start);
  } else if (range.end) {
    query.createdAt = _.lte(range.end);
  }

  while (records.length < MAX_EXPORT_COUNT) {
    const res = await db.collection("stock_records")
      .where(query)
      .orderBy("createdAt", "desc")
      .skip(skip)
      .limit(QUERY_LIMIT)
      .get();

    const data = res.data || [];
    records = records.concat(data);

    if (data.length < QUERY_LIMIT) {
      break;
    }

    skip += QUERY_LIMIT;
  }

  return records.slice(0, MAX_EXPORT_COUNT);
}

function createEmptyStats() {
  return {
    inQuantity: 0,
    outQuantity: 0,
    exchangeInQuantity: 0,
    exchangeOutQuantity: 0,
    adjustDiff: 0
  };
}

function getStatsForSku(statsMap, skuId) {
  if (!skuId) {
    return null;
  }

  if (!statsMap[skuId]) {
    statsMap[skuId] = createEmptyStats();
  }

  return statsMap[skuId];
}

function buildRecordStats(records) {
  const statsMap = {};

  records.forEach(record => {
    const type = record.type || "";
    const quantity = toNumber(record.quantity);

    if (type === "in") {
      const stats = getStatsForSku(statsMap, record.skuId || record.itemSkuId);
      if (stats) stats.inQuantity += quantity;
      return;
    }

    if (type === "out") {
      const stats = getStatsForSku(statsMap, record.skuId || record.itemSkuId);
      if (stats) stats.outQuantity += quantity;
      return;
    }

    if (type === "exchange") {
      const increaseStats = getStatsForSku(statsMap, record.oldSkuId);
      const decreaseStats = getStatsForSku(statsMap, record.newSkuId || record.skuId);

      if (increaseStats) increaseStats.exchangeInQuantity += quantity;
      if (decreaseStats) decreaseStats.exchangeOutQuantity += quantity;
      return;
    }

    if (type === "adjust") {
      const stats = getStatsForSku(statsMap, record.skuId || record.itemSkuId);
      if (stats) {
        if (record.adjustQuantity !== undefined && record.adjustQuantity !== null) {
          stats.adjustDiff += toNumber(record.adjustQuantity);
        } else {
          stats.adjustDiff += toNumber(record.afterStock) - toNumber(record.beforeStock);
        }
      }
    }
  });

  return statsMap;
}

function getStockStatus(item) {
  const stock = toNumber(item.stock);
  const safetyStock = toNumber(item.safetyStock);

  if (stock <= 0) return "库存为0";
  if (stock <= safetyStock) return "库存偏低";
  return "正常";
}

function buildRows(items, statsMap, rangeLabel) {
  return items.map(item => {
    const stats = statsMap[item._id] || createEmptyStats();
    const netChange = stats.inQuantity -
      stats.outQuantity +
      stats.exchangeInQuantity -
      stats.exchangeOutQuantity +
      stats.adjustDiff;

    return {
      "物品名称": item.itemName || "",
      "分类": item.category || "",
      "尺码/规格": item.size || "",
      "当前库存": toNumber(item.stock),
      "单位": item.unit || "",
      "安全库存": toNumber(item.safetyStock),
      "库存状态": getStockStatus(item),
      "统计时间段": rangeLabel,
      "时间段入库": stats.inQuantity,
      "时间段出库": stats.outQuantity,
      "换码增加": stats.exchangeInQuantity,
      "换码减少": stats.exchangeOutQuantity,
      "盘点差异": stats.adjustDiff,
      "时间段净变化": netChange,
      "存放位置": item.location || "",
      "物品状态": item.status === "active" ? "启用" : "停用",
      "创建时间": formatDateTime(item.createdAt),
      "更新时间": formatDateTime(item.updatedAt)
    };
  });
}

function escapeXml(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function getColumnName(index) {
  let name = "";
  let current = index + 1;

  while (current > 0) {
    const mod = (current - 1) % 26;
    name = String.fromCharCode(65 + mod) + name;
    current = Math.floor((current - mod) / 26);
  }

  return name;
}

function buildCellXml(value, rowIndex, columnIndex) {
  const cellRef = getColumnName(columnIndex) + rowIndex;

  if (typeof value === "number" && isFinite(value)) {
    return '<c r="' + cellRef + '"><v>' + value + "</v></c>";
  }

  return '<c r="' + cellRef + '" t="inlineStr"><is><t>' +
    escapeXml(value) +
    "</t></is></c>";
}

function buildSheetXml(rows) {
  const headers = [
    "物品名称",
    "分类",
    "尺码/规格",
    "当前库存",
    "单位",
    "安全库存",
    "库存状态",
    "统计时间段",
    "时间段入库",
    "时间段出库",
    "换码增加",
    "换码减少",
    "盘点差异",
    "时间段净变化",
    "存放位置",
    "物品状态",
    "创建时间",
    "更新时间"
  ];
  const widths = [26, 18, 18, 12, 10, 12, 14, 24, 12, 12, 12, 12, 12, 14, 20, 12, 18, 18];
  let sheetData = "";
  const allRows = [headers].concat(rows.map(row => headers.map(header => row[header])));

  for (let i = 0; i < allRows.length; i++) {
    const rowIndex = i + 1;
    let cells = "";

    for (let j = 0; j < allRows[i].length; j++) {
      cells += buildCellXml(allRows[i][j], rowIndex, j);
    }

    sheetData += '<row r="' + rowIndex + '">' + cells + "</row>";
  }

  let cols = "<cols>";
  for (let k = 0; k < widths.length; k++) {
    cols += '<col min="' + (k + 1) + '" max="' + (k + 1) + '" width="' + widths[k] + '" customWidth="1"/>';
  }
  cols += "</cols>";

  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    cols +
    "<sheetData>" + sheetData + "</sheetData>" +
    "</worksheet>";
}

const CRC_TABLE = (function buildCrcTable() {
  const table = [];

  for (let i = 0; i < 256; i++) {
    let c = i;

    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }

    table[i] = c >>> 0;
  }

  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;

  for (let i = 0; i < buffer.length; i++) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function getDosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();

  return {
    time: dosTime,
    date: dosDate
  };
}

function createZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const now = getDosDateTime(new Date());

  files.forEach(file => {
    const nameBuffer = Buffer.from(file.name, "utf8");
    const contentBuffer = Buffer.from(file.content, "utf8");
    const crc = crc32(contentBuffer);
    const localHeader = Buffer.alloc(30);

    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(now.time, 10);
    localHeader.writeUInt16LE(now.date, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(contentBuffer.length, 18);
    localHeader.writeUInt32LE(contentBuffer.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuffer, contentBuffer);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(now.time, 12);
    centralHeader.writeUInt16LE(now.date, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(contentBuffer.length, 20);
    centralHeader.writeUInt32LE(contentBuffer.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuffer);
    offset += localHeader.length + nameBuffer.length + contentBuffer.length;
  });

  const centralDirectory = Buffer.concat(centralParts);
  const localFiles = Buffer.concat(localParts);
  const end = Buffer.alloc(22);

  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localFiles.length, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([localFiles, centralDirectory, end]);
}

function buildWorkbookBuffer(rows) {
  return createZip([
    {
      name: "[Content_Types].xml",
      content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        "</Types>"
    },
    {
      name: "_rels/.rels",
      content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        "</Relationships>"
    },
    {
      name: "xl/workbook.xml",
      content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        "<sheets><sheet name=\"库存总览\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>"
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        "</Relationships>"
    },
    {
      name: "xl/styles.xml",
      content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
        '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>' +
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>' +
        "</styleSheet>"
    },
    {
      name: "xl/worksheets/sheet1.xml",
      content: buildSheetXml(rows)
    }
  ]);
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const dateType = trimText(event && event.dateType) || "all";
  const startDate = trimText(event && event.startDate);
  const endDate = trimText(event && event.endDate);

  try {
    const adminRes = await getCurrentAdmin(openid);

    if (!adminRes.success) {
      return adminRes;
    }

    const range = getDateRange(dateType, startDate, endDate);

    if (range.error) {
      return {
        success: false,
        message: range.error
      };
    }

    const items = await getAllSkus();

    if (items.length === 0) {
      return {
        success: false,
        message: "暂无可导出库存"
      };
    }

    const records = await getStockRecords(range);
    const statsMap = buildRecordStats(records);
    const rows = buildRows(items, statsMap, range.label);
    const buffer = buildWorkbookBuffer(rows);
    const today = formatDateOnly(new Date());
    const cloudPath = "exports/inventory/inventory_" + today + "_" + Date.now() + ".xlsx";

    const uploadRes = await cloud.uploadFile({
      cloudPath: cloudPath,
      fileContent: buffer
    });

    return {
      success: true,
      fileID: uploadRes.fileID,
      fileName: "库存总览_" + range.label + "_" + today + ".xlsx",
      fileBase64: buffer.length <= MAX_INLINE_FILE_SIZE ? buffer.toString("base64") : "",
      count: items.length
    };
  } catch (err) {
    console.error("导出库存总览Excel失败：", err);

    return {
      success: false,
      message: "导出失败",
    };
  }
};
