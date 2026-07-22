function parseSkuSnapshot(options) {
  if (!options || !options.skuSnapshot) return null;

  try {
    var snapshot = JSON.parse(decodeURIComponent(options.skuSnapshot));

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

    actualStock: "",
    reasonList: ["盘点校准", "纸质记录修正", "历史录入错误", "实物遗失", "其他"],
    reasonIndex: 0,
    remark: "",

    loading: false,
    submitting: false
  },

  onLoad: function (options) {
    var skuId = options && options.skuId ? options.skuId : "";
    var skuSnapshot = parseSkuSnapshot(options);
    var matchedSnapshot = skuSnapshot && skuSnapshot._id === skuId ? skuSnapshot : null;

    this.setData({
      skuId: skuId,
      sku: matchedSnapshot,
      actualStock: matchedSnapshot ? String(matchedSnapshot.stock || 0) : ""
    });

    this.getSkuDetail();
  },

  getSkuDetail: function () {
    var that = this;

    if (!that.data.skuId) {
      wx.showToast({
        title: "物品ID异常",
        icon: "none"
      });
      return;
    }

    var hasSnapshot = !!that.data.sku;

    if (!hasSnapshot) {
      that.setData({
        loading: true
      });
    }

    wx.cloud.callFunction({
      name: "getSkus",
      data: {
        mode: "detail",
        skuId: that.data.skuId
      }
    })
      .then(function (res) {
        var result = res.result || {};

        if (!result.success) {
          return Promise.reject(new Error(result.message || "获取物品失败"));
        }

        that.setData({
          sku: result.sku,
          actualStock: String(result.sku.stock || 0),
          loading: false
        });
      })
      .catch(function (err) {
        console.error("获取物品详情失败：", err);

        that.setData({
          loading: false
        });

        if (!hasSnapshot) {
          wx.showToast({
            title: "获取物品失败",
            icon: "none"
          });
        }
      });
  },

  onActualStockInput: function (e) {
    var value = String(e.detail.value || "");

    // 只允许输入整数数字
    value = value.replace(/[^\d]/g, "");

    if (value.length > 5) {
      value = value.slice(0, 5);
    }

    this.setData({
      actualStock: value
    });
  },

  onReasonChange: function (e) {
    this.setData({
      reasonIndex: Number(e.detail.value)
    });
  },

  onRemarkInput: function (e) {
    var value = String(e.detail.value || "");

    if (value.length > 100) {
      value = value.slice(0, 100);
    }

    this.setData({
      remark: value
    });
  },

  submitStockAdjust: function () {
    var that = this;

    if (that.data.submitting) return;

    var sku = that.data.sku;

    if (!sku) {
      wx.showToast({
        title: "物品信息异常",
        icon: "none"
      });
      return;
    }

    var actualStockText = String(that.data.actualStock || "").trim();
    var actualStock = Number(actualStockText);
    var reason = that.data.reasonList[that.data.reasonIndex];
    var remark = String(that.data.remark || "").trim();

    if (!/^\d+$/.test(actualStockText)) {
      wx.showToast({
        title: "请输入实际库存",
        icon: "none"
      });
      return;
    }

    if (!Number.isInteger(actualStock) || actualStock < 0) {
      wx.showToast({
        title: "实际库存必须是整数",
        icon: "none"
      });
      return;
    }

    if (actualStock > 99999) {
      wx.showToast({
        title: "实际库存数量过大",
        icon: "none"
      });
      return;
    }

    if (reason === "其他" && !remark) {
      wx.showToast({
        title: "请填写备注",
        icon: "none"
      });
      return;
    }

    var beforeStock = Number(sku.stock || 0);
    var diff = actualStock - beforeStock;

    wx.showModal({
      title: "确认盘点",
      content: "当前系统库存：" + beforeStock + sku.unit + "\n实际盘点库存：" + actualStock + sku.unit + "\n差异：" + (diff > 0 ? "+" : "") + diff + sku.unit,
      success: function (modalRes) {
        if (!modalRes.confirm) return;

        that.setData({
          submitting: true
        });

        wx.showLoading({
          title: "提交中"
        });

        wx.cloud.callFunction({
          name: "stockAdjust",
          data: {
            skuId: that.data.skuId,
            actualStock: actualStock,
            reason: reason,
            remark: remark
          }
        })
          .then(function (res) {

            if (!res.result || !res.result.success) {
              wx.showToast({
                title: res.result && res.result.message ? res.result.message : "盘点失败",
                icon: "none"
              });
              return;
            }

            wx.showToast({
              title: res.result.message || "盘点成功",
              icon: "success"
            });

            setTimeout(function () {
              wx.navigateBack();
            }, 800);
          })
          .catch(function (err) {
            console.error("调用 stockAdjust 失败：", err);

            wx.showToast({
              title: "盘点失败",
              icon: "none"
            });
          })
          .finally(function () {
            wx.hideLoading();

            that.setData({
              submitting: false
            });
          });
      }
    });
  }
});
