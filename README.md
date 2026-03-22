<div align="center">

# 🤖 Claude Code × WeChat

**将 Claude AI 接入微信私信 — 官方 iLink API · 零中间层 · 开箱即用**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/Runtime-Bun-black?logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/Language-TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![MCP](https://img.shields.io/badge/Protocol-MCP-purple)](https://modelcontextprotocol.io)
[![WeChat iLink](https://img.shields.io/badge/API-WeChat%20iLink-07C160?logo=wechat&logoColor=white)](https://ilinkai.weixin.qq.com)

[English](#english) · [快速开始](#快速开始) · [架构原理](#架构原理) · [配置参考](#配置参考) · [踩坑指南](#踩坑指南)

---

<img src="https://img.shields.io/badge/Claude%20Code-Channel%20Plugin-orange?style=for-the-badge&logo=anthropic" alt="Claude Code Channel Plugin"/>

> 让你的微信私信直接对话 Claude Code，扫码登录，5 分钟上线。

</div>

---

## ✨ 功能亮点

| 功能 | 说明 |
|------|------|
| 🔐 **扫码登录** | 使用微信官方 iLink API，扫一下二维码即完成授权，无需抓包或第三方框架 |
| ⚡ **零中间层** | MCP Server 直连微信 iLink 后端，消息延迟极低 |
| 🛡️ **访问控制** | 内置 Pairing（配对码）/ Allowlist 双模式，防止陌生人滥用 |
| 📨 **长轮询** | 后台持续轮询，消息实时送达 Claude Code |
| 🔄 **自动分段** | 超 2000 字的回复自动拆分发送，微信不截断 |
| 📜 **消息历史** | 内存维护最近 50 条对话记录，支持 `fetch_messages` 回溯 |
| 🎯 **MCP Channel 协议** | 原生对接 Claude Code `--channels` 标志，与 Discord 插件同等地位 |

---

## 架构原理

```
┌──────────────┐     微信私信      ┌─────────────────────────┐
│   微信用户    │ ──────────────▶  │  WeChat iLink API        │
│  (手机端)    │                  │  ilinkai.weixin.qq.com   │
└──────────────┘                  └────────────┬────────────┘
                                               │ 长轮询 (ilink/bot/getupdates)
                                               ▼
                                  ┌─────────────────────────┐
                                  │   server.ts (Bun)        │
                                  │   MCP Channel Server     │
                                  │                         │
                                  │  • 访问控制              │
                                  │  • context_token 缓存   │
                                  │  • 消息历史              │
                                  └────────────┬────────────┘
                                               │ notifications/claude/channel
                                               ▼
                                  ┌─────────────────────────┐
                                  │     Claude Code          │
                                  │   (claude --channels)    │
                                  └─────────────────────────┘
```

**数据流：**
1. 微信用户发送私信 → iLink 后端持有
2. `server.ts` 长轮询 `ilink/bot/getupdates`，拿到新消息
3. 检查发送者是否在 allowlist → 通过则发 `notifications/claude/channel` 给 Claude
4. Claude 调用 `reply` 工具 → server.ts POST `ilink/bot/sendmessage` → 微信用户收到回复

---

## 快速开始

### 前提条件

- [Bun](https://bun.sh) ≥ 1.0
- [Claude Code](https://claude.ai/code) v2.1.80+ 已安装
- 一个微信账号（用于扫码授权）

### 方式一：从 GitHub 安装（推荐）

```bash
claude plugin marketplace add weicyruc/claude-weixin-channel
claude plugin install weixin@weicyruc-plugins
```

### 方式二：从本地克隆安装

```bash
git clone https://github.com/weicyruc/claude-weixin-channel.git
cd claude-weixin-channel
./install.sh
```

安装脚本会自动完成：
- 安装 npm 依赖（`bun install`）
- 通过 `claude plugin` CLI 注册插件，使 `/weixin:configure` 等技能生效

### 2. 重启 Claude Code

**必须完整退出并重启**才能加载插件和技能。

### 3. 扫码登录微信

启动 Claude Code，运行登录技能：

```
/weixin:configure
```

终端会出现 ASCII 二维码，用微信扫码并在手机上确认授权。登录凭证自动保存到 `~/.claude/channels/weixin/account.json`。

### 4. 启动频道

> **注意**：非官方插件需要加 `--dangerously-load-development-channels` 标志，这是 Claude Code [channels 研究预览期](https://code.claude.com/docs/en/channels-reference#test-during-the-research-preview)的要求。**必须在启动时带上这个标志，否则微信消息不会转发给 Claude。**

```bash
claude --dangerously-load-development-channels plugin:weixin@weicyruc-plugins
```

### 5. 配对第一个用户

默认策略为 `pairing`（配对）模式：

1. 微信好友向你的账号发送**任意消息**
2. 对方收到配对码，例如：`配对请求 — 请在 Claude Code 中运行：\n/weixin:access pair a1b2c3`
3. 在步骤 4 启动的 Claude Code 会话中运行：

```
/weixin:access pair a1b2c3
```

4. 对方的后续消息将直接转发给 Claude ✅

---

## 配置参考

### 目录结构

```
~/.claude/channels/weixin/
├── account.json       # 登录凭证（bot_token, base_url, account_id）
└── access.json        # 访问控制（allowFrom, policy, pending）
```

### account.json

登录成功后自动写入，无需手动编辑：

```json
{
  "bot_token": "eyJ...",
  "base_url": "https://ilinkai.weixin.qq.com",
  "account_id": "xxxxxxxx@im.bot"
}
```

### access.json

```json
{
  "policy": "pairing",
  "allowFrom": ["user123@im.wechat"],
  "pending": {}
}
```

| 字段 | 说明 |
|------|------|
| `policy` | `pairing`：未知用户收到配对码；`allowlist`：未知用户静默丢弃 |
| `allowFrom` | 已授权的微信用户 ID 列表 |
| `pending` | 等待确认的配对码（5 分钟过期） |

---

## MCP 工具参考

Claude Code 启动后可调用以下工具：

| 工具 | 参数 | 说明 |
|------|------|------|
| `reply` | `chat_id`, `text`, `context_token` | 向指定微信用户发送文本消息，超长自动分段 |
| `fetch_messages` | `chat_id`, `limit?` | 获取最近消息历史（最多 50 条） |
| `weixin_access` | `action`, `value?` | 访问控制：`pair <code>` / `policy <mode>` / `list` |
| `weixin_qr_login` | — | 发起 QR 登录，返回二维码 URL |
| `weixin_poll_login` | `qrcode` | 轮询登录状态，确认后自动保存凭证 |

---

## Skills（技能）

| 技能 | 触发方式 | 说明 |
|------|---------|------|
| `/weixin:configure` | 首次配置 | 引导完成扫码登录全流程 |
| `/weixin:access pair <code>` | 配对新用户 | 通过配对码授权微信用户 |
| `/weixin:access policy <mode>` | 切换策略 | 在 pairing / allowlist 之间切换 |
| `/weixin:access list` | 查看白名单 | 显示当前策略和已授权用户列表 |

---

## 踩坑指南

> 以下是实际配置过程中遇到的所有问题及解决方法，按操作顺序排列。

### ❌ 坑 1：`Unknown skill: weixin:configure`

**现象**：安装后运行 `/weixin:configure`，提示 `Unknown skill`。

**原因**：Claude Code 的插件技能（Skills）必须通过 `claude plugin install` CLI 命令安装，才能被加载。直接编辑 `installed_plugins.json` 或 `~/.claude.json` 等配置文件**不会让技能生效**。

**解决**：使用 `./install.sh`（本项目已自动处理），或手动运行：
```bash
claude plugin marketplace add weicyruc/claude-weixin-channel
claude plugin install weixin@weicyruc-plugins
```

然后**完整重启 Claude Code**。

---

### ❌ 坑 2：安装后技能仍不可用

**现象**：`install.sh` 运行成功，但重启后仍报 `Unknown skill`。

**原因**：`install.sh` 使用 `file://$PLUGIN_ROOT/.git` 从本地 git 仓库安装插件。如果安装脚本**在 `git commit` 之前**运行，git 里存的是旧代码，技能文件不是最新版。

**解决**：每次修改代码后，先提交再安装：
```bash
git add -A && git commit -m "update"
./install.sh
```

---

### ❌ 坑 3：微信消息发出后没有收到配对码

**现象**：向 Bot 发送消息后，对方没有收到配对码提示。

**原因可能有两个**：

1. **Claude Code 没有用正确的启动命令**：必须带 `--dangerously-load-development-channels plugin:weixin@weicyruc-plugins` 启动，否则 server 虽然在运行但消息不会传给 Claude，配对逻辑也不会被触发通知。

2. **Server 没有在正确的 Claude 会话中运行**：配对码的发送是由 server.ts 直接调用微信 API 完成的，不依赖 Claude；但如果 server 没有启动，就不会有任何响应。

**解决**：确保用以下命令启动 Claude Code：
```bash
claude --dangerously-load-development-channels plugin:weixin@weicyruc-plugins
```

---

### ❌ 坑 4：收到配对码、配对成功，但 Claude 没有收到后续消息

**现象**：`/weixin:access pair xxx` 配对成功，微信继续发消息，但 Claude Code 里没有任何反应。

**原因**：Channel 消息只有在用 `--dangerously-load-development-channels` 标志启动的 Claude Code 会话中才能接收。如果你在**另一个普通 Claude 会话**里运行了 `/weixin:access pair`，那个会话无法接收 channel 通知。

**解决**：必须在同一个带 `--dangerously-load-development-channels plugin:weixin@weicyruc-plugins` 启动的会话里完成配对和对话：
```bash
# 正确做法：在这个会话里完成所有操作
claude --dangerously-load-development-channels plugin:weixin@weicyruc-plugins
# 然后在此会话内运行 /weixin:access pair <code>
```

---

### ❌ 坑 5：移除 marketplace 导致插件被一并卸载

**现象**：运行 `claude plugin marketplace remove weicyruc-plugins` 后，插件也消失了。

**原因**：Claude Code 的 marketplace 和插件绑定，移除 marketplace 会同时卸载其所有插件。

**解决**：保持 marketplace 注册状态。`install.sh` 已经将 `$PLUGIN_ROOT` 目录作为永久 marketplace 注册到用户设置中，不要手动移除。

---

### ❌ 坑 6：`server: entries need --dangerously-load-development-channels`

**现象**：启动 Claude Code 后看到 `server:weixin · server: entries need --dangerously-load-development-channels` 提示。

**原因**：这是 Claude Code 在提示你该 channel server 需要特殊标志才能激活。这是正常提示，不是错误。

**解决**：按提示使用完整命令启动：
```bash
claude --dangerously-load-development-channels plugin:weixin@weicyruc-plugins
```

---

### 完整的正确操作流程

```
1. 安装（首次或更新后）
   git add -A && git commit -m "your changes"  # 先提交
   ./install.sh                                  # 再安装

2. 重启 Claude Code（完整退出）

3. 扫码登录（只需做一次）
   # 在普通 Claude 会话中运行：
   /weixin:configure

4. 启动频道（每次使用）
   claude --dangerously-load-development-channels plugin:weixin@weicyruc-plugins

5. 配对用户（在步骤 4 的会话中）
   # 微信好友发送任意消息 → 对方收到配对码
   /weixin:access pair <code>
```

---

## 技术原理：WeChat iLink API

本项目直接对接腾讯微信的 iLink Bot API，**无需任何第三方 hook 框架**。

### 认证流程

```
GET /ilink/bot/get_bot_qrcode?bot_type=3
  → { qrcode: "...", qrcode_img_content: "<扫码URL>" }

GET /ilink/bot/get_qrcode_status?qrcode=<qrcode>  (长轮询)
  → { status: "confirmed", bot_token: "eyJ...", baseurl: "..." }
```

### 请求头

```
Content-Type: application/json
AuthorizationType: ilink_bot_token
Authorization: Bearer <bot_token>
X-WECHAT-UIN: <随机uint32→base64>
```

### 消息收发

```
POST ilink/bot/getupdates   → 长轮询，带 get_updates_buf 游标
POST ilink/bot/sendmessage  → 发送回复（需回传 context_token）
```

**getupdates 请求体：**
```json
{
  "get_updates_buf": "<上次返回的游标，首次为空>",
  "base_info": { "channel_version": "1.0.0" }
}
```

**getupdates 响应：**
```json
{
  "get_updates_buf": "<新游标>",
  "msgs": [{
    "from_user_id": "xxx@im.wechat",
    "context_token": "...",
    "message_type": 1,
    "item_list": [{ "type": 1, "text_item": { "text": "消息内容" } }]
  }]
}
```

**sendmessage 请求体：**
```json
{
  "msg": {
    "to_user_id": "xxx@im.wechat",
    "client_id": "唯一消息ID",
    "message_type": 2,
    "message_state": 2,
    "item_list": [{ "type": 1, "text_item": { "text": "回复内容" } }],
    "context_token": "<从收到的消息中取出>"
  },
  "base_info": { "channel_version": "1.0.0" }
}
```

> sendmessage 接口响应较慢（可能 >10s），请勿设置过短的超时。

> 完整 API 文档参见 [@tencent-weixin/openclaw-weixin](https://www.npmjs.com/package/@tencent-weixin/openclaw-weixin) 官方包的 README。

---

## 与 Discord 插件对比

本项目的设计与 [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins/discord) 官方 Discord 插件完全对齐：

| 特性 | Discord 插件 | 本项目（WeChat） |
|------|-------------|-----------------|
| 协议 | Claude Code Channel (MCP) | Claude Code Channel (MCP) |
| 运行时 | Bun | Bun |
| 消息获取 | Gateway (WebSocket) | 长轮询 |
| 访问控制 | Pairing + Allowlist | Pairing + Allowlist |
| 工具 | reply, react, edit, fetch | reply, fetch |
| 认证 | Bot Token | iLink QR → Bot Token |

---

## 常见问题

**Q: 这是官方微信 Bot 吗？**
A: 本项目使用腾讯微信 iLink Bot API（`ilinkai.weixin.qq.com`），该 API 由微信官方团队提供，与 [@tencent-weixin/openclaw-weixin](https://www.npmjs.com/package/@tencent-weixin/openclaw-weixin) 使用同一套接口。

**Q: 会不会封号？**
A: iLink API 是微信提供的官方 Bot 接口，不属于逆向工程或协议模拟，风险极低。

**Q: 支持群消息吗？**
A: 当前版本仅支持私信（direct message）。群消息支持计划中。

**Q: 凭证存在哪里？**
A: `~/.claude/channels/weixin/account.json`，仅本地存储，不上传任何服务器。

**Q: 为什么需要 `--dangerously-load-development-channels`？**
A: 这是 Claude Code channels 功能研究预览期的要求，所有非官方插件的 channel server 都需要此标志。官方插件（如 Discord）不需要。

---

## 贡献

欢迎 PR 和 Issue！

```bash
git clone https://github.com/weicyruc/claude-weixin-channel.git
cd claude-weixin-channel
bun install
bun run server.ts  # 需先完成登录
```

---

## License

[MIT](LICENSE) © 2026 weicyruc

---

<div id="english"></div>

## English Summary

**claude-weixin-channel** is a Claude Code channel plugin that connects WeChat direct messages to Claude AI using the official WeChat iLink Bot API — no reverse engineering, no third-party hooking frameworks.

**How it works:**
1. Scan a QR code to authorize a WeChat bot account
2. Start the channel: `claude --dangerously-load-development-channels plugin:weixin@weicyruc-plugins`
3. WeChat DMs are forwarded to Claude Code via `notifications/claude/channel`
4. Claude replies using the `reply` MCP tool

**Architecture:** WeChat iLink long-polling → Bun MCP server → Claude Code Channel protocol

**Key setup steps:**
1. Install: `./install.sh` (or `claude plugin marketplace add` + `claude plugin install`)
2. **Fully restart Claude Code** after installation
3. Login: run `/weixin:configure` in a normal Claude session (scan QR code)
4. Start channel: `claude --dangerously-load-development-channels plugin:weixin@weicyruc-plugins`
5. Pair users: any WeChat message triggers a pairing code; confirm with `/weixin:access pair <code>` **in the channel session**

**Common pitfalls:**
- Skills (`/weixin:configure`) only work after proper `claude plugin install`, not manual JSON editing
- Must restart Claude Code after install
- `--dangerously-load-development-channels plugin:weixin@weicyruc-plugins` is required — without it, messages are not forwarded to Claude
- Pairing and chatting must happen in the same `--dangerously-load-development-channels` session
- If using local clone: always `git commit` before running `./install.sh`

Built with ❤️ by [weicyruc](https://github.com/weicyruc), inspired by the official [Discord plugin](https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins/discord) from Anthropic.

</div>
