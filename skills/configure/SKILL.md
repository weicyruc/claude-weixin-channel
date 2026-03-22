---
name: configure
description: Set up the WeChat channel — scan QR code to log in and review access policy. Use when the user asks to configure WeChat, set up the bot, scan a QR code, or check channel status.
user-invocable: true
allowed-tools:
  - Read
  - Write
  - Bash(ls *)
  - Bash(mkdir *)
---

# /weixin:configure — WeChat Channel Setup

Guides the user through WeChat QR code login and saves credentials to
`~/.claude/channels/weixin/account.json`.

Arguments passed: `$ARGUMENTS`

---

## Dispatch on arguments

### No args — status and QR login flow

1. **Check existing config** — read `~/.claude/channels/weixin/account.json`.
   - If it exists and has a `bot_token`: report "Already logged in (account: `<account_id>`). Run `/weixin:configure relogin` to re-authenticate."
   - If missing or empty: proceed to QR login.

2. **Start QR login** — call `mcp__weixin__weixin_qr_login` tool.
   Returns `{ qrcode, qrcode_img_content, instructions }`.

3. **Display QR code** — call `mcp__mcp-qr-terminal__display_qr_from_text`
   with the `qrcode_img_content` URL. Tell the user:
   > "扫描上方二维码，然后在微信手机端确认授权。"

4. **Poll login status** — call `mcp__weixin__weixin_poll_login` with the
   `qrcode` value. Repeat every few seconds:
   - `wait` → "等待扫码中..."
   - `scaned` → "已扫码！请在手机微信上点击确认。"
   - `confirmed` → credentials auto-saved. Proceed to step 5.
   - `expired` → "二维码已过期，请重新运行 `/weixin:configure`。"

5. **Done** — on success, tell the user:
   - ✅ 微信登录成功！凭证已保存至 `~/.claude/channels/weixin/account.json`
   - 重启 Claude Code 并加上 `--channels` 标志以激活频道
   - 运行 `/weixin:access` 管理谁可以给你发消息

### `relogin` — force re-authentication

Skip the "already logged in" check and start the QR login flow directly.

### `status` — show current state

Read `~/.claude/channels/weixin/account.json` and `access.json`, display:
- Login status (token present / missing)
- Access policy and allowlist count
- How to proceed next

---

## Implementation notes

- The state dir `~/.claude/channels/weixin/` may not exist on first run. Handle ENOENT gracefully.
- Credentials are sensitive — do not log the full `bot_token`.
- The server reads `account.json` once at boot. After login, prompt the user to restart Claude Code.
