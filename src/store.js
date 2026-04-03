import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from "node:fs";
import { join, normalize, isAbsolute } from "node:path";
import { homedir, platform } from "node:os";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const HOME = homedir();
const IS_WIN = platform() === "win32";
const CONFIG_DIR = join(HOME, ".clisync");
const OLD_CONFIG_DIR = join(HOME, ".llm-sync"); // backward compat
const AUTH_FILE = join(CONFIG_DIR, "auth.json");
const API = "https://api.github.com";
const GIST_DESC = "clisync: LLM CLI settings";
const OLD_GIST_DESC = "llm-sync: LLM CLI settings"; // backward compat
const MAX_GIST_SIZE = 9 * 1024 * 1024;

// ─── Local config ─────────────────────────────────────

function migrateOldConfig() {
  if (existsSync(OLD_CONFIG_DIR) && !existsSync(CONFIG_DIR)) {
    const oldAuth = join(OLD_CONFIG_DIR, "auth.json");
    if (existsSync(oldAuth)) {
      mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
      writeFileSync(AUTH_FILE, readFileSync(oldAuth, "utf-8"), { mode: 0o600 });
    }
  }
}

function readConfig() {
  migrateOldConfig();
  if (!existsSync(AUTH_FILE)) return {};
  try { return JSON.parse(readFileSync(AUTH_FILE, "utf-8")); }
  catch { return {}; }
}

function writeConfig(data) {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(AUTH_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
  if (!IS_WIN) {
    try { chmodSync(CONFIG_DIR, 0o700); } catch { /* best effort */ }
    try { chmodSync(AUTH_FILE, 0o600); } catch { /* best effort */ }
  }
}

export function isInitialized() {
  return !!readConfig().token;
}

export function getInfo() {
  const c = readConfig();
  return {
    initialized: !!c.token,
    configDir: CONFIG_DIR,
    gistId: c.gistId || null,
    username: c.username || null,
  };
}

// ─── OAuth Device Flow ───────────────────────────────

const OAUTH_CLIENT_ID = "Ov23liZwxbu3BVJrQ0qn";

export async function startDeviceFlow() {
  const res = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ client_id: OAUTH_CLIENT_ID, scope: "gist" }),
  });
  if (!res.ok) throw new Error("Failed to start device flow");
  return res.json(); // { device_code, user_code, verification_uri, expires_in, interval }
}

export async function pollDeviceFlow(deviceCode, interval = 5) {
  const deadline = Date.now() + 10 * 60 * 1000; // 10 min timeout
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval * 1000));
    const res = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: OAUTH_CLIENT_ID,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });
    const data = await res.json();
    if (data.access_token) return data.access_token;
    if (data.error === "authorization_pending") continue;
    if (data.error === "slow_down") { interval += 5; continue; }
    if (data.error === "expired_token") throw new Error("Authorization expired. Please try again.");
    if (data.error === "access_denied") throw new Error("Authorization denied.");
    throw new Error(data.error_description || data.error || "Unknown OAuth error");
  }
  throw new Error("Authorization timed out.");
}

// ─── Init: save token + validate ─────────────────────

export async function init(token) {
  const res = await fetch(`${API}/user`, {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": "clisync" },
  });
  if (!res.ok) throw new Error("Invalid token");
  const user = await res.json();
  const config = readConfig();
  config.token = token;
  config.username = user.login;
  writeConfig(config);
  return user.login;
}

// ─── Link to existing gist ───────────────────────────

export function link(gistId) {
  const config = readConfig();
  config.gistId = gistId;
  writeConfig(config);
}

// ─── GitHub API helpers ──────────────────────────────

function getToken() {
  const t = readConfig().token;
  if (!t) throw new Error("Not initialized");
  return t;
}

async function api(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${getToken()}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "clisync",
      ...options.headers,
    },
  });
  if (!res.ok) {
    if (res.status === 403 || res.status === 429) {
      const retryAfter = res.headers.get("retry-after");
      throw new Error(`GitHub API rate limited (${res.status}). ${retryAfter ? `Retry after ${retryAfter}s` : "Try again later."}`);
    }
    const body = await res.text();
    const safe = body.slice(0, 200).replace(/gho_\w+|ghp_\w+|github_pat_\w+|Bearer\s+\S+/gi, "***");
    throw new Error(`GitHub API ${res.status}: ${safe}`);
  }
  return res.json();
}

async function findGist() {
  const config = readConfig();
  if (config.gistId) {
    try {
      return await api(`/gists/${config.gistId}`);
    } catch { /* fall through to search */ }
  }
  for (let page = 1; page <= 5; page++) {
    const gists = await api(`/gists?per_page=100&page=${page}`);
    // Match both new and old gist descriptions for backward compat
    const found = gists.find((g) => g.description === GIST_DESC || g.description === OLD_GIST_DESC);
    if (found) return found;
    if (gists.length < 100) break;
  }
  return null;
}

// ─── Encryption (AES-256-GCM) ───────────────────────
// Key derived from token via scrypt — same token on another machine = same key

function deriveKey(token) {
  return scryptSync(token, "clisync-salt-v1", 32);
}

function encrypt(plaintext) {
  const key = deriveKey(getToken());
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: base64(iv + tag + ciphertext)
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

function decrypt(encoded) {
  const key = deriveKey(getToken());
  const buf = Buffer.from(encoded, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext, undefined, "utf-8") + decipher.final("utf-8");
}

// ─── Push (save to Gist) ─────────────────────────────

export async function push(filesMap) {
  const bundle = {
    version: 2,
    encrypted: true,
    updated_at: new Date().toISOString(),
    machine: `${process.platform}-${process.arch}`,
    file_count: Object.keys(filesMap).length,
    files: filesMap,
  };

  const plaintext = JSON.stringify(bundle, null, 2);
  const encrypted = encrypt(plaintext);
  const wrapper = JSON.stringify({ encrypted: true, version: 2, data: encrypted });

  const contentSize = Buffer.byteLength(wrapper, "utf-8");
  if (contentSize > MAX_GIST_SIZE) {
    throw new Error(`Bundle too large (${(contentSize / 1024 / 1024).toFixed(1)}MB). GitHub Gist limit is ~10MB.`);
  }

  const payload = {
    description: GIST_DESC,
    public: false,
    files: { "clisync.json": { content: wrapper } },
  };

  const existing = await findGist();

  let gist;
  if (existing) {
    gist = await api(`/gists/${existing.id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  } else {
    gist = await api("/gists", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  const config = readConfig();
  config.gistId = gist.id;
  writeConfig(config);

  return { gistId: gist.id, updated: !!existing };
}

// ─── Pull (load from Gist) ───────────────────────────

function validateBundle(bundle) {
  if (!bundle || typeof bundle !== "object") throw new Error("Invalid bundle format");
  if (!bundle.files || typeof bundle.files !== "object") throw new Error("Bundle has no files");

  for (const rel of Object.keys(bundle.files)) {
    const normalized = normalize(rel);
    if (normalized.startsWith("..") || isAbsolute(normalized) || rel.includes(":") || rel.includes("\0")) {
      throw new Error(`Unsafe path detected: ${rel}`);
    }
  }
  return bundle;
}

export async function pull() {
  const gist = await findGist();
  if (!gist) throw new Error("No saved config found");

  const fileName = Object.keys(gist.files).find(
    (f) => f === "clisync.json" || f === "llm-sync.json" || f === "llm-sync-data.json"
  );
  if (!fileName) throw new Error("No clisync data in gist");

  const file = gist.files[fileName];

  let raw = file.truncated ? null : file.content;
  if (!raw && file.raw_url) {
    const res = await fetch(file.raw_url, {
      headers: {
        Authorization: `Bearer ${getToken()}`,
        "User-Agent": "clisync",
      },
    });
    if (!res.ok) throw new Error("Failed to fetch gist content");
    raw = await res.text();
  }

  if (!raw) throw new Error("Gist file is empty");

  const parsed = JSON.parse(raw);

  // Handle encrypted (v2) and unencrypted (v1) bundles
  let bundle;
  if (parsed.encrypted && parsed.data) {
    const decrypted = decrypt(parsed.data);
    bundle = JSON.parse(decrypted);
  } else {
    bundle = parsed; // v1 unencrypted format
  }

  return validateBundle(bundle);
}
