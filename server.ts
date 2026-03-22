import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { randomBytes } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

// ── Constants ──────────────────────────────────────────────────────────────────

const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";
const STATE_DIR = join(homedir(), ".claude", "channels", "weixin");
const ACCOUNT_FILE = join(STATE_DIR, "account.json");
const ACCESS_FILE = join(STATE_DIR, "access.json");
const MAX_HISTORY = 50;
const MAX_TEXT_LEN = 4000;
const POLL_TIMEOUT_MS = 35_000;
const PAIRING_CODE_TTL_MS = 5 * 60 * 1000;

// ── Types ──────────────────────────────────────────────────────────────────────

interface AccountConfig {
  bot_token: string;
  base_url: string;
  account_id: string;
}

interface AccessConfig {
  allowFrom: string[];
  policy: "allowlist" | "pairing";
  pending: Record<
    string,
    { senderId: string; chatId: string; createdAt: number; expiresAt: number }
  >;
}

interface MessageItem {
  type: number;
  text_item?: { text: string };
}

interface WeixinMessage {
  message_id?: number;
  from_user_id?: string;
  to_user_id?: string;
  create_time_ms?: number;
  session_id?: string;
  message_type?: number;
  message_state?: number;
  item_list?: MessageItem[];
  context_token?: string;
}

interface StoredMessage {
  chat_id: string;
  message_id: string;
  user: string;
  text: string;
  ts: string;
  type: "user" | "bot";
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function generateWechatUin(): string {
  const buf = randomBytes(4);
  const num = buf.readUInt32BE(0);
  return Buffer.from(String(num)).toString("base64");
}

function generatePairingCode(): string {
  return randomBytes(3).toString("hex");
}

function loadJson<T>(path: string, fallback: T): T {
  try {
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, "utf-8")) as T;
    }
  } catch {
    // ignore
  }
  return fallback;
}

function saveJson(path: string, data: unknown) {
  ensureDir(STATE_DIR);
  writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
}

// ── WeChat API ─────────────────────────────────────────────────────────────────

class WeChatAPI {
  private botToken: string;
  private baseUrl: string;
  private getUpdatesBuf = "";

  constructor(config: AccountConfig) {
    this.botToken = config.bot_token;
    this.baseUrl = config.base_url || DEFAULT_BASE_URL;
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      AuthorizationType: "ilink_bot_token",
      Authorization: `Bearer ${this.botToken}`,
      "X-WECHAT-UIN": generateWechatUin(),
    };
  }

  async getUpdates(
    signal?: AbortSignal
  ): Promise<{ msgs: WeixinMessage[]; buf: string }> {
    const resp = await fetch(`${this.baseUrl}/getupdates`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ get_updates_buf: this.getUpdatesBuf }),
      signal,
    });
    if (!resp.ok) throw new Error(`getupdates failed: ${resp.status}`);
    const data = (await resp.json()) as {
      ret: number;
      msgs?: WeixinMessage[];
      get_updates_buf?: string;
    };
    if (data.get_updates_buf) this.getUpdatesBuf = data.get_updates_buf;
    return { msgs: data.msgs ?? [], buf: this.getUpdatesBuf };
  }

  async sendMessage(
    toUserId: string,
    text: string,
    contextToken: string
  ): Promise<void> {
    const resp = await fetch(`${this.baseUrl}/sendmessage`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        msg: {
          to_user_id: toUserId,
          context_token: contextToken,
          message_type: 2,
          message_state: 2,
          item_list: [{ type: 1, text_item: { text } }],
        },
      }),
    });
    if (!resp.ok) throw new Error(`sendmessage failed: ${resp.status}`);
  }

  static async getQrCode(): Promise<{
    qrcode: string;
    qrcode_img_content: string;
  }> {
    const resp = await fetch(
      `${DEFAULT_BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=3`
    );
    if (!resp.ok) throw new Error(`get_bot_qrcode failed: ${resp.status}`);
    return (await resp.json()) as {
      qrcode: string;
      qrcode_img_content: string;
    };
  }

  static async pollQrStatus(qrcode: string): Promise<{
    status: string;
    bot_token?: string;
    ilink_bot_id?: string;
    baseurl?: string;
  }> {
    const resp = await fetch(
      `${DEFAULT_BASE_URL}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`
    );
    if (!resp.ok)
      throw new Error(`get_qrcode_status failed: ${resp.status}`);
    return (await resp.json()) as {
      status: string;
      bot_token?: string;
      ilink_bot_id?: string;
      baseurl?: string;
    };
  }
}

// ── Access Control ─────────────────────────────────────────────────────────────

class AccessControl {
  private config: AccessConfig;

  constructor() {
    this.config = loadJson<AccessConfig>(ACCESS_FILE, {
      allowFrom: [],
      policy: "pairing",
      pending: {},
    });
  }

  isAllowed(senderId: string): boolean {
    return this.config.allowFrom.includes(senderId);
  }

  addPairing(senderId: string, chatId: string): string {
    this.cleanExpired();
    for (const [code, entry] of Object.entries(this.config.pending)) {
      if (entry.senderId === senderId) return code;
    }
    const code = generatePairingCode();
    this.config.pending[code] = {
      senderId,
      chatId,
      createdAt: Date.now(),
      expiresAt: Date.now() + PAIRING_CODE_TTL_MS,
    };
    this.save();
    return code;
  }

  confirmPairing(code: string): { senderId: string; chatId: string } | null {
    this.cleanExpired();
    const entry = this.config.pending[code];
    if (!entry) return null;
    if (!this.config.allowFrom.includes(entry.senderId)) {
      this.config.allowFrom.push(entry.senderId);
    }
    const result = { senderId: entry.senderId, chatId: entry.chatId };
    delete this.config.pending[code];
    this.save();
    return result;
  }

  setPolicy(policy: "allowlist" | "pairing") {
    this.config.policy = policy;
    this.save();
  }

  getPolicy(): string {
    return this.config.policy;
  }

  getAllowList(): string[] {
    return [...this.config.allowFrom];
  }

  private cleanExpired() {
    const now = Date.now();
    for (const [code, entry] of Object.entries(this.config.pending)) {
      if (entry.expiresAt < now) delete this.config.pending[code];
    }
  }

  private save() {
    saveJson(ACCESS_FILE, this.config);
  }
}

// ── Main Server ────────────────────────────────────────────────────────────────

ensureDir(STATE_DIR);
const accountConfig = loadJson<AccountConfig | null>(ACCOUNT_FILE, null);

if (!accountConfig || !accountConfig.bot_token) {
  console.error(
    "❌ WeChat not configured. Run /weixin:configure in Claude Code to log in."
  );
  process.exit(1);
}

const wechat = new WeChatAPI(accountConfig);
const access = new AccessControl();

const contextTokens = new Map<string, string>();
const messageHistory = new Map<string, StoredMessage[]>();
let polling = true;

function addToHistory(chatId: string, msg: StoredMessage) {
  let history = messageHistory.get(chatId);
  if (!history) {
    history = [];
    messageHistory.set(chatId, history);
  }
  history.push(msg);
  if (history.length > MAX_HISTORY) history.shift();
}

function extractText(msg: WeixinMessage): string {
  if (!msg.item_list) return "";
  return msg.item_list
    .filter((item) => item.type === 1 && item.text_item?.text)
    .map((item) => item.text_item!.text)
    .join("\n");
}

// ── MCP Server Setup ──────────────────────────────────────────────────────────

const server = new Server(
  { name: "weixin", version: "1.0.0" },
  {
    capabilities: {
      tools: {},
      experimental: { "claude/channel": {} },
    },
    instructions: [
      'Messages from WeChat arrive as <channel source="weixin" chat_id="..." message_id="..." user="..." ts="...">.',
      "Reply with the reply tool — pass chat_id back.",
      "Use fetch_messages to retrieve recent history for a chat.",
      "Access control: use weixin_access to manage allowed users and pairing.",
    ].join("\n"),
  }
);

// ── Tools ──────────────────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "reply",
      description:
        "Send a text reply to a WeChat user. Long messages are automatically split.",
      inputSchema: {
        type: "object" as const,
        properties: {
          chat_id: {
            type: "string",
            description: "The chat_id (WeChat user ID) to reply to",
          },
          text: { type: "string", description: "The text to send" },
        },
        required: ["chat_id", "text"],
      },
    },
    {
      name: "fetch_messages",
      description:
        "Fetch recent message history for a WeChat chat (up to 50 messages in memory).",
      inputSchema: {
        type: "object" as const,
        properties: {
          chat_id: {
            type: "string",
            description: "The chat_id to fetch messages for",
          },
          limit: {
            type: "number",
            description: "Max messages to return (default 20)",
          },
        },
        required: ["chat_id"],
      },
    },
    {
      name: "weixin_access",
      description:
        "Manage WeChat access control. Actions: pair <code>, policy <allowlist|pairing>, list",
      inputSchema: {
        type: "object" as const,
        properties: {
          action: {
            type: "string",
            description: "Action: 'pair', 'policy', or 'list'",
          },
          value: {
            type: "string",
            description:
              "For pair: the pairing code. For policy: 'allowlist' or 'pairing'.",
          },
        },
        required: ["action"],
      },
    },
    {
      name: "weixin_qr_login",
      description:
        "Start WeChat QR code login flow. Returns the QR code URL for display.",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
    {
      name: "weixin_poll_login",
      description:
        "Poll WeChat QR login status. Returns current status and saves credentials on success.",
      inputSchema: {
        type: "object" as const,
        properties: {
          qrcode: {
            type: "string",
            description: "The qrcode string from weixin_qr_login",
          },
        },
        required: ["qrcode"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "reply": {
      const chatId = args?.chat_id as string;
      const text = args?.text as string;
      if (!chatId || !text) {
        return {
          content: [{ type: "text", text: "Missing chat_id or text" }],
          isError: true,
        };
      }
      const contextToken = contextTokens.get(chatId);
      if (!contextToken) {
        return {
          content: [
            {
              type: "text",
              text: `No context_token found for chat_id=${chatId}. The user may not have sent a message yet.`,
            },
          ],
          isError: true,
        };
      }
      try {
        const chunks: string[] = [];
        for (let i = 0; i < text.length; i += MAX_TEXT_LEN) {
          chunks.push(text.slice(i, i + MAX_TEXT_LEN));
        }
        for (const chunk of chunks) {
          await wechat.sendMessage(chatId, chunk, contextToken);
        }
        addToHistory(chatId, {
          chat_id: chatId,
          message_id: `bot-${Date.now()}`,
          user: "bot",
          text,
          ts: new Date().toISOString(),
          type: "bot",
        });
        return {
          content: [
            {
              type: "text",
              text: `Sent${chunks.length > 1 ? ` (${chunks.length} parts)` : ""} to ${chatId}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            { type: "text", text: `Send failed: ${(err as Error).message}` },
          ],
          isError: true,
        };
      }
    }

    case "fetch_messages": {
      const chatId = args?.chat_id as string;
      if (!chatId) {
        return {
          content: [{ type: "text", text: "Missing chat_id" }],
          isError: true,
        };
      }
      const limit = (args?.limit as number) || 20;
      const history = messageHistory.get(chatId) ?? [];
      const recent = history.slice(-limit);
      return {
        content: [{ type: "text", text: JSON.stringify(recent, null, 2) }],
      };
    }

    case "weixin_access": {
      const action = args?.action as string;
      const value = args?.value as string;

      switch (action) {
        case "pair": {
          if (!value) {
            return {
              content: [{ type: "text", text: "Missing pairing code" }],
              isError: true,
            };
          }
          const result = access.confirmPairing(value);
          if (!result) {
            return {
              content: [
                { type: "text", text: "Invalid or expired pairing code." },
              ],
              isError: true,
            };
          }
          return {
            content: [
              {
                type: "text",
                text: `✅ Paired! User ${result.senderId} is now allowed.`,
              },
            ],
          };
        }
        case "policy": {
          if (value !== "allowlist" && value !== "pairing") {
            return {
              content: [
                { type: "text", text: "Policy must be 'allowlist' or 'pairing'" },
              ],
              isError: true,
            };
          }
          access.setPolicy(value);
          return {
            content: [{ type: "text", text: `Policy set to: ${value}` }],
          };
        }
        case "list": {
          const list = access.getAllowList();
          return {
            content: [
              {
                type: "text",
                text: `Policy: ${access.getPolicy()}\nAllowed users (${list.length}):\n${list.join("\n") || "(none)"}`,
              },
            ],
          };
        }
        default:
          return {
            content: [
              {
                type: "text",
                text: `Unknown action: ${action}. Use 'pair', 'policy', or 'list'.`,
              },
            ],
            isError: true,
          };
      }
    }

    case "weixin_qr_login": {
      try {
        const qr = await WeChatAPI.getQrCode();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                qrcode: qr.qrcode,
                qrcode_img_content: qr.qrcode_img_content,
                instructions:
                  "Use mcp__mcp-qr-terminal__display_qr_from_text with the qrcode_img_content URL to display the QR code, then call weixin_poll_login with the qrcode value.",
              }),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            { type: "text", text: `QR login failed: ${(err as Error).message}` },
          ],
          isError: true,
        };
      }
    }

    case "weixin_poll_login": {
      const qrcode = args?.qrcode as string;
      if (!qrcode) {
        return {
          content: [{ type: "text", text: "Missing qrcode parameter" }],
          isError: true,
        };
      }
      try {
        const result = await WeChatAPI.pollQrStatus(qrcode);
        if (result.status === "confirmed" && result.bot_token) {
          const config: AccountConfig = {
            bot_token: result.bot_token,
            base_url: result.baseurl || DEFAULT_BASE_URL,
            account_id: result.ilink_bot_id || "",
          };
          ensureDir(STATE_DIR);
          saveJson(ACCOUNT_FILE, config);
          return {
            content: [
              {
                type: "text",
                text: `✅ Login successful! Credentials saved to ${ACCOUNT_FILE}. Restart Claude Code with --channel weixin to activate.`,
              },
            ],
          };
        }
        return {
          content: [
            {
              type: "text",
              text: `Status: ${result.status}. ${result.status === "wait" ? "Waiting for scan..." : result.status === "scaned" ? "Scanned, waiting for confirmation..." : ""}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            { type: "text", text: `Poll failed: ${(err as Error).message}` },
          ],
          isError: true,
        };
      }
    }

    default:
      return {
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
        isError: true,
      };
  }
});

// ── Long Polling Loop ──────────────────────────────────────────────────────────

async function pollLoop() {
  while (polling) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), POLL_TIMEOUT_MS);

      let result: { msgs: WeixinMessage[]; buf: string };
      try {
        result = await wechat.getUpdates(controller.signal);
      } finally {
        clearTimeout(timeout);
      }

      for (const msg of result.msgs) {
        if (msg.message_type !== 1) continue;

        const chatId = msg.from_user_id ?? "";
        const messageId = msg.session_id ?? String(msg.message_id ?? "");
        const text = extractText(msg);
        if (!chatId || !text) continue;

        if (msg.context_token) {
          contextTokens.set(chatId, msg.context_token);
        }

        const stored: StoredMessage = {
          chat_id: chatId,
          message_id: messageId,
          user: chatId,
          text,
          ts: msg.create_time_ms
            ? new Date(msg.create_time_ms).toISOString()
            : new Date().toISOString(),
          type: "user",
        };
        addToHistory(chatId, stored);

        if (!access.isAllowed(chatId)) {
          if (access.getPolicy() === "pairing") {
            const code = access.addPairing(chatId, chatId);
            if (msg.context_token) {
              try {
                await wechat.sendMessage(
                  chatId,
                  `配对请求 — 请在 Claude Code 中运行：\n/weixin:access pair ${code}`,
                  msg.context_token
                );
              } catch (err) {
                console.error(
                  `Failed to send pairing message: ${(err as Error).message}`
                );
              }
            }
          }
          continue;
        }

        try {
          await server.notification({
            method: "notifications/claude/channel",
            params: {
              content: text,
              meta: {
                chat_id: chatId,
                message_id: messageId,
                user: chatId,
                ts: stored.ts,
              },
            },
          });
        } catch (err) {
          console.error(
            `Failed to send notification: ${(err as Error).message}`
          );
        }
      }
    } catch (err) {
      const msg = (err as Error).message ?? "";
      if (!msg.includes("abort") && !msg.includes("AbortError")) {
        console.error(`Poll error: ${msg}`);
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

// ── Startup ────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  pollLoop().catch((err) =>
    console.error(`Poll loop crashed: ${(err as Error).message}`)
  );

  process.stdin.on("end", () => {
    polling = false;
  });
  process.on("SIGINT", () => {
    polling = false;
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    polling = false;
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(`Fatal: ${(err as Error).message}`);
  process.exit(1);
});
