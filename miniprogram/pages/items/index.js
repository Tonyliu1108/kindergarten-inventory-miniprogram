function trimText(value) {
  return String(value || "").trim();
}

function isNonNegativeIntegerText(value) {
  return /^\d+$/.test(String(value || "").trim());
}

// 清理搜索文字
function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\s+/g, "");
}

// 顺序模糊匹配
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

// 判断物品是否匹配搜索词
function matchSkuItem(item, keyword) {
  var key = normalizeText(keyword);

  if (!key) return true;

  var itemName = normalizeText(item.itemName);
  var category = normalizeText(item.category);
  var size = normalizeText(item.size);
  var unit = normalizeText(item.unit);
  var location = normalizeText(item.location);

  var fullText = itemName + category + size + unit + location;

  if (fullText.indexOf(key) !== -1) {
    return true;
  }

  if (isSubsequence(key, fullText)) {
    return true;
  }

  return false;
}

function leaveItemsPage() {
  var pages = getCurrentPages();

  if (pages.length > 1) {
    wx.navigateBack();
    return;
  }

  wx.redirectTo({
    url: "/pages/dashboard/index"
  });
}

Page({
  data: {
    items: [],
    displayItems: [],
    keyword: "",
    loading: false,
    currentUser: null,
    accessChecked: false,

    itemName: "",
    category: "",
    size: "",
    stock: "",
    safetyStock: "",
    unit: "",
    location: "",
    receiptFileID: "",
    receiptFileName: "",
    tempReceiptId: "",
    receiptTempFilePath: "",
    receiptUploading: false,

    adding: false,
    editing: false,
    deleting: false,
    editingSkuId: "",
    editMode: false,
    showSkuForm: false
  },

  onLoad: function () {
    this._skipNextShowAccessCheck = true;
    this.checkAdminAccess();
  },

  onShow: function () {
    if (this._skipNextShowAccessCheck) {
      this._skipNextShowAccessCheck = false;
      return;
    }

    this.checkAdminAccess();
  },

  onPullDownRefresh: function () {
    if (!this.data.currentUser || this.data.currentUser.role !== "admin") {
      wx.stopPullDownRefresh();
      return;
    }

    this.getItems(function () {
      wx.stopPullDownRefresh();
    });
  },

  checkAdminAccess: function () {
    var that = this;

    if (that._accessChecking) {
      return;
    }

    that._accessChecking = true;

    wx.cloud.callFunction({
      name: "login"
    })
      .then(function (res) {
        var result = res.result || {};
        var user = result.user || null;

        if (!result.success || !user || user.role !== "admin") {
          that.setData({
            currentUser: user,
            accessChecked: true,
            loading: false
          });

          wx.showToast({
            title: "只有管理员可以进入物品管理",
            icon: "none"
          });

          setTimeout(leaveItemsPage, 800);
          return;
        }

        that.setData({
          currentUser: user,
          accessChecked: true
        });

        that.getItems();
      })
      .catch(function (err) {
        console.error("检查物品管理权限失败：", err);

        that.setData({
          currentUser: null,
          accessChecked: true,
          loading: false
        });

        wx.showToast({
          title: "权限检查失败",
          icon: "none"
        });

        setTimeout(leaveItemsPage, 800);
      })
      .finally(function () {
        that._accessChecking = false;
      });
  },

  refreshDisplayItems: function (items, keyword) {
    var list = items || [];
    var key = keyword || "";
    var displayItems = [];

    for (var i = 0; i < list.length; i++) {
      if (matchSkuItem(list[i], key)) {
        displayItems.push(list[i]);
      }
    }

    return displayItems;
  },

  getItems: function (callback) {
    var that = this;

    if (that._itemsLoading) {
      if (callback) callback();
      return;
    }

    that._itemsLoading = true;

    that.setData({
      loading: true
    });

    var MAX_LIMIT = 100;
    var allData = [];

    function getBatch(skip) {
      return wx.cloud.callFunction({
        name: "getSkus",
        data: {
          mode: "manage",
          skip: skip,
          limit: MAX_LIMIT
        }
      })
        .then(function (res) {
          var result = res.result || {};

          if (!result.success) {
            return Promise.reject(new Error(result.message || "获取物品失败"));
          }

          allData = allData.concat(result.items || []);

          if (result.hasMore) {
            return getBatch(skip + MAX_LIMIT);
          }

          var items = [];

          for (var i = 0; i < allData.length; i++) {
            var item = allData[i];

            var status = item.status || "active";

            item.status = status;
            item.statusText = status === "active" ? "启用中" : "已停用";
            item.statusClass = status === "active" ? "active" : "disabled";

            items.push(item);
          }

          var displayItems = that.refreshDisplayItems(items, that.data.keyword);

          that.setData({
            items: items,
            displayItems: displayItems,
            loading: false
          });

          if (callback) callback();
          that._itemsLoading = false;
        });
    }

    getBatch(0).catch(function (err) {
      console.error("获取物品失败：", err);

      that.setData({
        loading: false
      });

      wx.showToast({
        title: "获取物品失败",
        icon: "none"
      });

      if (callback) callback();
    }).finally(function () {
      that._itemsLoading = false;
    });
  },

  onSearchInput: function (e) {
    var keyword = String(e.detail.value || "").trim();
  
    if (keyword.length > 20) {
      keyword = keyword.slice(0, 20);
    }
  
    // 关键修复：如果搜索框被删空，直接恢复完整物品列表
    if (!keyword) {
      this.setData({
        keyword: "",
        displayItems: this.data.items
      });
      return;
    }
  
    var displayItems = this.refreshDisplayItems(this.data.items, keyword);
  
    this.setData({
      keyword: keyword,
      displayItems: displayItems
    });
  },
  
  clearSearch: function () {
    this.setData({
      keyword: "",
      displayItems: this.data.items
    });
  },
  
  // 点击“新增物品”按钮，展开新增表单
  showAddForm: function () {
  
    this.setData({
      showSkuForm: true,
      editMode: false,
      editingSkuId: "",
      itemName: "",
      category: "",
      size: "",
      stock: "",
      safetyStock: "",
      unit: "",
      location: "",
      receiptFileID: "",
      receiptFileName: "",
      tempReceiptId: "",
      receiptTempFilePath: "",
      receiptUploading: false
    });
  
    wx.pageScrollTo({
      scrollTop: 0,
      duration: 300
    });
  },
  
  onItemNameInput: function (e) {
    this.setData({
      itemName: e.detail.value
    });
  },

  onCategoryInput: function (e) {
    this.setData({
      category: e.detail.value
    });
  },

  onSizeInput: function (e) {
    this.setData({
      size: e.detail.value
    });
  },

  onStockInput: function (e) {
    this.setData({
      stock: e.detail.value
    });
  },

  onSafetyStockInput: function (e) {
    this.setData({
      safetyStock: e.detail.value
    });
  },

  onUnitInput: function (e) {
    this.setData({
      unit: e.detail.value
    });
  },

  onLocationInput: function (e) {
    this.setData({
      location: e.detail.value
    });
  },

  resetForm: function () {
    this.setData({
      itemName: "",
      category: "",
      size: "",
      stock: "",
      safetyStock: "",
      unit: "",
      location: "",
      receiptFileID: "",
      receiptFileName: "",
      tempReceiptId: "",
      receiptTempFilePath: "",
      receiptUploading: false,
      editMode: false,
      editingSkuId: "",
      showSkuForm: false
    });
  },

  findItemById: function (skuId) {
    var list = this.data.items || [];

    for (var i = 0; i < list.length; i++) {
      if (list[i]._id === skuId) {
        return list[i];
      }
    }

    return null;
  },

  startEditSku: function (e) {
    var skuId = e.currentTarget.dataset.id;
    var item = this.findItemById(skuId);

    if (!item) {
      wx.showToast({
        title: "物品信息异常",
        icon: "none"
      });
      return;
    }

    this.setData({
      showSkuForm: true,
      editMode: true,
      editingSkuId: item._id,
      itemName: item.itemName || "",
      category: item.category || "",
      size: item.size || "",
      stock: String(item.stock || 0),
      safetyStock: String(item.safetyStock || 0),
      unit: item.unit || "",
      location: item.location || "",
      receiptFileID: "",
      receiptFileName: "",
      tempReceiptId: "",
      receiptTempFilePath: "",
      receiptUploading: false
    });

    wx.pageScrollTo({
      scrollTop: 0,
      duration: 300
    });
  },

  cancelEdit: function () {
    if (this.data.receiptUploading) {
      wx.showToast({
        title: "采购清单上传中",
        icon: "none"
      });
      return;
    }

    this.resetForm();
  },

  submitSku: function () {
    if (this.data.editMode) {
      this.submitUpdateSkuInfo();
    } else {
      this.submitAddSku();
    }
  },

  buildReceiptCloudPath: function (filePath) {
    var extMatch = String(filePath || "").match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
    var ext = extMatch ? extMatch[1].toLowerCase() : "jpg";

    return "purchase_receipts/add_sku_" + Date.now() + "_" +
      Math.floor(Math.random() * 1000000) + "." + ext;
  },

  chooseReceiptImage: function () {
    var that = this;

    if (that.data.receiptUploading || that.data.adding || that.data.editing) return;

    var handleFile = function (filePath) {
      if (!filePath) return;
      that.uploadReceiptImage(filePath);
    };

    if (wx.chooseMedia) {
      wx.chooseMedia({
        count: 1,
        mediaType: ["image"],
        sourceType: ["album", "camera"],
        success: function (res) {
          var file = res.tempFiles && res.tempFiles[0];
          handleFile(file && file.tempFilePath);
        },
        fail: function (err) {
          if (err && err.errMsg && err.errMsg.indexOf("cancel") !== -1) return;
          console.error("选择采购清单图片失败：", err);
          wx.showToast({
            title: "选择图片失败",
            icon: "none"
          });
        }
      });
      return;
    }

    wx.chooseImage({
      count: 1,
      sourceType: ["album", "camera"],
      success: function (res) {
        handleFile(res.tempFilePaths && res.tempFilePaths[0]);
      },
      fail: function (err) {
        if (err && err.errMsg && err.errMsg.indexOf("cancel") !== -1) return;
        console.error("选择采购清单图片失败：", err);
        wx.showToast({
          title: "选择图片失败",
          icon: "none"
        });
      }
    });
  },

  uploadReceiptImage: function (filePath) {
    var that = this;
    var cloudPath = that.buildReceiptCloudPath(filePath);
    var uploadedFileID = "";

    that.setData({
      receiptUploading: true,
      receiptFileID: "",
      receiptFileName: cloudPath,
      tempReceiptId: "",
      receiptTempFilePath: filePath
    });

    wx.showLoading({
      title: "上传凭证中"
    });

    wx.cloud.uploadFile({
      cloudPath: cloudPath,
      filePath: filePath
    })
      .then(function (res) {
        if (!res.fileID) {
          return Promise.reject(new Error("未获取到文件ID"));
        }

        uploadedFileID = res.fileID;

        return wx.cloud.callFunction({
          name: "createTempPurchaseReceipt",
          data: {
            fileID: res.fileID,
            fileName: cloudPath,
            source: "addSkuTemp"
          }
        })
          .then(function (tempRes) {
            var result = tempRes.result || {};

            if (!result.success || !result.tempReceiptId) {
              return Promise.reject(new Error(result.message || "保存临时采购清单失败"));
            }

            return {
              fileID: res.fileID,
              tempReceiptId: result.tempReceiptId
            };
          });
      })
      .then(function (result) {
        that.setData({
          receiptFileID: result.fileID,
          tempReceiptId: result.tempReceiptId
        });

        wx.showToast({
          title: "凭证已上传",
          icon: "success"
        });
      })
      .catch(function (err) {
        console.error("上传采购清单图片失败：", err);

        if (uploadedFileID) {
          wx.cloud.deleteFile({
            fileList: [uploadedFileID]
          }).catch(function (deleteErr) {
            console.error("删除未登记采购清单图片失败：", deleteErr);
          });
        }

        that.setData({
          receiptFileID: "",
          receiptFileName: "",
          tempReceiptId: "",
          receiptTempFilePath: ""
        });

        wx.showToast({
          title: "上传凭证失败",
          icon: "none"
        });
      })
      .finally(function () {
        wx.hideLoading();
        that.setData({
          receiptUploading: false
        });
      });
  },

  previewReceiptImage: function () {
    var url = this.data.receiptTempFilePath || this.data.receiptFileID;

    if (!url) return;

    wx.previewImage({
      urls: [url],
      current: url
    });
  },

  removeReceiptImage: function () {
    if (this.data.receiptUploading || this.data.adding || this.data.editing) return;

    this.setData({
      receiptFileID: "",
      receiptFileName: "",
      tempReceiptId: "",
      receiptTempFilePath: ""
    });
  },

  submitAddSku: function () {
    var that = this;

    if (that.data.adding) return;

    if (that.data.receiptUploading) {
      wx.showToast({ title: "采购清单上传中", icon: "none" });
      return;
    }

    var cleanItemName = trimText(that.data.itemName);
    var cleanCategory = trimText(that.data.category);
    var cleanSize = trimText(that.data.size);
    var cleanStock = trimText(that.data.stock);
    var cleanSafetyStock = trimText(that.data.safetyStock);
    var cleanUnit = trimText(that.data.unit);
    var cleanLocation = trimText(that.data.location);

    if (!cleanItemName) {
      wx.showToast({ title: "请输入物品名称", icon: "none" });
      return;
    }

    if (cleanItemName.length > 30) {
      wx.showToast({ title: "物品名称最多30个字", icon: "none" });
      return;
    }

    if (!cleanCategory) {
      wx.showToast({ title: "请输入分类", icon: "none" });
      return;
    }

    if (cleanCategory.length > 20) {
      wx.showToast({ title: "分类最多20个字", icon: "none" });
      return;
    }

    if (!cleanSize) {
      wx.showToast({ title: "请输入尺码/规格", icon: "none" });
      return;
    }

    if (cleanSize.length > 20) {
      wx.showToast({ title: "尺码/规格最多20个字", icon: "none" });
      return;
    }

    if (!isNonNegativeIntegerText(cleanStock)) {
      wx.showToast({ title: "库存必须是整数", icon: "none" });
      return;
    }

    if (!isNonNegativeIntegerText(cleanSafetyStock)) {
      wx.showToast({ title: "安全库存必须是整数", icon: "none" });
      return;
    }

    if (!cleanUnit) {
      wx.showToast({ title: "请输入单位", icon: "none" });
      return;
    }

    if (cleanUnit.length > 10) {
      wx.showToast({ title: "单位最多10个字", icon: "none" });
      return;
    }

    if (!cleanLocation) {
      wx.showToast({ title: "请输入位置", icon: "none" });
      return;
    }

    if (cleanLocation.length > 20) {
      wx.showToast({ title: "位置最多20个字", icon: "none" });
      return;
    }

    if (!that.data.receiptFileID) {
      wx.showToast({ title: "请先上传采购清单", icon: "none" });
      return;
    }

    if (!that.data.tempReceiptId) {
      wx.showToast({ title: "采购清单未登记", icon: "none" });
      return;
    }

    wx.showModal({
      title: "确认新增",
      content: "确认新增“" + cleanItemName + " / " + cleanSize + "”吗？\n\n已上传采购清单凭证。",
      success: function (modalRes) {
        if (!modalRes.confirm) return;

        that.setData({
          adding: true
        });

        wx.showLoading({
          title: "新增中"
        });

        wx.cloud.callFunction({
          name: "addSku",
          data: {
            itemName: cleanItemName,
            category: cleanCategory,
            size: cleanSize,
            stock: Number(cleanStock),
            safetyStock: Number(cleanSafetyStock),
            unit: cleanUnit,
            location: cleanLocation,
            receiptFileID: that.data.receiptFileID,
            receiptFileName: that.data.receiptFileName,
            tempReceiptId: that.data.tempReceiptId
          }
        })
          .then(function (res) {

            if (!res.result || !res.result.success) {
              wx.showToast({
                title: res.result && res.result.message ? res.result.message : "新增失败",
                icon: "none"
              });
              return;
            }

            wx.showToast({
              title: "新增成功",
              icon: "success"
            });

            that.resetForm();
            that.getItems();
          })
          .catch(function (err) {
            console.error("调用 addSku 失败：", err);

            wx.showToast({
              title: "新增失败",
              icon: "none"
            });
          })
          .finally(function () {
            wx.hideLoading();

            that.setData({
              adding: false
            });
          });
      }
    });
  },

  submitUpdateSkuInfo: function () {
    var that = this;

    if (that.data.editing) return;

    var editingSkuId = that.data.editingSkuId;
    var cleanItemName = trimText(that.data.itemName);
    var cleanCategory = trimText(that.data.category);
    var cleanSize = trimText(that.data.size);
    var cleanSafetyStock = trimText(that.data.safetyStock);
    var cleanUnit = trimText(that.data.unit);
    var cleanLocation = trimText(that.data.location);

    if (!editingSkuId) {
      wx.showToast({ title: "缺少物品ID", icon: "none" });
      return;
    }

    if (!cleanItemName) {
      wx.showToast({ title: "请输入物品名称", icon: "none" });
      return;
    }

    if (cleanItemName.length > 30) {
      wx.showToast({ title: "物品名称最多30个字", icon: "none" });
      return;
    }

    if (!cleanCategory) {
      wx.showToast({ title: "请输入分类", icon: "none" });
      return;
    }

    if (cleanCategory.length > 20) {
      wx.showToast({ title: "分类最多20个字", icon: "none" });
      return;
    }

    if (!cleanSize) {
      wx.showToast({ title: "请输入尺码/规格", icon: "none" });
      return;
    }

    if (cleanSize.length > 20) {
      wx.showToast({ title: "尺码/规格最多20个字", icon: "none" });
      return;
    }

    if (!isNonNegativeIntegerText(cleanSafetyStock)) {
      wx.showToast({ title: "安全库存必须是整数", icon: "none" });
      return;
    }

    if (!cleanUnit) {
      wx.showToast({ title: "请输入单位", icon: "none" });
      return;
    }

    if (cleanUnit.length > 10) {
      wx.showToast({ title: "单位最多10个字", icon: "none" });
      return;
    }

    if (!cleanLocation) {
      wx.showToast({ title: "请输入位置", icon: "none" });
      return;
    }

    if (cleanLocation.length > 20) {
      wx.showToast({ title: "位置最多20个字", icon: "none" });
      return;
    }

    wx.showModal({
      title: "确认修改",
      content: "确认保存“" + cleanItemName + " / " + cleanSize + "”的修改吗？",
      success: function (modalRes) {
        if (!modalRes.confirm) return;

        that.setData({
          editing: true
        });

        wx.showLoading({
          title: "保存中"
        });

        wx.cloud.callFunction({
          name: "updateSkuInfo",
          data: {
            skuId: editingSkuId,
            itemName: cleanItemName,
            category: cleanCategory,
            size: cleanSize,
            safetyStock: Number(cleanSafetyStock),
            unit: cleanUnit,
            location: cleanLocation
          }
        })
          .then(function (res) {

            if (!res.result || !res.result.success) {
              wx.showToast({
                title: res.result && res.result.message ? res.result.message : "保存失败",
                icon: "none"
              });
              return;
            }

            wx.showToast({
              title: "保存成功",
              icon: "success"
            });

            that.resetForm();
            that.getItems();
          })
          .catch(function (err) {
            console.error("调用 updateSkuInfo 失败：", err);

            wx.showToast({
              title: "保存失败",
              icon: "none"
            });
          })
          .finally(function () {
            wx.hideLoading();

            that.setData({
              editing: false
            });
          });
      }
    });
  },

  toggleSkuStatus: function (e) {
    var that = this;
    var skuId = e.currentTarget.dataset.id;
    var currentStatus = e.currentTarget.dataset.status;
    var nextStatus = currentStatus === "active" ? "disabled" : "active";
    var actionText = nextStatus === "active" ? "启用" : "停用";

    wx.showModal({
      title: "确认" + actionText,
      content: "确定要" + actionText + "这个物品吗？",
      success: function (modalRes) {
        if (!modalRes.confirm) return;

        wx.showLoading({
          title: "处理中"
        });

        wx.cloud.callFunction({
          name: "updateSkuStatus",
          data: {
            skuId: skuId,
            status: nextStatus
          }
        })
          .then(function (res) {

            if (!res.result || !res.result.success) {
              wx.showToast({
                title: res.result && res.result.message ? res.result.message : "操作失败",
                icon: "none"
              });
              return;
            }

            wx.showToast({
              title: res.result.message || "操作成功",
              icon: "success"
            });

            that.getItems();
          })
          .catch(function (err) {
            console.error("调用 updateSkuStatus 失败：", err);

            wx.showToast({
              title: "操作失败",
              icon: "none"
            });
          })
          .finally(function () {
            wx.hideLoading();
          });
      }
    });
  },

  deleteSku: function (e) {
    var that = this;
    var skuId = e.currentTarget.dataset.id;
    var item = that.findItemById(skuId);

    if (!skuId || !item) {
      wx.showToast({
        title: "物品信息异常",
        icon: "none"
      });
      return;
    }

    if (that.data.deleting) return;

    wx.showModal({
      title: "确认删除",
      content: "确定删除“" + item.itemName + " / " + item.size + "”吗？删除后不会在物品列表和库存列表显示。",
      confirmText: "删除",
      confirmColor: "#e64340",
      success: function (modalRes) {
        if (!modalRes.confirm) return;

        that.setData({
          deleting: true
        });

        wx.showLoading({
          title: "删除中"
        });

        wx.cloud.callFunction({
          name: "deleteSku",
          data: {
            skuId: skuId
          }
        })
          .then(function (res) {

            if (!res.result || !res.result.success) {
              wx.showToast({
                title: res.result && res.result.message ? res.result.message : "删除失败",
                icon: "none"
              });
              return;
            }

            wx.showToast({
              title: "删除成功",
              icon: "success"
            });

            if (that.data.editingSkuId === skuId) {
              that.resetForm();
            }

            that.getItems();
          })
          .catch(function (err) {
            console.error("调用 deleteSku 失败：", err);

            wx.showToast({
              title: "删除失败",
              icon: "none"
            });
          })
          .finally(function () {
            wx.hideLoading();

            that.setData({
              deleting: false
            });
          });
      }
    });
  }
});
