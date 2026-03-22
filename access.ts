import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import * as path from "path"
import * as crypto from "crypto"
export interface AccessConfig {
  /** "pairing": unknown users receive a pairing code; "allowlist": silently drop unknowns */
  policy: "pairing" | "allowlist"
  /** Allowed WeChat user IDs (e.g. "user123@im.wechat") */
  allowFrom: string[]
  /** Pending pairing codes: code -> { chatId, ts } */
  pending: Record<string, { chatId: string; ts: number }>
}

const DEFAULT: AccessConfig = {
  policy: "pairing",
  allowFrom: [],
  pending: {},
}

export class AccessManager {
  private configPath: string

  constructor(stateDir: string) {
    mkdirSync(stateDir, { recursive: true })
    this.configPath = path.join(stateDir, "access.json")
  }

  load(): AccessConfig {
    if (!existsSync(this.configPath)) return { ...DEFAULT }
    try {
      return { ...DEFAULT, ...JSON.parse(readFileSync(this.configPath, "utf8")) }
    } catch {
      return { ...DEFAULT }
    }
  }

  save(cfg: AccessConfig): void {
    writeFileSync(this.configPath, JSON.stringify(cfg, null, 2))
  }

  isAllowed(cfg: AccessConfig, userId: string): boolean {
    return cfg.allowFrom.includes(userId)
  }

  createPairingCode(chatId: string): string {
    const cfg = this.load()
    const code = crypto.randomBytes(3).toString("hex").toUpperCase()
    const now = Date.now()
    // Prune expired codes (1 hour TTL)
    for (const k of Object.keys(cfg.pending)) {
      if (now - cfg.pending[k].ts > 3_600_000) delete cfg.pending[k]
    }
    cfg.pending[code] = { chatId, ts: now }
    this.save(cfg)
    return code
  }

  /** Approve a pairing code. Returns the chatId on success, null on failure. */
  approvePairing(code: string): string | null {
    const cfg = this.load()
    const entry = cfg.pending[code]
    if (!entry) return null
    if (Date.now() - entry.ts > 3_600_000) {
      delete cfg.pending[code]
      this.save(cfg)
      return null
    }
    if (!cfg.allowFrom.includes(entry.chatId)) {
      cfg.allowFrom.push(entry.chatId)
    }
    delete cfg.pending[code]
    this.save(cfg)
    return entry.chatId
  }
}
