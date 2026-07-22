// 清理搜索文字：去掉空格，统一小写
function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\s+/g, "");
}

// 判断 keyword 里的字，是否按顺序出现在 target 里
function isSubsequence(keyword, target) {
  keyword = normalizeText(keyword);
  target = normalizeText(target);

  if (!keyword) return true;

  var j = 0;

  for (var i = 0; i < target.length && j < keyword.length; i++) {
    if (target[i] === keyword[j]) {
      j++;
    }
  }

  return j === keyword.length;
}

// 判断一条出入库记录是否匹配搜索词
function matchRecordItem(item, keyword) {
  var key = normalizeText(keyword);

  if (!key) return true;

  var itemName = normalizeText(item.itemName);
  var category = normalizeText(item.category);
  var size = normalizeText(item.size);
  var operatorName = normalizeText(item.operatorName);
  var reason = normalizeText(item.reason);
  var remark = normalizeText(item.remark);
  var typeText = normalizeText(item.typeText);

  var fullText = itemName + category + size + operatorName + reason + remark + typeText;

  if (fullText.indexOf(key) !== -1) {
    return true;
  }

  if (isSubsequence(key, fullText)) {
    return true;
  }

  return false;
}

function normalizeRecordType(item) {
  var type = item && item.type ? String(item.type) : "";
  var reason = item && item.reason ? String(item.reason) : "";
  var beforeStock = Number(item && item.beforeStock);
  var afterStock = Number(item && item.afterStock);
  var quantity = Number(item && item.quantity);

  if (type === "add" || type === "create" || type === "new" || type === "addSku") {
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

function formatDateOnly(date) {
  var y = date.getFullYear();
  var m = String(date.getMonth() + 1).padStart(2, "0");
  var d = String(date.getDate()).padStart(2, "0");

  return y + "-" + m + "-" + d;
}

Page({
  data: {
    records: [],
    displayRecords: [],
    keyword: "",

    typeList: ["全部", "出库", "入库/新增", "换码", "盘点"],
    typeValueList: ["", "out", "in", "exchange", "adjust"],
    typeIndex: 0,

    dateList: ["全部", "今天", "近7天", "近30天", "自定义"],
    dateValueList: ["all", "today", "7days", "30days", "custom"],
    dateIndex: 0,
    customStartDate: "",
    customEndDate: "",
    todayDate: formatDateOnly(new Date()),

    loading: false,
    exporting: false,
    currentUser: null
  },

  onLoad: function (options) {
    this.setData({
      todayDate: formatDateOnly(new Date())
    });

    var type = options && options.type ? options.type : "";
    var dateType = options && options.dateType ? options.dateType : "";
  
    var typeIndex = 0;
    var dateIndex = 0;
  
    if (type) {
      for (var i = 0; i < this.data.typeValueList.length; i++) {
        if (this.data.typeValueList[i] === type) {
          typeIndex = i;
          break;
        }
      }
    }
  
    if (dateType) {
      for (var j = 0; j < this.data.dateValueList.length; j++) {
        if (this.data.dateValueList[j] === dateType) {
          dateIndex = j;
          break;
        }
      }
    }
  
    this.setData({
      typeIndex: typeIndex,
      dateIndex: dateIndex
    });
  
    this._skipNextShowRefresh = true;
    this.getRecords();
  },
  onShow: function () {
    if (this._skipNextShowRefresh) {
      this._skipNextShowRefresh = false;
      return;
    }

    this.getRecords();
  },

  onPullDownRefresh: function () {
    var that = this;

    that.getRecords(function () {
      wx.stopPullDownRefresh();
    });
  },

  getRecords: function (callback) {
    var that = this;

    if (that.data.loading) {
      if (callback) callback();
      return;
    }

    that.setData({
      loading: true
    });

    var type = that.data.typeValueList[that.data.typeIndex];
    var dateType = that.data.dateValueList[that.data.dateIndex];
    var startDate = that.data.customStartDate || "";
    var endDate = that.data.customEndDate || "";

    if (dateType === "custom" && !that.validateCustomDateRange(false)) {
      that.setData({
        loading: false,
        records: [],
        displayRecords: []
      });
      if (callback) callback();
      return;
    }

    wx.cloud.callFunction({
      name: "getRecords",
      data: {
        type: type,
        dateType: dateType,
        startDate: startDate,
        endDate: endDate,
        limit: 200
      }
    })
      .then(function (res) {

        if (!res.result || !res.result.success) {
          wx.showToast({
            title: res.result && res.result.message ? res.result.message : "获取记录失败",
            icon: "none"
          });

          that.setData({
            loading: false
          });

          if (callback) callback();
          return;
        }

        var records = res.result.records || [];

        for (var i = 0; i < records.length; i++) {
          records[i].displayType = normalizeRecordType(records[i]);
          records[i].typeText = that.getTypeText(records[i].displayType);
          records[i].typeClass = that.getTypeClass(records[i].displayType);
          records[i].timeText = that.formatTime(records[i].createdAt);
        }

        var displayRecords = [];

        for (var j = 0; j < records.length; j++) {
          if (matchRecordItem(records[j], that.data.keyword)) {
            displayRecords.push(records[j]);
          }
        }

        that.setData({
          records: records,
          displayRecords: displayRecords,
          currentUser: res.result.user,
          loading: false
        });

        if (callback) callback();
      })
      .catch(function (err) {
        console.error("调用 getRecords 失败：", err);

        that.setData({
          loading: false
        });

        wx.showToast({
          title: "获取记录失败",
          icon: "none"
        });

        if (callback) callback();
      });
  },

  getTypeText: function (type) {
    if (type === "out") return "出库";
    if (type === "in") return "入库";
    if (type === "add") return "新增";
    if (type === "exchange") return "换码";
    if (type === "adjust") return "盘点";
  
    return "记录";
  },

  getTypeClass: function (type) {
    if (type === "out") return "out";
    if (type === "in") return "in";
    if (type === "add") return "add";
    if (type === "exchange") return "exchange";
    if (type === "adjust") return "adjust";

    return "";
  },

  formatTime: function (value) {
    if (!value) return "";

    var date;

    if (value instanceof Date) {
      date = value;
    } else if (value.$date) {
      date = new Date(value.$date);
    } else {
      date = new Date(value);
    }

    if (Number.isNaN(date.getTime())) return "";

    var y = date.getFullYear();
    var m = String(date.getMonth() + 1).padStart(2, "0");
    var d = String(date.getDate()).padStart(2, "0");
    var h = String(date.getHours()).padStart(2, "0");
    var min = String(date.getMinutes()).padStart(2, "0");

    return y + "-" + m + "-" + d + " " + h + ":" + min;
  },

  onSearchInput: function (e) {
    var keyword = (e.detail.value || "").trim();
  
    if (keyword.length > 20) {
      keyword = keyword.slice(0, 20);
    }
  
    var records = this.data.records || [];
    var displayRecords = [];

    for (var i = 0; i < records.length; i++) {
      if (matchRecordItem(records[i], keyword)) {
        displayRecords.push(records[i]);
      }
    }

    this.setData({
      keyword: keyword,
      displayRecords: displayRecords
    });
  },

  clearSearch: function () {
    this.setData({
      keyword: "",
      displayRecords: this.data.records
    });
  },

  onTypeChange: function (e) {
    this.setData({
      typeIndex: Number(e.detail.value)
    });

    this.getRecords();
  },

  onDateChange: function (e) {
    var index = Number(e.currentTarget.dataset.index);

    this.setData({
      dateIndex: index
    });

    if (this.data.dateValueList[index] === "custom" && !this.validateCustomDateRange(false)) {
      this.setData({
        records: [],
        displayRecords: []
      });
      return;
    }

    this.getRecords();
  },

  onCustomStartDateChange: function (e) {
    this.setData({
      customStartDate: e.detail.value || ""
    });

    if (this.data.dateValueList[this.data.dateIndex] === "custom" && this.validateCustomDateRange(false)) {
      this.getRecords();
    }
  },

  onCustomEndDateChange: function (e) {
    this.setData({
      customEndDate: e.detail.value || ""
    });

    if (this.data.dateValueList[this.data.dateIndex] === "custom" && this.validateCustomDateRange(false)) {
      this.getRecords();
    }
  },

  validateCustomDateRange: function (showToast) {
    var dateType = this.data.dateValueList[this.data.dateIndex];

    if (dateType !== "custom") {
      return true;
    }

    var startDate = this.data.customStartDate || "";
    var endDate = this.data.customEndDate || "";
    var todayDate = this.data.todayDate || formatDateOnly(new Date());
    var message = "";

    if (!startDate || !endDate) {
      message = "请选择开始和结束日期";
    } else if (startDate > todayDate) {
      message = "开始日期不能超过今天";
    } else if (endDate > todayDate) {
      message = "结束日期不能超过今天";
    } else if (startDate > endDate) {
      message = "开始日期不能晚于结束日期";
    }

    if (message) {
      if (showToast) {
        wx.showToast({
          title: message,
          icon: "none"
        });
      }
      return false;
    }

    return true;
  },

  exportExcel: function () {
    var that = this;

    if (that.data.exporting) return;

    if (!that.validateCustomDateRange(true)) {
      return;
    }

    var type = that.data.typeValueList[that.data.typeIndex];
    var dateType = that.data.dateValueList[that.data.dateIndex];
    var keyword = that.data.keyword || "";
    var startDate = that.data.customStartDate || "";
    var endDate = that.data.customEndDate || "";

    that.setData({
      exporting: true
    });

    wx.showLoading({
      title: "正在导出",
      mask: true
    });

    wx.cloud.callFunction({
      name: "exportRecordsExcel",
      data: {
        type: type,
        dateType: dateType,
        startDate: startDate,
        endDate: endDate,
        keyword: keyword
      }
    })
      .then(function (res) {
        var result = res.result || {};

        if (!result.success) {
          return Promise.reject(new Error(result.message || "导出失败"));
        }

        if (!result.fileID) {
          return Promise.reject(new Error("导出文件为空"));
        }

        var filePromise = result.fileBase64
          ? that.writeBase64ExcelFile(result.fileBase64)
          : that.downloadExportedExcelFile(result.fileID);

        return filePromise
          .then(function (filePath) {
            return that.openDownloadedExcel(filePath);
          });
      })
      .catch(function (err) {
        console.error("导出Excel失败：", err);

        wx.hideLoading();

        wx.showToast({
          title: err.message || "导出失败",
          icon: "none"
        });
      })
      .finally(function () {
        that.setData({
          exporting: false
        });
      });
  },

  writeBase64ExcelFile: function (fileBase64) {
    var fs = wx.getFileSystemManager();
    var localFilePath = wx.env.USER_DATA_PATH + "/records_export_" + Date.now() + ".xlsx";

    return new Promise(function (resolve, reject) {
      fs.writeFile({
        filePath: localFilePath,
        data: fileBase64,
        encoding: "base64",
        success: function () {
          resolve(localFilePath);
        },
        fail: function (err) {
          reject(new Error("写入导出文件失败：" + (err.errMsg || "")));
        }
      });
    });
  },

  downloadExportedExcelFile: function (fileID) {
    return wx.cloud.downloadFile({
      fileID: fileID
    })
      .then(function (downloadRes) {
        if (!downloadRes.tempFilePath) {
          return Promise.reject(new Error("下载文件为空"));
        }

        return new Promise(function (resolve, reject) {
          wx.saveFile({
            tempFilePath: downloadRes.tempFilePath,
            success: function (saveRes) {
              resolve(saveRes.savedFilePath || downloadRes.tempFilePath);
            },
            fail: function (err) {
              if (err && err.errMsg) {
                console.warn("保存导出文件失败，改用临时文件打开：", err);
              }
              resolve(downloadRes.tempFilePath);
            }
          });
        });
      });
  },

  openDownloadedExcel: function (filePath) {
    return new Promise(function (resolve, reject) {
      wx.openDocument({
        filePath: filePath,
        fileType: "xlsx",
        showMenu: true,
        success: function () {
          wx.hideLoading();

          wx.showToast({
            title: "导出成功",
            icon: "success"
          });

          resolve();
        },
        fail: function (err) {
          reject(new Error("打开Excel失败：" + (err.errMsg || "")));
        }
      });
    });
  }
});
