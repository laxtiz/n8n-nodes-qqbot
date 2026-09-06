# n8n QQ Bot

[English](README.md) | [简体中文](README.zh-CN.md)

一个接入 **QQ 机器人**([QQ 开放平台](https://q.qq.com)官方机器人)的 [n8n](https://n8n.io/) 社区节点包。通过平台的 Webhook 回调模式实时接收机器人事件,并调用 QQ 机器人 OpenAPI 发送消息、撤回消息、上传富媒体。

> 本项目为非官方集成,与腾讯官方无关联。

[n8n](https://n8n.io/) 是一个采用 [fair-code 协议](https://docs.n8n.io/sustainable-use-license/)的工作流自动化平台。

## 包含的节点

| 节点 | 类型 | 功能 |
|------|------|------|
| **QQ Bot Trigger** | 触发器 | 通过 HTTPS 接收平台推送的事件(消息、好友/群变动等),逐条校验 Ed25519 签名后输出到工作流 |
| **QQ Bot** | Action | 发送消息(文本 / Markdown / 富媒体)、撤回消息、上传媒体文件 |

## 凭证

两个节点共用 **QQ Bot API** 凭证,需要到 [QQ 开放平台管理端](https://q.qq.com)获取两个值:

- **AppID** —— 机器人 ID,在机器人管理页可见。
- **AppSecret** —— 机器人密钥,用于应答平台的回调校验请求、验证事件签名、换取 OpenAPI 的 Access Token。

先在 [q.qq.com](https://q.qq.com) 注册并创建机器人,然后在 n8n 中新建 *QQ Bot API* 凭证并填入两个值即可。

> **IP 白名单**:正式环境下,OpenAPI 调用可能要求把 n8n 服务器的公网 IP 加入机器人管理端的 IP 白名单,否则调用会被拒绝。

Access Token 有效期 7200 秒,节点会按机器人维度缓存在工作流静态数据中,并在过期前 5 分钟自动刷新——不会每次调用 API 都用 AppSecret 去换取 Token。

## Webhook 配置(QQ Bot Trigger)

1. 在工作流中添加 **QQ Bot Trigger** 节点并选择凭证。
2. 复制节点的 **Production URL**(`https://<你的 n8n 地址>/webhook/<workflow>/webhook`)。
3. 到机器人管理端「回调配置」页粘贴该地址。平台保存时会立刻发送一条校验请求(op=13),触发器会自动用 AppSecret 派生的 Ed25519 私钥计算签名应答——无需任何手工操作。
4. 在同一页面勾选需要订阅的事件。

**回调地址必须是 HTTPS,且平台只接受 80、443、8080、8443 端口。** n8n 默认监听 5678 端口,本地调试时需要在前 面 加一层反向代理(nginx、Caddy 等)或内网穿透(frp、ngrok 等)。

## 操作说明

### Message: Send(发送消息)

- **Send To** —— 群聊(`group_openid`)或单聊(`user_openid`),取自消息事件。
- **Message Type**
  - *Text* —— 纯文本 `content`。
  - *Markdown* —— 需要机器人具有 Markdown 权限。可附加内嵌**键盘** JSON(长形式 `{ "content": { "rows": [...] } }`,或短形式 `{ "id": "<模板ID>" }`)。
  - *Rich Media* —— 图片、视频、语音或文件,需要先用 **File: Upload** 操作换取 `file_info`。
- **Options**
  - *Message ID* —— 填写后本条消息成为对该消息的**被动回复**。群聊 5 分钟内可回复 5 次,单聊 60 分钟内可回复 4 次;留空则为主动消息(频控更严格)。
  - *Message Sequence* —— 对同一条消息多次回复时递增 `msg_seq`。
  - *Reference Message IDX* —— 事件 `message_scene.ext` 或发送响应 `ext_info.ref_idx` 中的 `REFIDX_…` 串,填写后以引用回复的形式发送。

### Message: Recall(撤回消息)

撤回 **2 分钟**内发送的消息。撤回群内其他成员的消息需要机器人是群管理员。消息 ID 来自发送响应,或消息事件的 `d.id`。

### File: Upload(上传文件)

通过 **URL** 上传媒体文件(平台代下载并转存),返回 `file_info` 及其有效期(秒),供 Send 操作使用。

| 类型 | 格式 | 软限制 | 硬限制 |
|------|------|--------|--------|
| 图片 | png / jpg | 20 MB | 200 MB |
| 视频 | mp4 | 30 MB | 200 MB |
| 语音 | silk | 20 MB | 200 MB |
| 文件 | 不限 | 200 MB | 200 MB |

超出软限制会降级为普通文件发送。**群接口上传的文件只能发到该群**,单聊同理。可选的 *Send Immediately* 开关会让平台直接把媒体作为主动消息发出并返回消息 ID,而不是只返回 `file_info`。

## 使用示例

**复读机(收到什么回什么)**:`QQ Bot Trigger → Send`
- OpenID:`{{ $json.author.user_openid }}`
- Message ID:`{{ $json.id }}`
- Content:`{{ $json.content }}`

**收到图片、回一张图**:`QQ Bot Trigger → File: Upload → Send`
- Upload:Media URL 填图片地址,Send To 与来消息的会话保持一致
- Send:Message Type 选 *Rich Media*,File Info 填 `{{ $json.file_info }}`,Message ID 填 `{{ $('QQ Bot Trigger').item.json.id }}`

触发器的输出是把事件类型放入 `event` 字段、并把 payload 的 `d` 字段平铺到顶层,例如:

```json
{
  "event": "C2C_MESSAGE_CREATE",
  "id": "ROBOT1.0_…",
  "content": "hello",
  "author": { "user_openid": "…", "…": "…" },
  "attachments": []
}
```

常见事件类型有 `C2C_MESSAGE_CREATE`、`GROUP_AT_MESSAGE_CREATE`、`DIRECT_MESSAGE_CREATE`、`AT_MESSAGE_CREATE`、`FRIEND_ADD`、`GROUP_ADD_ROBOT` 等,完整列表见[官方事件文档](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/interface-framework/event-emit.html)。

## 常见错误

| 错误 | 含义 |
|------|------|
| `QQ Bot API error 100016` | AppID 或 AppSecret 不正确 |
| `QQ Bot API error 11255` / `40011028` | 会话不存在——通常是 OpenID 表达式取错或取空了 |
| `QQ Bot API error 304103` / `40034005` | 被动回复窗口(`msg_id`)已过期 |
| `QQ Bot API error 40034100` | 触发频控 |
| `QQ Bot API error 40064004` | 消息已超过 2 分钟,无法撤回 |
| `QQ Bot API error 850019` / `850031` | 文件格式不支持 / 文件过大 |

## 兼容性

基于 n8n 社区节点 API(v1)开发,在较新的 n8n 2.x 版本上测试通过。包**没有任何运行时依赖**——签名使用 Node.js 内置的 `node:crypto` Ed25519。

## 安装

在 n8n 界面安装(*Settings → Community Nodes → Install*,包名 `n8n-nodes-qqbot`),或手动安装:

```bash
cd ~/.n8n/nodes
npm install n8n-nodes-qqbot
```

在本仓库上开发:

```bash
npm install
npm run dev   # 在 http://localhost:5678 启动 n8n,节点带热重载
```

## 相关资源

- [QQ 开放平台文档](https://bot.q.qq.com/wiki/)
- [Webhook 回调模式](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/event-emit/webhook.html)
- [n8n 社区节点文档](https://docs.n8n.io/integrations/#community-nodes)

## 许可证

[MIT](LICENSE)
