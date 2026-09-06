# Changelog

All notable changes to this project will be documented in this file.

## 0.1.0

Initial release.

- **QQ Bot Trigger** node: receives QQ Open Platform events via the webhook callback mode — answers the callback validation request (opcode 13) with an Ed25519 signature derived from the AppSecret, verifies the `X-Signature-Ed25519` signature of every event push, and emits the event type plus flattened payload into the workflow.
- **QQ Bot** node:
  - Message: Send — text, markdown (with optional inline keyboard) and rich media (via `file_info`), with passive replies (`msg_id` / `msg_seq`) and quoted replies (`message_reference`).
  - Message: Recall — recalls group or C2C messages within the 2-minute window.
  - File: Upload — uploads media by URL (image / video / voice / file) and returns `file_info` with its TTL.
  - Access tokens are cached per bot in the workflow's static data and refreshed 5 minutes before expiry.
- **QQ Bot API** credential (AppID + AppSecret) with a credential test against the token endpoint.
