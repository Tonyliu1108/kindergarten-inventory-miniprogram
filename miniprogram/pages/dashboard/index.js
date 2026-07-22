Page({
  data: {
    loading: false,
    currentUser: null,
    registerModalShown: false,
    registerModalKey: "",
    warningTotalCount: 0,
    stats: {
      todayInCount: 0,
      todayOutCount: 0,
      todayExchangeCount: 0,
      activeItemCount: 0,
      warningCount: 0,
      dangerCount: 0,
      pendingApplicationCount: 0
    }
  },

  onShow: function () {
    this.getDashboardStats();
  },

  onPullDownRefresh: function () {
    this.getDashboardStats(function () {
      wx.stopPullDownRefresh();
    });
  },

  buildRegisterModal: function (rejectedApplication) {
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

  buildRegisterModalKey: function (rejectedApplication) {
    if (!rejectedApplication) {
      return "needRegister";
    }

    return [
      "rejected",
      rejectedApplication._id || "",
      rejectedApplication.reviewedAt || "",
      rejectedApplication.rejectReason || ""
    ].join("|");
  },

  normalizeStats: function (stats) {
    var safeStats = stats || {};
    var dangerCount = Number(safeStats.dangerCount || 0);
    var warningCount = Number(safeStats.warningCount || 0);

    safeStats.dangerCount = dangerCount;
    safeStats.warningCount = warningCount;
    return safeStats;
  },

  getDashboardStats: function (callback) {
    var that = this;

    if (that.data.loading) {
      if (callback) callback();
      return;
    }

    that.setData({
      loading: true
    });

    wx.cloud.callFunction({
      name: "getDashboardStats"
    })
      .then(function (res) {

        if (!res.result) {
          wx.showToast({
            title: "首页数据为空",
            icon: "none"
          });

          that.setData({
            loading: false
          });

          if (callback) callback();
          return;
        }

        if (res.result.needRegister) {
          that.setData({
            loading: false,
            currentUser: null
          });
        
          var modalKey = that.buildRegisterModalKey(res.result.rejectedApplication);

          if (!that.data.registerModalShown || that.data.registerModalKey !== modalKey) {
            that.setData({
              registerModalShown: true,
              registerModalKey: modalKey
            });
        
            var modalConfig = that.buildRegisterModal(res.result.rejectedApplication);

            wx.showModal({
              title: modalConfig.title,
              content: modalConfig.content,
              confirmText: modalConfig.confirmText,
              cancelText: "稍后",
              success: function (modalRes) {
                if (modalRes.confirm) {
                  wx.navigateTo({
                    url: "/pages/apply/index"
                  });
                }
              }
            });
          }
        
          if (callback) callback();
          return;
        }

        if (!res.result.success) {
          wx.showToast({
            title: res.result.message || "获取首页失败",
            icon: "none"
          });

          that.setData({
            loading: false
          });

          if (callback) callback();
          return;
        }

        var normalizedStats = that.normalizeStats(res.result.stats);

        that.setData({
          currentUser: res.result.user,
          registerModalShown: false,
          registerModalKey: "",
          warningTotalCount: normalizedStats.dangerCount + normalizedStats.warningCount,
          stats: normalizedStats,
          loading: false
        });

        if (callback) callback();
      })
      .catch(function (err) {
        console.error("调用 getDashboardStats 失败：", err);

        that.setData({
          loading: false
        });

        wx.showToast({
          title: "获取首页失败",
          icon: "none"
        });

        if (callback) callback();
      });
  },

  requireRegistered: function () {
    if (!this.data.currentUser) {
      wx.showToast({
        title: "当前账号未开通，请先提交申请",
        icon: "none"
      });
      return false;
    }

    return true;
  },

  goApply: function () {
    wx.navigateTo({
      url: "/pages/apply/index"
    });
  },

  goInventory: function () {
    if (!this.requireRegistered()) return;

    wx.navigateTo({
      url: "/pages/inventory/index"
    });
  },

  goTodayRecords: function (e) {
    if (!this.requireRegistered()) return;

    var type = e.currentTarget.dataset.type || "";
  
    wx.navigateTo({
      url: "/pages/records/index?dateType=today&type=" + type
    });
  },

  goRecords: function () {
    if (!this.requireRegistered()) return;

    wx.navigateTo({
      url: "/pages/records/index"
    });
  },

  goWarnings: function () {
    if (!this.requireRegistered()) return;

    wx.navigateTo({
      url: "/pages/warnings/index"
    });
  },

  goItems: function () {
    if (!this.requireRegistered()) return;

    if (!this.data.currentUser || this.data.currentUser.role !== "admin") {
      wx.showToast({
        title: "只有管理员可以进入物品管理",
        icon: "none"
      });
      return;
    }

    wx.navigateTo({
      url: "/pages/items/index"
    });
  },

  goPurchaseReceipts: function () {
    if (!this.requireRegistered()) return;

    if (!this.data.currentUser || this.data.currentUser.role !== "admin") {
      wx.showToast({
        title: "无权限访问",
        icon: "none"
      });
      return;
    }

    wx.navigateTo({
      url: "/pages/purchaseReceipts/index"
    });
  },

  goUsers: function () {
    if (!this.requireRegistered()) return;

    wx.navigateTo({
      url: "/pages/users/index"
    });
  }
});
