# 幼儿园库存管理小程序

基于微信小程序和腾讯云开发的轻量库存管理系统，支持库存查看、入库、出库、换码、盘点、采购凭证、用户申请与角色管理，以及 Excel 导出。

## 权限模型

- 未开通用户只能提交账号申请。
- 已启用老师可查看库存，并进行出库、换码和查看自己的操作记录。
- 管理员可维护物品、入库、盘点、审核用户、管理采购凭证和导出数据。
- 小程序前端不直接读写数据库，业务访问统一经过云函数鉴权。

## 本地配置

1. 安装微信开发者工具并导入仓库根目录。
2. 将 `miniprogram/config.local.example.js` 复制为 `miniprogram/config.local.js`，填入自己的云开发环境 ID。
3. 在微信开发者工具的项目设置中填写自己的小程序 AppID。`project.config.json` 仅保留公开模板值；本机值应写入已被忽略的 `project.private.config.json`。
4. 在云开发控制台创建以下集合：

   - `users`
   - `user_applications`
   - `item_skus`
   - `stock_records`
   - `purchase_receipts`

5. 部署 `cloudfunctions/` 下需要使用的云函数，并安装云端依赖。

真实 AppID、云环境 ID、私钥和 `.env` 文件都不应提交到 Git。

## 首位管理员

首次使用时，用管理员微信进入小程序并提交开通申请，然后在云开发数据库控制台手动新增一条 `users` 文档：

```json
{
  "openid": "申请记录中的 openid",
  "name": "管理员",
  "role": "admin",
  "status": "active"
}
```

后续用户可由该管理员在小程序内审核。不要把真实 openid 写入代码、文档或提交记录。

## 上线前安全配置

仓库中的规则文件是安全基线示例，需要在云开发控制台手动应用：

- 对上述每一个数据库集合应用 `database-security-rules.example.json`，拒绝小程序端直接访问，云函数服务端访问不受该规则影响。
- 对云函数应用 `cloudfunction-security-rules.example.json`。普通函数拒绝匿名身份；清理临时采购凭证的定时函数禁止客户端调用。
- 对云存储应用 `storage-security-rules.example.json`。客户端只能向 `purchase_receipts/` 上传不超过 10 MiB 的 JPG、JPEG 或 PNG；采购凭证只允许上传者读取，已登录用户可读取云函数生成的导出文件。若部署为多管理员共享采购凭证，需要结合实际身份体系另行设计共享读取规则，不能直接改为公开读取。

应用规则后请在测试环境验证登录、申请、库存操作、采购凭证预览和 Excel 导出。安全规则的具体语法及生效范围以腾讯云开发官方文档为准。

## 隐私与数据

部署后会处理用户姓名、微信 openid、库存操作记录和管理员上传的采购凭证。正式发布前，请在微信公众平台按当前要求配置用户隐私保护指引，说明数据用途、保存期限和删除方式；开发、演示和 Issue 中不要使用真实人员或采购数据。删除采购凭证时，云函数会同时删除对应云存储文件并将数据库记录标记为已删除。

## 测试数据清理

`resetTestData` 默认不能执行删除。只在非生产环境同时配置以下云函数环境变量后，管理员才能携带匹配口令执行 `clean`：

```text
ALLOW_TEST_DATA_RESET=true
RESET_TEST_DATA_CONFIRMATION=<高强度随机口令>
```

该函数只清理 `item_skus` 和 `stock_records`，不会删除用户、采购凭证或云存储文件。生产环境不要启用。

## 安全与贡献

- 安全问题请参阅 [SECURITY.md](SECURITY.md)，不要在公开 Issue 中披露漏洞或凭据。
- 参与开发请参阅 [CONTRIBUTING.md](CONTRIBUTING.md)。
- 本次公开前审计结果及已知边界见 [SECURITY_AUDIT.md](SECURITY_AUDIT.md)。

## 许可证

本项目采用 [MIT License](LICENSE)。
