Page({
  data: {
    name: "",
    submitting: false
  },

  onNameInput(e) {
    this.setData({
      name: e.detail.value
    });
  },

  submitApplication() {
    const cleanName = String(this.data.name || "").trim();

    if (!cleanName) {
      wx.showToast({
        title: "请输入姓名",
        icon: "none"
      });
      return;
    }

    if (cleanName.length > 10) {
      wx.showToast({
        title: "姓名最多10个字",
        icon: "none"
      });
      return;
    }

    if (this.data.submitting) return;

    wx.showModal({
      title: "确认提交",
      content: `确认以“${cleanName}”提交开通申请吗？`,
      success: modalRes => {
        if (!modalRes.confirm) return;

        this.setData({ submitting: true });

        wx.showLoading({
          title: "提交中"
        });

        wx.cloud.callFunction({
          name: "submitApplication",
          data: {
            name: cleanName
          }
        })
          .then(res => {

            if (!res.result || !res.result.success) {
              wx.showToast({
                title: res.result && res.result.message ? res.result.message : "提交失败",
                icon: "none"
              });
              return;
            }

            wx.showModal({
              title: "提交成功",
              content: "申请已提交，请等待管理员审核。审核通过后重新打开小程序即可使用。",
              showCancel: false,
              success: () => {
                wx.navigateBack();
              }
            });
          })
          .catch(err => {
            console.error("提交申请失败：", err);

            wx.showToast({
              title: "提交失败",
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