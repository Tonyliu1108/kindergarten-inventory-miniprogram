const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

const QUERY_LIMIT = 100;
const MAX_EXPORT_COUNT = 2000;
const MAX_INLINE_FILE_SIZE = 800 * 1024;

function trimText(value) {
  return String(value || "").trim();
}

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\s+/g, "");
}

function isSubsequence(keyword, target) {
  keyword = normalizeText(keyword);
  target = normalizeText(target);

  if (!keyword) return true;

  let j = 0;

  for (let i = 0; i < target.length && j < keyword.length; i++) {
    if (target[i] === keyword[j]) {
      j++;
    }
  }

  return j === keyword.length;
}

function getChinaTodayRange() {
  const now = new Date();
  const utcTime = now.getTime() + now.getTimezoneOffset() * 60000;
  const chinaNow = new Date(utcTime + 8 * 60 * 60 * 1000);

  const y = chinaNow.getFullYear();
  const m = chinaNow.getMonth();
  const d = chinaNow.getDate();

  return {
    start: new Date(Date.UTC(y, m, d, -8, 0, 0)),
    end: new Date(Date.UTC(y, m, d + 1, -8, 0, 0))
  };
}

function parseDateOnlyToChinaStart(value) {
  const text = trimText(value);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return null;
  }

  const parts = text.split("-");
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  const date = new Date(Date.UTC(year, month - 1, day, -8, 0, 0));

  if (isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function getDateRange(dateType, startDate, endDate) {
  if (!dateType || dateType === "all") {
    return null;
  }

  const todayRange = getChinaTodayRange();

  if (dateType === "today") {
    return todayRange;
  }

  if (dateType === "7days") {
    return {
      start: new Date(todayRange.start.getTime() - 6 * 24 * 60 * 60 * 1000),
      end: todayRange.end
    };
  }

  if (dateType === "30days") {
    return {
      start: new Date(todayRange.start.getTime() - 29 * 24 * 60 * 60 * 1000),
      end: todayRange.end
    };
  }

  if (dateType === "custom") {
    const start = parseDateOnlyToChinaStart(startDate);
    const endStart = parseDateOnlyToChinaStart(endDate);

    if (!start || !endStart) {
      return {
        error: "请选择有效的开始和结束日期"
      };
    }

    if (start.getTime() > todayRange.start.getTime()) {
      return {
        error: "开始日期不能超过今天"
      };
    }

    if (endStart.getTime() > todayRange.start.getTime()) {
      return {
        error: "结束日期不能超过今天"
      };
    }

    if (start.getTime() > endStart.getTime()) {
      return {
        error: "开始日期不能晚于结束日期"
      };
    }

    return {
      start: start,
      end: new Date(endStart.getTime() + 24 * 60 * 60 * 1000)
    };
  }

  return null;
}

function normalizeRecordType(item) {
  const type = item && item.type ? String(item.type) : "";
  const reason = item && item.reason ? String(item.reason) : "";
  const beforeStock = Number(item && item.beforeStock);
  const afterStock = Number(item && item.afterStock);
  const quantity = Number(item && item.quantity);

  if (["add", "create", "new", "addSku"].includes(type)) {
    return "add";
  }

  if (reason === "新增物品") {
    return "add";
  }

  if (beforeStock === 0 && afterStock > 0 && afterStock === quantity) {
    return "add";
  }

  return type;
}

function getTypeText(type) {
  if (type === "out") return "出库";
  if (type === "in") return "入库";
  if (type === "add") return "新增";
  if (type === "exchange") return "换码";
  if (type === "adjust") return "盘点";
  return "记录";
}

function padNumber(value) {
  return value < 10 ? "0" + value : String(value);
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

function formatDateOnly(value) {
  const date = value || new Date();

  return date.getFullYear() + "-" +
    padNumber(date.getMonth() + 1) + "-" +
    padNumber(date.getDate());
}

function matchRecordItem(item, keyword) {
  const key = normalizeText(keyword);

  if (!key) return true;

  const type = normalizeRecordType(item);
  const fullText = normalizeText(item.itemName) +
    normalizeText(item.category) +
    normalizeText(item.size) +
    normalizeText(item.oldSize) +
    normalizeText(item.newSize) +
    normalizeText(item.operatorName) +
    normalizeText(item.reason) +
    normalizeText(item.remark) +
    normalizeText(getTypeText(type));

  if (fullText.indexOf(key) !== -1) {
    return true;
  }

  return isSubsequence(key, fullText);
}

function shouldKeepByType(record, type) {
  const normalizedType = normalizeRecordType(record);

  if (!type) {
    return true;
  }

  if (type === "in") {
    return normalizedType === "in" || normalizedType === "add";
  }

  return normalizedType === type;
}

function buildStockChange(record, type) {
  const unit = record.unit || "";

  if (type === "exchange") {
    return "旧尺码：" +
      (record.oldBeforeStock || 0) + unit + " → " + (record.oldAfterStock || 0) + unit +
      "；新尺码：" +
      (record.newBeforeStock || 0) + unit + " → " + (record.newAfterStock || 0) + unit;
  }

  if (type === "adjust") {
    const adjustQuantity = Number(record.adjustQuantity || 0);
    return (record.beforeStock || 0) + unit + " → " + (record.afterStock || 0) + unit +
      "，差异 " + (adjustQuantity > 0 ? "+" : "") + adjustQuantity + unit;
  }

  return (record.beforeStock || 0) + unit + " → " + (record.afterStock || 0) + unit;
}

function buildSizeText(record, type) {
  if (type === "exchange") {
    return "旧：" + (record.oldSize || "") + "；新：" + (record.newSize || "");
  }

  return record.size || "";
}

async function getCurrentUser(openid) {
  const userRes = await db.collection("users")
    .where({
      openid: openid,
      status: "active"
    })
    .limit(1)
    .get();

  if (!userRes.data || userRes.data.length === 0) {
    return null;
  }

  return userRes.data[0];
}

async function getAllRecords(where) {
  let records = [];
  let skip = 0;

  while (records.length < MAX_EXPORT_COUNT) {
    const res = await db.collection("stock_records")
      .where(where)
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

function buildRows(records) {
  return records.map(record => {
    const type = normalizeRecordType(record);

    return {
      "时间": formatDateTime(record.createdAt),
      "类型": getTypeText(type),
      "物品名称": record.itemName || "",
      "分类": record.category || "",
      "尺码": buildSizeText(record, type),
      "数量": Number(record.quantity || 0),
      "单位": record.unit || "",
      "操作人": record.operatorName || "",
      "原因": record.reason || "",
      "备注": record.remark || "",
      "库存变化": buildStockChange(record, type)
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
    return '<c r="' + cellRef + '"><v>' + value + '</v></c>';
  }

  return '<c r="' + cellRef + '" t="inlineStr"><is><t>' +
    escapeXml(value) +
    "</t></is></c>";
}

function buildSheetXml(rows) {
  const headers = ["时间", "类型", "物品名称", "分类", "尺码", "数量", "单位", "操作人", "原因", "备注", "库存变化"];
  const widths = [18, 10, 24, 16, 18, 10, 10, 14, 24, 28, 36];
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
        "<sheets><sheet name=\"出入库记录\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>"
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

  const type = trimText(event && event.type);
  const dateType = trimText(event && event.dateType) || "all";
  const startDate = trimText(event && event.startDate);
  const endDate = trimText(event && event.endDate);
  const keyword = trimText(event && event.keyword).slice(0, 30);

  try {
    const user = await getCurrentUser(openid);

    if (!user) {
      return {
        success: false,
        message: "账号未开通"
      };
    }

    const isAdmin = user.role === "admin";
    const where = {};

    if (type && type !== "in") {
      where.type = type;
    }

    if (!isAdmin) {
      where.operatorOpenid = openid;
    }

    const range = getDateRange(dateType, startDate, endDate);

    if (range && range.error) {
      return {
        success: false,
        message: range.error
      };
    }

    if (range) {
      where.createdAt = _.gte(range.start).and(_.lt(range.end));
    }

    let records = await getAllRecords(where);

    records = records.filter(record => shouldKeepByType(record, type));
    records = records.filter(record => matchRecordItem(record, keyword));

    if (records.length === 0) {
      return {
        success: false,
        message: "暂无可导出记录"
      };
    }

    const rows = buildRows(records);
    const buffer = buildWorkbookBuffer(rows);
    const today = formatDateOnly(new Date());
    const cloudPath = "exports/records/records_" + today + "_" + Date.now() + ".xlsx";

    const uploadRes = await cloud.uploadFile({
      cloudPath: cloudPath,
      fileContent: buffer
    });

    return {
      success: true,
      fileID: uploadRes.fileID,
      fileName: "出入库记录_" + today + ".xlsx",
      fileBase64: buffer.length <= MAX_INLINE_FILE_SIZE ? buffer.toString("base64") : "",
      count: records.length
    };
  } catch (err) {
    console.error("导出出入库记录Excel失败：", err);

    return {
      success: false,
      message: "导出失败",
    };
  }
};
