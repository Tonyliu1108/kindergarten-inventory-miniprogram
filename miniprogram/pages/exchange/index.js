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
    oldSkuId: "",
    oldSku: null,

    newSkuList: [],
    newSkuLabelList: [],
    newSkuIndex: 0,

    quantity: 1,
    reasonList: [
      "尺码更换",
      "领取错码",
      "损坏换新",
      "其他"
    ],
    reasonIndex: 0,
    remark: "",

    submitting: false
  },

  onLoad(options) {
    const oldSkuId = options.skuId;

    if (!oldSkuId) {
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
      oldSkuId,
      oldSku: skuSnapshot && skuSnapshot._id === oldSkuId ? skuSnapshot : null
    });

    this.getOldSkuDetail(oldSkuId);
  },

  getOldSkuDetail(oldSkuId) {
    const hasSnapshot = !!this.data.oldSku;

    if (!hasSnapshot) {
      wx.showLoading({
        title: "加载中"
      });
    }

    wx.cloud.callFunction({
      name: "getSkus",
      data: {
        mode: "related",
        skuId: oldSkuId
      }
    })
      .then(res => {
        const result = res.result || {};

        if (!result.success) {
          return Promise.reject(new Error(result.message || "获取库存失败"));
        }

        const oldSku = result.sku;

        this.setData({
          oldSku
        });

        this.setNewSkuList(oldSku, result.items || []);
      })
      .catch(err => {
        console.error("获取原库存失败：", err);

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

  setNewSkuList(oldSku, items) {
    const list = (items || []).filter(item => {
      return item._id !== oldSku._id &&
        item.itemName === oldSku.itemName &&
        item.category === oldSku.category &&
        item.status === "active";
    });

    const labelList = list.map(item => {
      return item.size + "（库存" + item.stock + (item.unit || oldSku.unit || "") + "）";
    });

    this.setData({
      newSkuList: list,
      newSkuLabelList: labelList,
      newSkuIndex: 0
    });
  },

  onNewSkuChange(e) {
    this.setData({
      newSkuIndex: Number(e.detail.value)
    });
  },

  onQuantityInput(e) {
    let value = String(e.detail.value || "").replace(/[^\d]/g, "");
    value = value.replace(/^0+/, "");

    if (Number(value) > 200) {
      value = "200";

      wx.showToast({
        title: "单次换码最多200",
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

  submitExchange() {
    const {
      oldSku,
      oldSkuId,
      newSkuList,
      newSkuIndex,
      quantity,
      reasonList,
      reasonIndex,
      remark,
      submitting
    } = this.data;

    if (submitting) return;

    if (!oldSku) {
      wx.showToast({
        title: "库存信息未加载",
        icon: "none"
      });
      return;
    }

    if (newSkuList.length === 0) {
      wx.showToast({
        title: "暂无可换尺码",
        icon: "none"
      });
      return;
    }

    const newSku = newSkuList[newSkuIndex];

    if (!newSku) {
      wx.showToast({
        title: "请选择新尺码",
        icon: "none"
      });
      return;
    }

    const quantityText = String(quantity || "").trim();

    if (!/^[1-9]\d*$/.test(quantityText)) {
      wx.showToast({
        title: "换码数量必须是正整数",
        icon: "none"
      });
      return;
    }

    const exchangeQuantity = Number(quantityText);

    if (exchangeQuantity > 200) {
      wx.showToast({
        title: "单次换码最多200",
        icon: "none"
      });
      return;
    }

    if (exchangeQuantity > Number(newSku.stock)) {
      wx.showToast({
        title: "新尺码库存不足",
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
      title: "确认换码",
      content: `确认将 ${oldSku.itemName} ${oldSku.size} 换成 ${newSku.size}，数量 ${exchangeQuantity}${oldSku.unit}？`,
      success: modalRes => {
        if (!modalRes.confirm) return;

        this.setData({ submitting: true });

        wx.showLoading({
          title: "提交中"
        });

        wx.cloud.callFunction({
          name: "exchangeSku",
          data: {
            oldSkuId,
            newSkuId: newSku._id,
            quantity: exchangeQuantity,
            reason: selectedReason,
            remark: cleanRemark
          }
        })
          .then(res => {

            if (!res.result || !res.result.success) {
              wx.showToast({
                title: res.result && res.result.message ? res.result.message : "换码失败",
                icon: "none"
              });
              return;
            }

            wx.showToast({
              title: "换码成功",
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
            console.error("调用 exchangeSku 失败：", err);

            wx.showToast({
              title: "换码失败",
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
