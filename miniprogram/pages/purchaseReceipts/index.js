function trimText(value) {
  return String(value || "").trim();
}

function leavePage() {
  var pages = getCurrentPages();

  if (pages.length > 1) {
    wx.navigateBack();
    return;
  }

  wx.redirectTo({
    url: "/pages/dashboard/index"
  });
}

function padNumber(value) {
  return value < 10 ? "0" + value : String(value);
}

function formatDate(value) {
  if (!value) return "";

  var date = null;

  if (value instanceof Date) {
    date = value;
  } else if (typeof value === "string" || typeof value === "number") {
    date = new Date(value);
  } else if (value && value.$date) {
    date = new Date(value.$date);
  }

  if (!date || isNaN(date.getTime())) {
    return "";
  }

  return date.getFullYear() + "-" +
    padNumber(date.getMonth() + 1) + "-" +
    padNumber(date.getDate()) + " " +
    padNumber(date.getHours()) + ":" +
    padNumber(date.getMinutes());
}

function formatToday() {
  var date = new Date();
  return date.getFullYear() + "-" + padNumber(date.getMonth() + 1) + "-" + padNumber(date.getDate());
}

function buildCloudPath(tempFilePath) {
  var ext = "jpg";
  var match = String(tempFilePath || "").match(/\.([a-zA-Z0-9]+)(\?.*)?$/);

  if (match && match[1]) {
    ext = match[1].toLowerCase();
  }

  return "purchase_receipts/" + Date.now() + "_" + Math.floor(Math.random() * 1000000) + "." + ext;
}

Page({
  data: {
    accessChecked: false,
    currentUser: null,
    loading: false,
    uploading: false,
    deleting: false,
    receipts: [],

    selectedImagePath: "",
    selectedFileName: "",
    purchaseDate: "",
    supplier: "",
    remark: ""
  },

  onLoad: function () {
    this.checkAdminAccess();
  },

  onShow: function () {
    if (this.data.accessChecked && this.data.currentUser && this.data.currentUser.role === "admin") {
      this.getReceipts();
    }
  },

  onPullDownRefresh: function () {
    if (!this.data.currentUser || this.data.currentUser.role !== "admin") {
      wx.stopPullDownRefresh();
      return;
    }

    this.getReceipts(function () {
      wx.stopPullDownRefresh();
    });
  },

  checkAdminAccess: function () {
    var that = this;

    that.setData({
      loading: true
    });

    wx.cloud.callFunction({
      name: "login"
    })
      .then(function (res) {
        var result = res.result || {};
        var user = result.user || null;

        if (!result.success || !user || user.role !== "admin") {
          that.setData({
            accessChecked: true,
            currentUser: user,
            loading: false
          });

          wx.showToast({
            title: "无权限访问",
            icon: "none"
          });

          setTimeout(leavePage, 800);
          return;
        }

        that.setData({
          accessChecked: true,
          currentUser: user,
          purchaseDate: formatToday()
        });

        that.getReceipts();
      })
      .catch(function (err) {
        console.error("检查采购清单权限失败：", err);

        that.setData({
          accessChecked: true,
          currentUser: null,
          loading: false
        });

        wx.showToast({
          title: "权限检查失败",
          icon: "none"
        });

        setTimeout(leavePage, 800);
      });
  },

  getReceipts: function (callback) {
    var that = this;

    that.setData({
      loading: true
    });

    wx.cloud.callFunction({
      name: "getPurchaseReceipts"
    })
      .then(function (res) {
        var result = res.result || {};

        if (!result.success) {
          wx.showToast({
            title: result.message || "获取采购清单失败",
            icon: "none"
          });

          that.setData({
            loading: false
          });

          if (callback) callback();
          return;
        }

        that.prepareReceipts(result.receipts || [], callback);
      })
      .catch(function (err) {
        console.error("获取采购清单失败：", err);

        that.setData({
          loading: false
        });

        wx.showToast({
          title: "获取采购清单失败",
          icon: "none"
        });

        if (callback) callback();
      });
  },

  prepareReceipts: function (receipts, callback) {
    var that = this;
    var list = receipts || [];
    var fileList = [];

    for (var i = 0; i < list.length; i++) {
      list[i].createdAtText = formatDate(list[i].createdAt);
      list[i].purchaseDateText = list[i].purchaseDate || "未填写";
      list[i].supplierText = list[i].supplier || "未填写";
      list[i].remarkText = list[i].remark || "无";
      list[i].previewUrl = list[i].fileID || "";

      if (list[i].fileID) {
        fileList.push(list[i].fileID);
      }
    }

    if (fileList.length === 0) {
      that.setData({
        receipts: list,
        loading: false
      });
      if (callback) callback();
      return;
    }

    wx.cloud.getTempFileURL({
      fileList: fileList
    })
      .then(function (res) {
        var map = {};
        var tempList = res.fileList || [];

        for (var j = 0; j < tempList.length; j++) {
          if (tempList[j].fileID && tempList[j].tempFileURL) {
            map[tempList[j].fileID] = tempList[j].tempFileURL;
          }
        }

        for (var k = 0; k < list.length; k++) {
          if (map[list[k].fileID]) {
            list[k].previewUrl = map[list[k].fileID];
          }
        }

        that.setData({
          receipts: list,
          loading: false
        });

        if (callback) callback();
      })
      .catch(function (err) {
        console.error("获取采购清单临时链接失败：", err);

        that.setData({
          receipts: list,
          loading: false
        });

        if (callback) callback();
      });
  },

  chooseReceiptImage: function () {
    var that = this;

    if (wx.chooseMedia) {
      wx.chooseMedia({
        count: 1,
        mediaType: ["image"],
        sourceType: ["album", "camera"],
        success: function (res) {
          var tempFile = res.tempFiles && res.tempFiles[0];
          var path = tempFile && tempFile.tempFilePath;

          if (path) {
            that.setData({
              selectedImagePath: path,
              selectedFileName: buildCloudPath(path).split("/").pop()
            });
          }
        }
      });
      return;
    }

    wx.chooseImage({
      count: 1,
      sourceType: ["album", "camera"],
      success: function (res) {
        var path = res.tempFilePaths && res.tempFilePaths[0];

        if (path) {
          that.setData({
            selectedImagePath: path,
            selectedFileName: buildCloudPath(path).split("/").pop()
          });
        }
      }
    });
  },

  clearSelectedImage: function () {
    this.setData({
      selectedImagePath: "",
      selectedFileName: ""
    });
  },

  onPurchaseDateChange: function (e) {
    this.setData({
      purchaseDate: e.detail.value
    });
  },

  onSupplierInput: function (e) {
    this.setData({
      supplier: e.detail.value
    });
  },

  onRemarkInput: function (e) {
    this.setData({
      remark: e.detail.value
    });
  },

  submitReceipt: function () {
    var that = this;
    var imagePath = that.data.selectedImagePath;

    if (!imagePath) {
      wx.showToast({
        title: "请先选择图片",
        icon: "none"
      });
      return;
    }

    if (that.data.uploading) return;

    var cloudPath = buildCloudPath(imagePath);
    var fileName = cloudPath.split("/").pop();
    var uploadedFileID = "";

    that.setData({
      uploading: true
    });

    wx.showLoading({
      title: "正在上传",
      mask: true
    });

    wx.cloud.uploadFile({
      cloudPath: cloudPath,
      filePath: imagePath
    })
      .then(function (uploadRes) {
        if (!uploadRes.fileID) {
          return Promise.reject(new Error("未获取到文件ID"));
        }

        uploadedFileID = uploadRes.fileID;

        return wx.cloud.callFunction({
          name: "addPurchaseReceipt",
          data: {
            fileID: uploadRes.fileID,
            fileName: fileName,
            purchaseDate: trimText(that.data.purchaseDate),
            supplier: trimText(that.data.supplier),
            remark: trimText(that.data.remark)
          }
        });
      })
      .then(function (res) {
        var result = res.result || {};

        if (!result.success) {
          return Promise.reject(new Error(result.message || "保存采购清单失败"));
        }

        wx.showToast({
          title: "上传成功",
          icon: "success"
        });

        that.setData({
          selectedImagePath: "",
          selectedFileName: "",
          supplier: "",
          remark: "",
          purchaseDate: formatToday()
        });

        that.getReceipts();
      })
      .catch(function (err) {
        console.error("上传采购清单失败：", err);

        if (uploadedFileID) {
          wx.cloud.deleteFile({
            fileList: [uploadedFileID]
          }).catch(function (deleteErr) {
            console.error("删除未登记采购清单图片失败：", deleteErr);
          });
        }

        wx.showToast({
          title: err.message || "上传失败",
          icon: "none"
        });
      })
      .finally(function () {
        wx.hideLoading();

        that.setData({
          uploading: false
        });
      });
  },

  previewImage: function (e) {
    var url = e.currentTarget.dataset.url;

    if (!url) return;

    wx.previewImage({
      current: url,
      urls: [url]
    });
  },

  deleteReceipt: function (e) {
    var that = this;
    var id = e.currentTarget.dataset.id;

    if (!id || that.data.deleting) return;

    wx.showModal({
      title: "删除采购清单",
      content: "删除后列表中不再显示，但数据库会保留删除记录。",
      confirmText: "删除",
      confirmColor: "#e64340",
      success: function (modalRes) {
        if (!modalRes.confirm) return;

        that.setData({
          deleting: true
        });

        wx.cloud.callFunction({
          name: "deletePurchaseReceipt",
          data: {
            receiptId: id
          }
        })
          .then(function (res) {
            var result = res.result || {};

            if (!result.success) {
              return Promise.reject(new Error(result.message || "删除失败"));
            }

            wx.showToast({
              title: "已删除",
              icon: "success"
            });

            that.getReceipts();
          })
          .catch(function (err) {
            console.error("删除采购清单失败：", err);

            wx.showToast({
              title: err.message || "删除失败",
              icon: "none"
            });
          })
          .finally(function () {
            that.setData({
              deleting: false
            });
          });
      }
    });
  }
});
