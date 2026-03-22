<div align="center">

# 🤖 Claude Code × WeChat

**将 Claude AI 接入微信私信 — 官方 iLink API · 零中间层 · 开箱即用**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/Runtime-Bun-black?logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/Language-TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![MCP](https://img.shields.io/badge/Protocol-MCP-purple)](https://modelcontextprotocol.io)
[![WeChat iLink](https://img.shields.io/badge/API-WeChat%20iLink-07C160?logo=wechat&logoColor=white)](https://ilinkai.weixin.qq.com)

[English](#english) · [快速开始](#快速开始) · [架构原理](#架构原理) · [配置参考](#配置参考)

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
| 🔄 **自动分段** | 超 4000 字的回复自动拆分发送，微信不截断 |
| 📜 **消息历史** | 内存维护最近 50 条对话记录，支持 `fetch_messages` 回溯 |
| 🎯 **MCP Channel 协议** | 原生对接 Claude Code `--channels` 标志，与 Discord 插件同等地位 |

---

## 架构原理

```
┌──────────────┐     微信私信      ┌─────────────────────────┐
│   微信用户    │ ──────────────▶  │  WeChat iLink API        │
│  (手机端)    │                  │  ilinkai.weixin.qq.com   │
└──────────────┘                  └────────────┬────────────┘
                                               │ 长轮询 (getupdates)
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
2. `server.ts` 长轮询 `/getupdates`，拿到新消息
3. 检查发送者是否在 allowlist → 通过则发 `notifications/claude/channel` 给 Claude
4. Claude 调用 `reply` 工具 → server.ts POST `/sendmessage` → 微信用户收到回复

---

## 快速开始

### 前提条件

- [Bun](https://bun.sh) ≥ 1.0
- [Claude Code](https://claude.ai/code) 已安装
- 一个微信账号（用于扫码授权）

### 1. 克隆并安装依赖

```bash
git clone https://github.com/weicyruc/claude-weixin-channel.git
cd claude-weixin-channel
bun install
```

### 2. 扫码登录微信

启动 Claude Code，运行登录技能：

```
/weixin:configure
```

终端会出现 ASCII 二维码，用微信扫码并在手机上确认授权。登录凭证自动保存到 `~/.claude/channels/weixin/account.json`。

### 3. 启动频道

```bash
claude --channels server:weixin
```

> 或者在已有会话中通过 MCP 配置加载。

### 4. 配对第一个用户

默认策略为 `pairing`（配对）模式：

1. 微信好友向你的账号发送任意消息
2. 对方收到配对码，例如：`配对请求 — 请在 Claude Code 中运行：\n/weixin:access pair a1b2c3`
3. 在 Claude Code 中运行：

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
| `reply` | `chat_id`, `text` | 向指定微信用户发送文本消息，超长自动分段 |
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
POST /getupdates  → 长轮询，拿新消息
POST /sendmessage → 发送回复（需回传 context_token）
```

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
2. Start the MCP server: `claude --channels server:weixin`
3. WeChat DMs are forwarded to Claude Code via `notifications/claude/channel`
4. Claude replies using the `reply` MCP tool

**Architecture:** WeChat iLink long-polling → Bun MCP server → Claude Code Channel protocol

Built with ❤️ by [weicyruc](https://github.com/weicyruc), inspired by the official [Discord plugin](https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins/discord) from Anthropic.

</div>
