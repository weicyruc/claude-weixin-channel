# WeChat Configure

Skill for setting up WeChat login for the Claude Code WeChat channel plugin.

## Trigger

User runs `/weixin:configure` or asks to set up WeChat.

## Steps

1. **Check existing config**: Read `~/.claude/channels/weixin/account.json`. If it exists and has a `bot_token`, inform the user they are already logged in and ask if they want to re-login.

2. **Start QR login**: Call the `mcp__weixin__weixin_qr_login` tool. It returns a JSON with `qrcode` and `qrcode_img_content`.

3. **Display QR code**: Call `mcp__mcp-qr-terminal__display_qr_from_text` with the `qrcode_img_content` URL as input. Tell the user to scan the QR code with WeChat.

4. **Poll login status**: Call `mcp__weixin__weixin_poll_login` with the `qrcode` value. Repeat every few seconds until status is `confirmed` or `expired`.
   - `wait` → Tell user: "Waiting for you to scan..."
   - `scaned` → Tell user: "Scanned! Please confirm on your phone."
   - `confirmed` → Credentials are auto-saved. Proceed to step 5.
   - `expired` → Tell user the QR code expired and offer to restart.

5. **Done**: Tell the user:
   - ✅ WeChat login successful!
   - Credentials saved to `~/.claude/channels/weixin/account.json`
   - Restart Claude Code with `--channel weixin` to start receiving messages
   - Run `/weixin:access` to manage who can message you
