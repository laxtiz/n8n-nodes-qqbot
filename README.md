# n8n QQ Bot

[English](README.md) | [简体中文](README.zh-CN.md)

An [n8n](https://n8n.io/) community node for **QQ Bot** — the official bot platform for QQ ([QQ Open Platform](https://q.qq.com)). It receives bot events in real time through the platform's webhook callback mode, and can send, recall and upload media through the QQ Bot OpenAPI.

> This is an unofficial integration, not affiliated with Tencent.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

## Included nodes

| Node | Type | What it does |
|------|------|--------------|
| **QQ Bot Trigger** | Trigger | Receives events (messages, friend/group changes, …) pushed by the platform over HTTPS, verifies their Ed25519 signatures, and emits them into the workflow |
| **QQ Bot** | Action | Sends messages (text / markdown / rich media), recalls messages, uploads media files |

## Credentials

Both nodes use the **QQ Bot API** credential with two values from the [QQ Open Platform console](https://q.qq.com):

- **AppID** — the bot's ID, shown on the bot's management page.
- **AppSecret** — the bot's secret. It is used to answer the platform's callback validation request, verify incoming event signatures, and obtain access tokens for the OpenAPI.

To create the credential, register a bot at [q.qq.com](https://q.qq.com), then in n8n add a *QQ Bot API* credential and paste both values.

> **IP whitelist**: production environments may require the public IP of your n8n server to be whitelisted in the bot console before OpenAPI calls are accepted.

Access tokens are valid for 7200 seconds and are cached in the workflow's static data (keyed per bot) and refreshed 5 minutes before expiry, so the AppSecret is not exchanged on every API call.

## Webhook configuration (QQ Bot Trigger)

1. Add the **QQ Bot Trigger** node to a workflow and select the credential.
2. Copy the node's **Production URL** (`https://<your-n8n>/webhook/<workflow>/webhook`).
3. In the bot console, open the **callback configuration** page and paste the URL. The platform immediately sends a validation request (opcode 13); the trigger answers it automatically with an Ed25519 signature derived from your AppSecret — no manual steps needed.
4. Subscribe to the events you want to receive in the same page.

**The callback URL must be HTTPS and the platform only accepts ports 80, 443, 8080 and 8443.** n8n usually listens on port 5678, so put a reverse proxy (nginx, Caddy, …) or a tunnel (frp, ngrok, …) in front of it for local testing.

## Operations

### Message: Send

- **Send To** — a group chat (`group_openid`) or a direct user chat (`user_openid`), taken from the message event.
- **Message Type**
  - *Text* — plain `content`.
  - *Markdown* — requires the bot to have markdown permission. An optional inline **keyboard** can be attached as JSON (`{ "content": { "rows": [...] } }` long form or `{ "id": "<template id>" }` short form).
  - *Rich Media* — image, video, voice or file; requires a `file_info` obtained from the **File: Upload** operation.
- **Options**
  - *Message ID* — makes the send a **passive reply** to that message. Group replies are valid for 5 minutes with up to 5 replies per message; user replies for 60 minutes with up to 4 replies. Leave empty to send an active message (subject to stricter rate limits).
  - *Message Sequence* — increment `msg_seq` to reply several times to the same message.
  - *Reference Message IDX* — the `REFIDX_…` string from the event's `message_scene.ext` (or a send response's `ext_info.ref_idx`) to send a quoted reply.

### Message: Recall

Recalls a message within **2 minutes** of sending. Recalling other members' group messages requires the bot to be a group admin. The message ID comes either from a send response or from the `d.id` of a message event.

### File: Upload

Uploads a media file **by URL** (the platform downloads and re-hosts it) and returns `file_info` for the Send operation plus its TTL in seconds.

| Type | Format | Soft limit | Hard limit |
|------|--------|-----------|-----------|
| Image | png / jpg | 20 MB | 200 MB |
| Video | mp4 | 30 MB | 200 MB |
| Voice | silk | 20 MB | 200 MB |
| File | any | 200 MB | 200 MB |

Oversized media is downgraded to a generic file. Files uploaded through the group API can only be sent to that group (and likewise for users). The optional *Send Immediately* flag sends the media right away as an active message instead of only returning a `file_info`.

## Usage examples

**Echo bot**: `QQ Bot Trigger → Send`
- OpenID: `{{ $json.author.user_openid }}`
- Message ID: `{{ $json.id }}`
- Content: `{{ $json.content }}`

**Receive an image, reply with an image**: `QQ Bot Trigger → File: Upload → Send`
- Upload: Media URL pointing to your image, Send To matching the incoming chat
- Send: Message Type *Rich Media*, File Info `{{ $json.file_info }}`, Message ID `{{ $('QQ Bot Trigger').item.json.id }}`

The trigger's output is the event type in an `event` property with the payload's `d` fields flattened to the top level, e.g.:

```json
{
  "event": "C2C_MESSAGE_CREATE",
  "id": "ROBOT1.0_…",
  "content": "hello",
  "author": { "user_openid": "…", "…": "…" },
  "attachments": []
}
```

Common event types include `C2C_MESSAGE_CREATE`, `GROUP_AT_MESSAGE_CREATE`, `DIRECT_MESSAGE_CREATE`, `AT_MESSAGE_CREATE`, `FRIEND_ADD`, `GROUP_ADD_ROBOT` — see the [official event list](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/interface-framework/event-emit.html).

## Common errors

| Error | Meaning |
|-------|---------|
| `QQ Bot API error 100016` | AppID or AppSecret is wrong |
| `QQ Bot API error 11255` / `40011028` | The chat does not exist — usually an empty or wrong OpenID expression |
| `QQ Bot API error 304103` / `40034005` | The passive-reply window (`msg_id`) has expired |
| `QQ Bot API error 40034100` | Rate limit exceeded |
| `QQ Bot API error 40064004` | The message can no longer be recalled (older than 2 minutes) |
| `QQ Bot API error 850019` / `850031` | Unsupported file format / file too large |

## Compatibility

Built against the n8n community node API (v1) and tested with recent n8n 2.x releases. The package has **zero runtime dependencies** — signatures use Node.js' built-in `node:crypto` Ed25519.

## Installation

Install it from the n8n UI (*Settings → Community Nodes → Install*, package name `n8n-nodes-qqbot`), or manually:

```bash
cd ~/.n8n/nodes
npm install n8n-nodes-qqbot
```

For development on this repository:

```bash
npm install
npm run dev   # starts n8n at http://localhost:5678 with the node hot-reloaded
```

## Resources

- [QQ Open Platform documentation](https://bot.q.qq.com/wiki/)
- [Webhook callback mode](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/event-emit/webhook.html)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)

## License

[MIT](LICENSE)
