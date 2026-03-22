# WeChat Access Control

Skill for managing WeChat access control in the Claude Code WeChat channel plugin.

## Trigger

User runs `/weixin:access` followed by a command.

## Commands

### `pair <code>`

Confirm a pairing request from a WeChat user.

When the plugin is in `pairing` mode and an unknown user sends a message, they receive a pairing code. The user then tells you the code, and you run this command to allow them.

**Action**: Call `mcp__weixin__weixin_access` with `action: "pair"` and `value: "<code>"`.

Example: `/weixin:access pair a1b2c3`

### `policy <allowlist|pairing>`

Set the access control policy.

- `allowlist` — Only users in the allow list can send messages. Unknown users are silently ignored.
- `pairing` — Unknown users receive a pairing code they can share to get access.

**Action**: Call `mcp__weixin__weixin_access` with `action: "policy"` and `value: "<policy>"`.

Example: `/weixin:access policy allowlist`

### `list`

Show the current policy and list of allowed WeChat user IDs.

**Action**: Call `mcp__weixin__weixin_access` with `action: "list"`.

Example: `/weixin:access list`

## Notes

- Access control state is stored in `~/.claude/channels/weixin/access.json`
- Pairing codes expire after 5 minutes
- The default policy is `pairing`
