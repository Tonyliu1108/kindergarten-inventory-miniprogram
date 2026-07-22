const PAGE_SIZE = 20;

// 清理搜索文字：去掉空格，统一小写
function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\s+/g, "");
}

// 判断 keyword 里的字，是否按顺序出现在 target 里
// 例如：keyword = "夏季礼服"，target = "夏季男学生礼服"
// 会返回 true
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

// 判断一条库存记录是否匹配搜索词
function matchInventoryItem(item, keyword) {
  const key = normalizeText(keyword);
  if (!key) return true;

  const itemName = normalizeText(item.itemName);
  const category = normalizeText(item.category);
  const size = normalizeText(item.size);
  const unit = normalizeText(item.unit);
  const location = normalizeText(item.location);

  const fullText = `${itemName}${category}${size}${unit}${location}`;

  // 1. 直接包含：比如搜“礼服”，能搜到“夏季男学生礼服”
  if (fullText.indexOf(key) !== -1) {
    return true;
  }

  // 2. 模糊顺序匹配：比如搜“夏季礼服”，能搜到“夏季男学生礼服”
  if (isSubsequence(key, fullText)) {
    return true;
  }

  return false;
}

function formatDateOnly(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return year + "-" + month + "-" + day;
}

Page({
  data: {
    inventoryList: [],
    displayList: [],
    keyword: "",
    loading: false,
    loadingMore: false,
    exportingInventory: false,
    inventoryExportDateList: ["全部", "今天", "近7天", "近30天", "自定义"],
    inventoryExportDateValueList: ["all", "today", "7days", "30days", "custom"],
    inventoryExportDateIndex: 0,
    inventoryExportStartDate: "",
    inventoryExportEndDate: "",
    todayDate: formatDateOnly(new Date()),
    hasMore: true,
    loadError: false,
    inventorySkip: 0,

    // 当前登录用户
    currentUser: null,
    loginChecked: false
  },

  onLoad() {
    this.setData({
      todayDate: formatDateOnly(new Date())
    });

    this.loadInitialInventory();
  },

  onPullDownRefresh() {
    if (!this.data.currentUser) {
      this.loadInitialInventory(() => {
        wx.stopPullDownRefresh();
      });
      return;
    }

    this.getInventoryList(() => {
      wx.stopPullDownRefresh();
    });
  },

  onReachBottom() {
    if (!this.data.currentUser || this.data.loading || this.data.loadingMore || !this.data.hasMore) {
      return;
    }

    this.loadInventoryPage();
  },

  // 检查当前微信用户是否已在 users 表中开通账号
  leaveInventoryPage() {
    const pages = getCurrentPages();

    if (pages.length > 1) {
      wx.navigateBack();
      return;
    }

    wx.redirectTo({
      url: "/pages/dashboard/index"
    });
  },

  goApply() {
    wx.redirectTo({
      url: "/pages/apply/index"
    });
  },

  buildRegisterModal(rejectedApplication) {
    if (rejectedApplication) {
      return {
        title: "申请已被拒绝",
        content: "拒绝管理员：" + (rejectedApplication.reviewedByName || "管理员") +
          "\n拒绝原因：" + (rejectedApplication.rejectReason || "未填写") +
          "\n\n你可以修改信息后重新提交申请。",
        confirmText: "重新申请"
      };
    }

    return {
      title: "账号未开通",
      content: "当前微信账号尚未开通权限，是否提交开通申请？",
      confirmText: "去申请"
    };
  },

  handleRegisterRequired(result, callback) {
    this.setData({
      loginChecked: true,
      currentUser: null,
      inventoryList: [],
      displayList: [],
      loading: false,
      loadingMore: false,
      hasMore: true,
      loadError: false,
      inventorySkip: 0
    });

    const modalConfig = this.buildRegisterModal(result && result.rejectedApplication);

    wx.showModal({
      title: modalConfig.title,
      content: modalConfig.content,
      confirmText: modalConfig.confirmText,
      cancelText: "稍后",
      success: modalRes => {
        if (modalRes.confirm) {
          wx.redirectTo({
            url: "/pages/apply/index"
          });
          return;
        }

        this.leaveInventoryPage();
      }
    });

    if (callback) callback();
  },

  applyInventoryPageResult(result, isReset, skip, callback) {
    const pageData = result.items || [];
    const inventoryList = isReset ? pageData : this.data.inventoryList.concat(pageData);
    const displayList = inventoryList.filter(item => {
      return matchInventoryItem(item, this.data.keyword);
    });

    this.setData({
      inventoryList,
      displayList,
      loading: false,
      loadingMore: false,
      hasMore: !!result.hasMore,
      inventorySkip: skip + pageData.length
    });

    if (callback) callback();
  },

  loadInventoryUserFallback(result, callback) {
    return wx.cloud.callFunction({
      name: "login"
    })
      .then(loginRes => {
        const loginResult = loginRes.result || {};

        if (loginResult.needRegister) {
          this.handleRegisterRequired(loginResult, callback);
          return;
        }

        if (!loginResult.success || !loginResult.user) {
          throw new Error(loginResult.message || "账号未开通");
        }

        this.setData({
          loginChecked: true,
          currentUser: loginResult.user
        });

        this.applyInventoryPageResult(result, true, 0, callback);
      });
  },

  loadInitialInventory(callback) {
    if (this.data.loading) {
      if (callback) callback();
      return;
    }

    this.setData({
      loading: true,
      loadingMore: false,
      loadError: false,
      inventoryList: [],
      displayList: [],
      hasMore: true,
      inventorySkip: 0
    });

    wx.cloud.callFunction({
      name: "getSkus",
      data: {
        mode: "active",
        skip: 0,
        limit: PAGE_SIZE,
        includeUser: true
      }
    })
      .then(res => {
        const result = res.result || {};

        if (result.needRegister) {
          this.handleRegisterRequired(result, callback);
          return;
        }

        if (!result.success) {
          throw new Error(result.message || "获取库存失败");
        }

        if (!result.user) {
          return this.loadInventoryUserFallback(result, callback);
        }

        this.setData({
          loginChecked: true,
          currentUser: result.user
        });

        this.applyInventoryPageResult(result, true, 0, callback);
      })
      .catch(err => {
        console.error("加载库存首页失败：", err);

        this.setData({
          loginChecked: true,
          currentUser: null,
          loading: false,
          loadingMore: false,
          loadError: true
        });

        wx.showToast({
          title: "获取库存失败",
          icon: "none"
        });

        if (callback) callback();
      });
  },

  checkLogin(callback) {
    wx.cloud.callFunction({
      name: "login",
      success: res => {

        if (!res.result) {
          wx.showToast({
            title: "登录结果为空",
            icon: "none"
          });
          if (callback) callback();
          return;
        }

        // 当前 openid 还没有绑定到 users 表
        if (res.result.needRegister) {
          this.handleRegisterRequired(res.result, callback);
          return;
        }

        // 登录成功
        if (res.result.success) {
          this.setData({
            loginChecked: true,
            currentUser: res.result.user
          });

          wx.showToast({
            title: "欢迎 " + res.result.user.name,
            icon: "none"
          });

          this.getInventoryList(callback);
          return;
        }

        // 其他失败情况
        wx.showToast({
          title: res.result.message || "登录失败",
          icon: "none"
        });
        if (callback) callback();
      },

      fail: err => {
        console.error("调用 login 云函数失败：", err);

        wx.showToast({
          title: "登录失败",
          icon: "none"
        });
        if (callback) callback();
      }
    });
  },

  // 获取库存列表
  getInventoryList(callback) {
    if (!this.data.currentUser) {
      this.setData({
        loading: false,
        loadingMore: false,
        inventoryList: [],
        displayList: [],
        hasMore: true,
        loadError: false,
        inventorySkip: 0
      });

      if (callback) callback();
      return;
    }

    this.loadInventoryPage({
      reset: true,
      callback
    });
  },

  loadInventoryPage(options = {}) {
    if (!this.data.currentUser) {
      if (options.callback) options.callback();
      return;
    }

    const isReset = !!options.reset;

    if (!isReset && (this.data.loading || this.data.loadingMore || !this.data.hasMore)) {
      if (options.callback) options.callback();
      return;
    }

    const skip = isReset ? 0 : this.data.inventorySkip;

    this.setData({
      loading: isReset,
      loadingMore: !isReset,
      loadError: false,
      inventoryList: isReset ? [] : this.data.inventoryList,
      displayList: isReset ? [] : this.data.displayList,
      hasMore: isReset ? true : this.data.hasMore,
      inventorySkip: skip
    });

    wx.cloud.callFunction({
      name: "getSkus",
      data: {
        mode: "active",
        skip,
        limit: PAGE_SIZE
      }
    })
      .then(res => {
        const result = res.result || {};

        if (!result.success) {
          return Promise.reject(new Error(result.message || "获取库存失败"));
        }

        this.applyInventoryPageResult(result, isReset, skip, options.callback);
      })
      .catch(err => {
        console.error("获取库存失败：", err);

        this.setData({
          loading: false,
          loadingMore: false,
          loadError: true
        });

        wx.showToast({
          title: "获取库存失败",
          icon: "none"
        });

        if (options.callback) options.callback();
      });
  },

  // 搜索输入
  onSearchInput(e) {
    const keyword = (e.detail.value || "").trim();

    const displayList = this.data.inventoryList.filter(item => {
      return matchInventoryItem(item, keyword);
    });

    this.setData({
      keyword,
      displayList
    });
  },

  // 清空搜索
  clearSearch() {
    this.setData({
      keyword: "",
      displayList: this.data.inventoryList
    });
  },

  retryLoadInventory() {
    if (!this.data.currentUser) {
      this.loadInitialInventory();
      return;
    }

    this.getInventoryList();
  },

  loadMoreInventory() {
    this.loadInventoryPage();
  },

  onInventoryExportDateChange(e) {
    const index = Number(e.detail.value || 0);

    this.setData({
      inventoryExportDateIndex: index
    });
  },

  onInventoryExportStartDateChange(e) {
    this.setData({
      inventoryExportStartDate: e.detail.value || ""
    });
  },

  onInventoryExportEndDateChange(e) {
    this.setData({
      inventoryExportEndDate: e.detail.value || ""
    });
  },

  exportInventoryExcel() {
    if (this.data.exportingInventory || this.data.loading) return;

    if (!this.data.currentUser || this.data.currentUser.role !== "admin") {
      wx.showToast({
        title: "只有管理员可以导出",
        icon: "none"
      });
      return;
    }

    const dateType = this.data.inventoryExportDateValueList[this.data.inventoryExportDateIndex] || "all";
    const startDate = this.data.inventoryExportStartDate || "";
    const endDate = this.data.inventoryExportEndDate || "";
    const todayDate = this.data.todayDate || formatDateOnly(new Date());

    if (dateType === "custom") {
      if (!startDate || !endDate) {
        wx.showToast({
          title: "请选择开始和结束日期",
          icon: "none"
        });
        return;
      }

      if (startDate > todayDate) {
        wx.showToast({
          title: "开始日期不能超过今天",
          icon: "none"
        });
        return;
      }

      if (endDate > todayDate) {
        wx.showToast({
          title: "结束日期不能超过今天",
          icon: "none"
        });
        return;
      }

      if (startDate > endDate) {
        wx.showToast({
          title: "开始日期不能晚于结束日期",
          icon: "none"
        });
        return;
      }
    }

    this.setData({
      exportingInventory: true
    });

    wx.showLoading({
      title: "正在导出",
      mask: true
    });

    let exportedFileID = "";

    wx.cloud.callFunction({
      name: "exportInventoryExcel",
      data: {
        dateType,
        startDate,
        endDate
      }
    })
      .then(res => {
        const result = res.result || {};

        if (!result.success) {
          throw new Error(result.message || "导出失败");
        }

        if (!result.fileID) {
          throw new Error("导出文件为空");
        }

        exportedFileID = result.fileID;
        if (result.fileBase64) {
          return this.writeBase64InventoryExcelFile(result.fileBase64);
        }

        return this.downloadInventoryExcelFile(exportedFileID);
      })
      .then(filePath => {
        return this.openDownloadedExcel(filePath);
      })
      .catch(err => {
        console.error("导出库存总览失败：", err);

        wx.hideLoading();

        wx.showToast({
          title: err.message || "导出失败",
          icon: "none"
        });
      })
      .finally(() => {
        this.setData({
          exportingInventory: false
        });
      });
  },

  writeBase64InventoryExcelFile(fileBase64) {
    const fs = wx.getFileSystemManager();
    const localFilePath = wx.env.USER_DATA_PATH + "/inventory_export_" + Date.now() + ".xlsx";

    return new Promise((resolve, reject) => {
      fs.writeFile({
        filePath: localFilePath,
        data: fileBase64,
        encoding: "base64",
        success: () => {
          resolve(localFilePath);
        },
        fail: err => {
          reject(new Error("写入导出文件失败：" + (err.errMsg || "")));
        }
      });
    });
  },

  downloadInventoryExcelFile(fileID) {
    const fs = wx.getFileSystemManager();
    const localFilePath = wx.env.USER_DATA_PATH + "/inventory_export_" + Date.now() + ".xlsx";

    return wx.cloud.getTempFileURL({
      fileList: [fileID]
    })
      .then(urlRes => {
        const file = urlRes.fileList && urlRes.fileList[0];
        const tempFileURL = file && file.tempFileURL;

        if (!tempFileURL) {
          throw new Error("获取下载链接失败");
        }

        return new Promise((resolve, reject) => {
          wx.request({
            url: tempFileURL,
            responseType: "arraybuffer",
            success: resolve,
            fail: reject
          });
        });
      })
      .then(requestRes => {
        if (requestRes.statusCode !== 200) {
          throw new Error("下载文件失败：" + requestRes.statusCode);
        }

        if (!requestRes.data) {
          throw new Error("下载文件为空");
        }

        return new Promise((resolve, reject) => {
          fs.writeFile({
            filePath: localFilePath,
            data: requestRes.data,
            success: () => {
              resolve(localFilePath);
            },
            fail: err => {
              reject(new Error("写入导出文件失败：" + (err.errMsg || "")));
            }
          });
        });
      });
  },

  openDownloadedExcel(filePath) {
    return new Promise((resolve, reject) => {
      wx.openDocument({
        filePath: filePath,
        fileType: "xlsx",
        showMenu: true,
        success: () => {
          wx.hideLoading();
          wx.showToast({
            title: "导出成功",
            icon: "success"
          });
          resolve();
        },
        fail: err => {
          reject(new Error("打开Excel失败：" + (err.errMsg || "")));
        }
      });
    });
  },

  findInventoryItem(skuId) {
    const list = this.data.inventoryList || [];

    for (let i = 0; i < list.length; i++) {
      if (list[i]._id === skuId) {
        return list[i];
      }
    }

    return null;
  },

  buildSkuSnapshotParam(skuId) {
    const item = this.findInventoryItem(skuId);

    if (!item) return "";

    const snapshot = {
      _id: item._id,
      itemName: item.itemName || "",
      category: item.category || "",
      size: item.size || "",
      stock: Number(item.stock || 0),
      safetyStock: Number(item.safetyStock || 0),
      unit: item.unit || "",
      location: item.location || "",
      status: item.status || "active"
    };

    try {
      return "&skuSnapshot=" + encodeURIComponent(JSON.stringify(snapshot));
    } catch (err) {
      console.error("生成库存快照失败：", err);
      return "";
    }
  },
  
// 跳转到入库页面
goInbound(e) {
  const skuId = e.currentTarget.dataset.id;


  if (!skuId) {
    wx.showToast({
      title: "物品ID异常",
      icon: "none"
    });
    return;
  }

  wx.navigateTo({
    url: "/pages/inbound/index?skuId=" + skuId + this.buildSkuSnapshotParam(skuId),
    success() {
    },
    fail(err) {
      console.error("入库页面跳转失败：", err);
      wx.showToast({
        title: "打开入库页失败",
        icon: "none"
      });
    },
    complete() {
    }
  });
},

// 跳转到换码页面
goExchange(e) {
  const skuId = e.currentTarget.dataset.id;


  if (!skuId) {
    wx.showToast({
      title: "物品ID异常",
      icon: "none"
    });
    return;
  }

  wx.navigateTo({
    url: "/pages/exchange/index?skuId=" + skuId + this.buildSkuSnapshotParam(skuId),
    success() {
    },
    fail(err) {
      console.error("换码页面跳转失败：", err);
      wx.showToast({
        title: "打开换码页失败",
        icon: "none"
      });
    },
    complete() {
    }
  });
},

// 跳转到出库页面
goOutbound(e) {
  const skuId = e.currentTarget.dataset.id;


  if (!skuId) {
    wx.showToast({
      title: "物品ID异常",
      icon: "none"
    });
    return;
  }

  wx.navigateTo({
    url: "/pages/outbound/index?skuId=" + skuId + this.buildSkuSnapshotParam(skuId),
    success() {
    },
    fail(err) {
      console.error("出库页面跳转失败：", err);
      wx.showToast({
        title: "打开出库页失败",
        icon: "none"
      });
    },
    complete() {
    }
  });
},

// 跳转到库存盘点页面
goStocktake(e) {
  const skuId = e.currentTarget.dataset.id;


  if (!skuId) {
    wx.showToast({
      title: "物品ID异常",
      icon: "none"
    });
    return;
  }

  wx.navigateTo({
    url: "/pages/stocktake/index?skuId=" + skuId + this.buildSkuSnapshotParam(skuId),
    success() {
    },
    fail(err) {
      console.error("盘点页面跳转失败：", err);
      wx.showToast({
        title: "打开盘点页失败",
        icon: "none"
      });
    },
    complete() {
    }
  });
},

// 跳转到出入库记录页面
goRecords() {
  wx.navigateTo({
    url: "/pages/records/index"
  });
},

// 跳转到库存预警页面
goWarnings() {
  wx.navigateTo({
    url: "/pages/warnings/index"
  });
},

// 跳转到物品管理页面
goItems() {
  wx.navigateTo({
    url: "/pages/items/index"
  });
},

// 跳转到用户管理页面
goUsers() {
  wx.navigateTo({
    url: "/pages/users/index"
  });
}
});
