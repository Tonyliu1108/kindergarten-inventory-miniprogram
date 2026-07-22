function toNumber(value) {
  var num = Number(value);

  if (Number.isFinite(num)) {
    return num;
  }

  num = parseFloat(value);

  return Number.isFinite(num) ? num : 0;
}

function getWarningInfo(item) {
  var stock = toNumber(item.stock);
  var safetyStock = toNumber(item.safetyStock);

  if (stock <= 0) {
    return {
      text: "库存不足",
      className: "danger"
    };
  }

  if (stock <= safetyStock) {
    return {
      text: "库存偏低",
      className: "low"
    };
  }

  return null;
}

Page({
  data: {
    warningList: [],
    loading: false
  },

  onLoad: function () {
    this.getWarningList();
  },

  onShow: function () {
    this.getWarningList();
  },

  onPullDownRefresh: function () {
    this.getWarningList(function () {
      wx.stopPullDownRefresh();
    });
  },

  getWarningList: function (callback) {
    var that = this;

    that.setData({
      loading: true
    });

    var MAX_LIMIT = 100;
    var allData = [];

    function getBatch(skip) {
      return wx.cloud.callFunction({
        name: "getSkus",
        data: {
          mode: "warnings",
          skip: skip,
          limit: MAX_LIMIT
        }
      })
        .then(function (res) {
          var result = res.result || {};

          if (!result.success) {
            return Promise.reject(new Error(result.message || "获取预警失败"));
          }

          allData = allData.concat(result.items || []);

          if (result.hasMore) {
            return getBatch(skip + MAX_LIMIT);
          }

          var warningList = [];

          for (var i = 0; i < allData.length; i++) {
            var item = allData[i];
            var warningInfo = getWarningInfo(item);

            if (warningInfo) {
              item.warningText = warningInfo.text;
              item.warningClass = warningInfo.className;
              warningList.push(item);
            }
          }

          warningList.sort(function (a, b) {
            return toNumber(a.stock) - toNumber(b.stock);
          });

          that.setData({
            warningList: warningList,
            loading: false
          });

          if (callback) callback();
        });
    }

    getBatch(0).catch(function (err) {
      console.error("获取库存预警失败：", err);

      that.setData({
        loading: false
      });

      wx.showToast({
        title: "获取预警失败",
        icon: "none"
      });

      if (callback) callback();
    });
  }
});
