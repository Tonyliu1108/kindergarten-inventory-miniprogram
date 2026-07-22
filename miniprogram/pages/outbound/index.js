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
      "领取",
      "尺码更换",
      "损坏补领",
      "其他"
    ],
    reasonIndex: 0,
    remark: "",

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
    // 只保留整数数字，防止输入小数、负数、字母
    let value = String(e.detail.value || "").replace(/[^\d]/g, "");
  
    // 去掉前面的 0，例如 003 变成 3
    value = value.replace(/^0+/, "");
  
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

  submitOutbound() {
    const { sku, skuId, quantity, reasonList, reasonIndex, remark, submitting } = this.data;

    if (submitting) return;

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
    title: "出库数量必须是正整数",
    icon: "none"
  });
  return;
}

const outQuantity = Number(quantityText);

    if (outQuantity > Number(sku.stock)) {
      wx.showToast({
        title: "出库数量不能超过库存",
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
    wx.showModal({
      title: "确认出库",
      content: `确认出库 ${sku.itemName} ${sku.size}，数量 ${outQuantity}${sku.unit}？`,
      success: modalRes => {
        if (!modalRes.confirm) return;

        this.setData({ submitting: true });

        wx.showLoading({
          title: "提交中"
        });

        wx.cloud.callFunction({
          name: "stockOut",
          data: {
            skuId,
            quantity: outQuantity,
            reason: selectedReason,
            remark: cleanRemark
          }
        })
          .then(res => {

            if (!res.result || !res.result.success) {
              wx.showToast({
                title: res.result && res.result.message ? res.result.message : "出库失败",
                icon: "none"
              });
              return;
            }

            wx.showToast({
              title: "出库成功",
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
            console.error("调用 stockOut 失败：", err);

            wx.showToast({
              title: "出库失败",
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
