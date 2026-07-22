Page({
  data: {
    users: [],
    loading: false,
  
    applications: [],
    applicationLoading: false,
    reviewingId: "",
  
    addName: "",
    addOpenid: "",
    roleList: ["老师", "管理员"],
    roleValueList: ["teacher", "admin"],
    roleIndex: 0,
    adding: false
  },

  onLoad() {
    this.getUsers();
    this.getApplications();
  },
  
  onShow() {
    this.getUsers();
    this.getApplications();
  },

  onPullDownRefresh() {
    this.getUsers();
    this.getApplications(() => {
      wx.stopPullDownRefresh();
    });
  },

  getUsers(callback) {
    this.setData({ loading: true });

    wx.cloud.callFunction({
      name: "getUsers"
    })
      .then(res => {

        if (!res.result || !res.result.success) {
          wx.showToast({
            title: res.result && res.result.message ? res.result.message : "获取用户失败",
            icon: "none"
          });

          this.setData({ loading: false });

          if (callback) callback();
          return;
        }

        const users = (res.result.users || []).map(item => {
          return {
            ...item,
            roleText: item.role === "admin" ? "管理员" : "老师",
            statusText: item.status === "active" ? "启用中" : "已停用",
            statusClass: item.status === "active" ? "active" : "disabled",
            createdAtText: this.formatTime(item.createdAt)
          };
        });

        this.setData({
          users,
          loading: false
        });

        if (callback) callback();
      })
      .catch(err => {
        console.error("调用 getUsers 失败：", err);

        this.setData({ loading: false });

        wx.showToast({
          title: "获取用户失败",
          icon: "none"
        });

        if (callback) callback();
      });
  },
  getApplications(callback) {
    this.setData({ applicationLoading: true });
  
    wx.cloud.callFunction({
      name: "getApplications"
    })
      .then(res => {
  
        if (!res.result || !res.result.success) {
          wx.showToast({
            title: res.result && res.result.message ? res.result.message : "获取申请失败",
            icon: "none"
          });
  
          this.setData({ applicationLoading: false });
  
          if (callback) callback();
          return;
        }
  
        const applications = (res.result.applications || []).map(item => {
          return {
            ...item,
            createdAtText: this.formatTime(item.createdAt)
          };
        });
  
        this.setData({
          applications,
          applicationLoading: false
        });
  
        if (callback) callback();
      })
      .catch(err => {
        console.error("调用 getApplications 失败：", err);
  
        this.setData({ applicationLoading: false });
  
        wx.showToast({
          title: "获取申请失败",
          icon: "none"
        });
  
        if (callback) callback();
      });
  },

  formatTime(value) {
    if (!value) return "";

    if (typeof value === "string") {
      return value;
    }

    let date;

    if (value instanceof Date) {
      date = value;
    } else if (value.$date) {
      date = new Date(value.$date);
    } else {
      date = new Date(value);
    }

    if (Number.isNaN(date.getTime())) return "";

    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");

    return `${y}-${m}-${d}`;
  },

  onAddNameInput(e) {
    this.setData({
      addName: e.detail.value
    });
  },

  onAddOpenidInput(e) {
    this.setData({
      addOpenid: e.detail.value
    });
  },

  onAddRoleChange(e) {
    this.setData({
      roleIndex: Number(e.detail.value)
    });
  },

  submitAddUser() {
    const { addName, addOpenid, roleValueList, roleIndex, adding } = this.data;

    if (adding) return;

    const cleanName = String(addName || "").trim();
    const cleanOpenid = String(addOpenid || "").trim();
    const role = roleValueList[roleIndex];

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

    if (!cleanOpenid) {
      wx.showToast({
        title: "请输入openid",
        icon: "none"
      });
      return;
    }

    if (cleanOpenid.length > 64) {
      wx.showToast({
        title: "openid长度异常",
        icon: "none"
      });
      return;
    }

    wx.showModal({
      title: "确认新增",
      content: `确认新增账号：${cleanName}？`,
      success: modalRes => {
        if (!modalRes.confirm) return;

        this.setData({ adding: true });

        wx.showLoading({
          title: "新增中"
        });

        wx.cloud.callFunction({
          name: "addUser",
          data: {
            name: cleanName,
            targetOpenid: cleanOpenid,
            role
          }
        })
          .then(res => {

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

            this.setData({
              addName: "",
              addOpenid: "",
              roleIndex: 0
            });

            this.getUsers();
          })
          .catch(err => {
            console.error("调用 addUser 失败：", err);

            wx.showToast({
              title: "新增失败",
              icon: "none"
            });
          })
          .finally(() => {
            wx.hideLoading();
            this.setData({ adding: false });
          });
      }
    });
  },

  toggleUserStatus(e) {
    const userId = e.currentTarget.dataset.id;
    const currentStatus = e.currentTarget.dataset.status;
    const nextStatus = currentStatus === "active" ? "disabled" : "active";

    const actionText = nextStatus === "active" ? "启用" : "停用";

    wx.showModal({
      title: `确认${actionText}`,
      content: `确定要${actionText}这个账号吗？`,
      success: modalRes => {
        if (!modalRes.confirm) return;

        wx.showLoading({
          title: "处理中"
        });

        wx.cloud.callFunction({
          name: "updateUserStatus",
          data: {
            userId,
            status: nextStatus
          }
        })
          .then(res => {

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

            this.getUsers();
          })
          .catch(err => {
            console.error("调用 updateUserStatus 失败：", err);

            wx.showToast({
              title: "操作失败",
              icon: "none"
            });
          })
          .finally(() => {
            wx.hideLoading();
          });
      }
    });
  },

  changeUserRole(e) {
    const userId = e.currentTarget.dataset.id;
    const currentRole = e.currentTarget.dataset.role;
    const nextRole = currentRole === "admin" ? "teacher" : "admin";
    const nextRoleText = nextRole === "admin" ? "管理员" : "老师";

    wx.showModal({
      title: "确认修改角色",
      content: `确定要将该账号设置为${nextRoleText}吗？`,
      success: modalRes => {
        if (!modalRes.confirm) return;

        wx.showLoading({
          title: "修改中"
        });

        wx.cloud.callFunction({
          name: "updateUserRole",
          data: {
            userId,
            role: nextRole
          }
        })
          .then(res => {

            if (!res.result || !res.result.success) {
              wx.showToast({
                title: res.result && res.result.message ? res.result.message : "修改失败",
                icon: "none"
              });
              return;
            }

            wx.showToast({
              title: res.result.message || "修改成功",
              icon: "success"
            });

            this.getUsers();
          })
          .catch(err => {
            console.error("调用 updateUserRole 失败：", err);

            wx.showToast({
              title: "修改失败",
              icon: "none"
            });
          })
          .finally(() => {
            wx.hideLoading();
          });
      }
    });
  },
  reviewApplication(e) {
    const applicationId = e.currentTarget.dataset.id;
    const action = e.currentTarget.dataset.action;

    if (action === "reject") {
      wx.showModal({
        title: "填写拒绝原因",
        editable: true,
        placeholderText: "请输入拒绝原因，最多100个字",
        confirmText: "拒绝",
        confirmColor: "#e64340",
        success: modalRes => {
          if (!modalRes.confirm) return;

          const rejectReason = String(modalRes.content || "").trim();

          if (!rejectReason) {
            wx.showToast({
              title: "请填写拒绝原因",
              icon: "none"
            });
            return;
          }

          if (rejectReason.length > 100) {
            wx.showToast({
              title: "拒绝原因最多100个字",
              icon: "none"
            });
            return;
          }

          this.setData({
            reviewingId: applicationId
          });

          wx.showLoading({
            title: "处理中"
          });

          wx.cloud.callFunction({
            name: "reviewApplication",
            data: {
              applicationId,
              action,
              role: "teacher",
              rejectReason
            }
          })
            .then(res => {

              if (!res.result || !res.result.success) {
                wx.showToast({
                  title: res.result && res.result.message ? res.result.message : "审核失败",
                  icon: "none"
                });
                return;
              }

              wx.showToast({
                title: res.result.message || "操作成功",
                icon: "success"
              });

              this.getApplications();
              this.getUsers();
            })
            .catch(err => {
              console.error("调用 reviewApplication 失败：", err);

              wx.showToast({
                title: "审核失败",
                icon: "none"
              });
            })
            .finally(() => {
              wx.hideLoading();

              this.setData({
                reviewingId: ""
              });
            });
        }
      });
      return;
    }
  
    const actionText = action === "approve" ? "通过" : "拒绝";
  
    wx.showModal({
      title: `确认${actionText}`,
      content: `确定要${actionText}这个开通申请吗？`,
      success: modalRes => {
        if (!modalRes.confirm) return;
  
        this.setData({
          reviewingId: applicationId
        });
  
        wx.showLoading({
          title: "处理中"
        });
  
        wx.cloud.callFunction({
          name: "reviewApplication",
          data: {
            applicationId,
            action,
            role: "teacher"
          }
        })
          .then(res => {
  
            if (!res.result || !res.result.success) {
              wx.showToast({
                title: res.result && res.result.message ? res.result.message : "审核失败",
                icon: "none"
              });
              return;
            }
  
            wx.showToast({
              title: res.result.message || "操作成功",
              icon: "success"
            });
  
            this.getApplications();
            this.getUsers();
          })
          .catch(err => {
            console.error("调用 reviewApplication 失败：", err);
  
            wx.showToast({
              title: "审核失败",
              icon: "none"
            });
          })
          .finally(() => {
            wx.hideLoading();
  
            this.setData({
              reviewingId: ""
            });
          });
      }
    });
  }
});
