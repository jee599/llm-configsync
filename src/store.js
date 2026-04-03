import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const HOME = homedir();
const CONFIG_DIR = join(HOME, ".llm-sync");
const AUTH_FILE = join(CONFIG_DIR, "auth.json");
const API = "https://api.github.com";
const GIST_DESC = "llm-sync: LLM CLI settings";

// ─── Local config ─────────────────────────────────────

function readConfig() {
  if (!existsSync(AUTH_FILE)) return {};
  try { return JSON.parse(readFileSync(AUTH_FILE, "utf-8")); }
  catch { return {}; }
}

function writeConfig(data) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(AUTH_FILE, JSON.stringify(data, null, 2));
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
  if (!res.ok) throw new Error("Invalid token — check and try again");
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
    const body = await res.text();
    throw new Error(`GitHub API ${res.status}: ${body}`);
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
  // Search by description
  const gists = await api("/gists?per_page=100");
  return gists.find((g) => g.description === GIST_DESC) || null;
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

  const payload = {
    description: GIST_DESC,
    public: false,
    files: { "llm-sync.json": { content: JSON.stringify(bundle, null, 2) } },
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

  return JSON.parse(content);
}
