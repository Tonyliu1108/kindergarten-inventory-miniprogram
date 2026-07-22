const localConfig = require("./config.local");

App({
  onLaunch: function () {
    const cloudEnvId = String(localConfig.cloudEnvId || "").trim();

    this.globalData = {
      env: cloudEnvId,
    };

    if (!wx.cloud) {
      console.error("请使用 2.2.3 或以上的基础库以使用云能力");
      return;
    }

    if (!cloudEnvId) {
      console.error("请先复制 config.local.example.js 为 config.local.js，并填写云开发环境 ID");
      return;
    }

    wx.cloud.init({
      env: cloudEnvId,
    });
  },
});
