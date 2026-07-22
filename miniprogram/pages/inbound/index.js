function parseSkuSnapshot(options) {
  if (!options || !options.skuSnapshot) return null;

  try {
    const snapshot = JSON.parse(decodeURIComponent(options.skuSnapshot));

    if (!snapshot || !snapshot._id) return null;

    return snapshot;
  } catch (err) {
    console.error("解析库存快照失败：", err);
    return null;
  }
}

Page({
  data: {
    skuId: "",
    sku: null,

    quantity: 1,
    reasonList: [
      "补货",
      "退回",
      "换码退回",
      "盘点调整",
      "其他"
    ],
    reasonIndex: 0,
    remark: "",
    receiptFileID: "",
    receiptFileName: "",
    tempReceiptId: "",
    receiptTempFilePath: "",
    receiptUploading: false,

    submitting: false
  },

  onLoad(options) {
    const skuId = options.skuId;

    if (!skuId) {
      wx.showToast({
        title: "缺少库存ID",
        icon: "none"
      });

      setTimeout(() => {
        wx.navigateBack();
      }, 1000);

      return;
    }

    const skuSnapshot = parseSkuSnapshot(options);

    this.setData({
      skuId,
      sku: skuSnapshot && skuSnapshot._id === skuId ? skuSnapshot : null
    });

    this.getSkuDetail(skuId);
  },

  getSkuDetail(skuId) {
    const hasSnapshot = !!this.data.sku;

    if (!hasSnapshot) {
      wx.showLoading({
        title: "加载中"
      });
    }

    wx.cloud.callFunction({
      name: "getSkus",
      data: {
        mode: "detail",
        skuId
      }
    })
      .then(res => {
        const result = res.result || {};

        if (!result.success) {
          return Promise.reject(new Error(result.message || "获取库存失败"));
        }

        this.setData({
          sku: result.sku
        });
      })
      .catch(err => {
        console.error("获取库存详情失败：", err);

        if (!hasSnapshot) {
          wx.showToast({
            title: "获取库存失败",
            icon: "none"
          });
        }
      })
      .finally(() => {
        if (!hasSnapshot) {
          wx.hideLoading();
        }
      });
  },

  onQuantityInput(e) {
    let value = String(e.detail.value || "").replace(/[^\d]/g, "");
    value = value.replace(/^0+/, "");
  
    if (Number(value) > 200) {
      value = "200";
  
      wx.showToast({
        title: "单次入库最多200",
        icon: "none"
      });
    }
  
    this.setData({
      quantity: value
    });
  
    return value;
  },

  onReasonChange(e) {
    this.setData({
      reasonIndex: Number(e.detail.value)
    });
  },

  onRemarkInput(e) {
    this.setData({
      remark: e.detail.value
    });
  },

  buildReceiptCloudPath(filePath) {
    const extMatch = String(filePath || "").match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
    const ext = extMatch ? extMatch[1].toLowerCase() : "jpg";

    return "purchase_receipts/stock_in_" + Date.now() + "_" +
      Math.floor(Math.random() * 1000000) + "." + ext;
  },

  chooseReceiptImage() {
    const that = this;

    if (that.data.receiptUploading || that.data.submitting) return;

    const handleFile = function (filePath) {
      if (!filePath) return;

      that.uploadReceiptImage(filePath);
    };

    if (wx.chooseMedia) {
      wx.chooseMedia({
        count: 1,
        mediaType: ["image"],
        sourceType: ["album", "camera"],
        success(res) {
          const file = res.tempFiles && res.tempFiles[0];
          handleFile(file && file.tempFilePath);
        },
        fail(err) {
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
      success(res) {
        handleFile(res.tempFilePaths && res.tempFilePaths[0]);
      },
      fail(err) {
        if (err && err.errMsg && err.errMsg.indexOf("cancel") !== -1) return;
        console.error("选择采购清单图片失败：", err);
        wx.showToast({
          title: "选择图片失败",
          icon: "none"
        });
      }
    });
  },

  uploadReceiptImage(filePath) {
    const that = this;
    const cloudPath = that.buildReceiptCloudPath(filePath);
    let uploadedFileID = "";

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
      cloudPath,
      filePath
    })
      .then(res => {
        if (!res.fileID) {
          return Promise.reject(new Error("未获取到文件ID"));
        }

        uploadedFileID = res.fileID;

        return wx.cloud.callFunction({
          name: "createTempPurchaseReceipt",
          data: {
            fileID: res.fileID,
            fileName: cloudPath
          }
        })
          .then(tempRes => {
            const result = tempRes.result || {};

            if (!result.success || !result.tempReceiptId) {
              return Promise.reject(new Error(result.message || "保存临时采购清单失败"));
            }

            return {
              fileID: res.fileID,
              tempReceiptId: result.tempReceiptId
            };
          });
      })
      .then(result => {
        that.setData({
          receiptFileID: result.fileID,
          tempReceiptId: result.tempReceiptId
        });

        wx.showToast({
          title: "凭证已上传",
          icon: "success"
        });
      })
      .catch(err => {
        console.error("上传采购清单图片失败：", err);

        if (uploadedFileID) {
          wx.cloud.deleteFile({
            fileList: [uploadedFileID]
          }).catch(deleteErr => {
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
      .finally(() => {
        wx.hideLoading();
        that.setData({
          receiptUploading: false
        });
      });
  },

  previewReceiptImage() {
    const url = this.data.receiptTempFilePath || this.data.receiptFileID;

    if (!url) return;

    wx.previewImage({
      urls: [url],
      current: url
    });
  },

  removeReceiptImage() {
    if (this.data.receiptUploading || this.data.submitting) return;

    this.setData({
      receiptFileID: "",
      receiptFileName: "",
      tempReceiptId: "",
      receiptTempFilePath: ""
    });
  },

  submitInbound() {
    const {
      sku,
      skuId,
      quantity,
      reasonList,
      reasonIndex,
      remark,
      receiptFileID,
      receiptFileName,
      tempReceiptId,
      receiptUploading,
      submitting
    } = this.data;

    if (submitting) return;

    if (receiptUploading) {
      wx.showToast({
        title: "采购清单上传中",
        icon: "none"
      });
      return;
    }

    if (!sku) {
      wx.showToast({
        title: "库存信息未加载",
        icon: "none"
      });
      return;
    }

    const quantityText = String(quantity || "").trim();

    if (!/^[1-9]\d*$/.test(quantityText)) {
      wx.showToast({
        title: "入库数量必须是正整数",
        icon: "none"
      });
      return;
    }

    const inQuantity = Number(quantityText);
    if (inQuantity > 200) {
      wx.showToast({
        title: "单次入库最多200",
        icon: "none"
      });
      return;
    }
    const selectedReason = reasonList[reasonIndex];
    const cleanRemark = String(remark || "").trim();

    if (selectedReason === "其他" && !cleanRemark) {
      wx.showToast({
        title: "选择其他时必须填写备注",
        icon: "none"
      });
      return;
    }

    if (!receiptFileID) {
      wx.showToast({
        title: "请先上传采购清单",
        icon: "none"
      });
      return;
    }

    if (!tempReceiptId) {
      wx.showToast({
        title: "采购清单未登记",
        icon: "none"
      });
      return;
    }

    wx.showModal({
      title: "确认入库",
      content: `确认入库 ${sku.itemName} ${sku.size}，数量 ${inQuantity}${sku.unit}？\n\n已上传采购清单凭证。`,
      success: modalRes => {
        if (!modalRes.confirm) return;

        this.setData({ submitting: true });

        wx.showLoading({
          title: "提交中"
        });

        wx.cloud.callFunction({
          name: "stockIn",
          data: {
            skuId,
            quantity: inQuantity,
            reason: selectedReason,
            remark: cleanRemark,
            receiptFileID,
            receiptFileName,
            tempReceiptId
          }
        })
          .then(res => {

            if (!res.result || !res.result.success) {
              wx.showToast({
                title: res.result && res.result.message ? res.result.message : "入库失败",
                icon: "none"
              });
              return;
            }

            wx.showToast({
              title: "入库成功",
              icon: "success"
            });

            setTimeout(() => {
              const pages = getCurrentPages();
              const prevPage = pages[pages.length - 2];

              if (prevPage && prevPage.getInventoryList) {
                prevPage.getInventoryList();
              }

              wx.navigateBack();
            }, 800);
          })
          .catch(err => {
            console.error("调用 stockIn 失败：", err);

            wx.showToast({
              title: "入库失败",
              icon: "none"
            });
          })
          .finally(() => {
            wx.hideLoading();
            this.setData({ submitting: false });
          });
      }
    });
  }
});
