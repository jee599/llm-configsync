import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from "node:fs";
import { join, normalize, isAbsolute } from "node:path";
import { homedir, platform } from "node:os";

const HOME = homedir();
const IS_WIN = platform() === "win32";
const CONFIG_DIR = join(HOME, ".llm-sync");
const AUTH_FILE = join(CONFIG_DIR, "auth.json");
const API = "https://api.github.com";
const GIST_DESC = "llm-sync: LLM CLI settings";
const MAX_GIST_SIZE = 9 * 1024 * 1024; // 9 MB safety margin (GitHub limit ~10 MB)

// ─── Local config ─────────────────────────────────────

function readConfig() {
  if (!existsSync(AUTH_FILE)) return {};
  try { return JSON.parse(readFileSync(AUTH_FILE, "utf-8")); }
  catch { return {}; }
}

function writeConfig(data) {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(AUTH_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
  // On non-Windows, also enforce permissions explicitly
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

// ─── Init: validate + save token ──────────────────────

export async function init(token) {
  const res = await fetch(`${API}/user`, {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": "llm-sync" },
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
      "User-Agent": "llm-sync",
      ...options.headers,
    },
  });
  if (!res.ok) {
    if (res.status === 403 || res.status === 429) {
      const retryAfter = res.headers.get("retry-after");
      throw new Error(`GitHub API rate limited (${res.status}). ${retryAfter ? `Retry after ${retryAfter}s` : "Try again later."}`);
    }
    // Sanitize error: don't leak token or full response
    const body = await res.text();
    const safe = body.slice(0, 200).replace(/gho_\w+|ghp_\w+|github_pat_\w+|Bearer\s+\S+/gi, "***");
    throw new Error(`GitHub API ${res.status}: ${safe}`);
  }
  return res.json();
}

async function findGist() {
  const config = readConfig();
  // If we have a saved gist ID, use it directly
  if (config.gistId) {
    try {
      return await api(`/gists/${config.gistId}`);
    } catch { /* fall through to search */ }
  }
  // Search with pagination (up to 5 pages = 500 gists)
  for (let page = 1; page <= 5; page++) {
    const gists = await api(`/gists?per_page=100&page=${page}`);
    const found = gists.find((g) => g.description === GIST_DESC);
    if (found) return found;
    if (gists.length < 100) break; // no more pages
  }
  return null;
}

// ─── Push (save to Gist) ─────────────────────────────

export async function push(filesMap) {
  const bundle = {
    version: 1,
    updated_at: new Date().toISOString(),
    machine: `${process.platform}-${process.arch}`,
    file_count: Object.keys(filesMap).length,
    files: filesMap,
  };

  const content = JSON.stringify(bundle, null, 2);
  const contentSize = Buffer.byteLength(content, "utf-8");
  if (contentSize > MAX_GIST_SIZE) {
    throw new Error(`Bundle too large (${(contentSize / 1024 / 1024).toFixed(1)}MB). GitHub Gist limit is ~10MB.`);
  }

  const payload = {
    description: GIST_DESC,
    public: false,
    files: { "llm-sync.json": { content } },
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

  // Save gist ID locally
  const config = readConfig();
  config.gistId = gist.id;
  writeConfig(config);

  return { gistId: gist.id, updated: !!existing };
}

// ─── Pull (load from Gist) ───────────────────────────

function validateBundle(bundle) {
  if (!bundle || typeof bundle !== "object") throw new Error("Invalid bundle format");
  if (!bundle.files || typeof bundle.files !== "object") throw new Error("Bundle has no files");

  // Path traversal check
  for (const rel of Object.keys(bundle.files)) {
    const normalized = normalize(rel);
    if (normalized.startsWith("..") || isAbsolute(normalized)) {
      throw new Error(`Unsafe path detected: ${rel}`);
    }
  }
  return bundle;
}

export async function pull() {
  const gist = await findGist();
  if (!gist) throw new Error("No saved config found");

  // Find our file (handle possible filename variations)
  const fileName = Object.keys(gist.files).find(
    (f) => f === "llm-sync.json" || f === "llm-sync-data.json"
  );
  if (!fileName) throw new Error("No llm-sync data in gist");

  const file = gist.files[fileName];

  // If content is truncated, fetch from raw_url
  let content = file.content;
  if (!content && file.raw_url) {
    const res = await fetch(file.raw_url, {
      headers: {
        Authorization: `Bearer ${getToken()}`,
        "User-Agent": "llm-sync",
      },
    });
    if (!res.ok) throw new Error("Failed to fetch gist content");
    content = await res.text();
  }

  if (!content) throw new Error("Gist file is empty");

  return validateBundle(JSON.parse(content));
}
