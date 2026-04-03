#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { scan, collectFiles } from "../src/scanner.js";
import { abs, PROFILES } from "../src/profiles.js";
import * as store from "../src/store.js";
import { t, setLang } from "../src/i18n.js";

const VERSION = "0.5.2";
const CMD = "clisync";
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("-")));

// Handle version flags before cmd parsing
if (flags.has("-v") || flags.has("--version")) {
  console.log(`${CMD} v${VERSION}`);
  process.exit(0);
}
const cmd = args.find((a) => !a.startsWith("-"));

// Parse --lang flag
const langFlag = args.find((a) => a.startsWith("--lang="));
if (langFlag) setLang(langFlag.split("=")[1]);
else if (flags.has("--en")) setLang("en");
else if (flags.has("--ko")) setLang("ko");

// ─── Colors ───────────────────────────────────────────
const useColor = process.stdout.isTTY === true;
const wrap = (code) => useColor ? (s) => `\x1b[${code}m${s}\x1b[0m` : (s) => s;
const g = wrap("32");
const r = wrap("31");
const y = wrap("33");
const c = wrap("36");
const d = wrap("2");
const b = wrap("1");

// ─── Input helpers ───────────────────────────────────
function askSecret(question) {
  return new Promise((resolve, reject) => {
    process.stdout.write(question);

    // Piped input: read line normally
    if (!process.stdin.isTTY) {
      const rl = readline.createInterface({ input: process.stdin, terminal: false });
      rl.once("line", (line) => { rl.close(); resolve(line.trim()); });
      rl.once("close", () => resolve(""));
      return;
    }

    // TTY: raw mode, no echo
    process.stdin.setRawMode(true);
    process.stdin.resume();
    let input = "";
    const onData = (ch) => {
      const s = ch.toString();
      if (s === "\n" || s === "\r" || s === "\r\n") {
        process.stdin.setRawMode(false);
        process.stdin.removeListener("data", onData);
        process.stdin.pause();
        process.stdout.write("\n");
        resolve(input.trim());
      } else if (s === "\u0003") {
        process.stdout.write("\n");
        process.exit(1);
      } else if (s === "\u007f" || s === "\b") {
        input = input.slice(0, -1);
      } else {
        input += s;
      }
    };
    process.stdin.on("data", onData);
  });
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(question, (a) => { rl.close(); res(a.trim()); }));
}

// ─── init ─────────────────────────────────────────────
async function cmdInit() {
  // --token flag: manual token entry
  if (flags.has("--token")) {
    return cmdInitToken();
  }

  // Default: OAuth Device Flow
  console.log(`\n${b(`${CMD} init`)} — ${t("initTitle")}\n`);

  let flow;
  try {
    flow = await store.startDeviceFlow();
  } catch (e) {
    console.log(`  ${y("⚠")} OAuth unavailable, falling back to token.\n`);
    return cmdInitToken();
  }

  console.log(`  ${t("initOauth")}`);
  console.log(`  ${c(flow.verification_uri)}\n`);
  console.log(`  ${t("initCode")} ${b(flow.user_code)}\n`);

  // Try to open browser automatically
  try {
    const open = process.platform === "win32" ? "start" : process.platform === "darwin" ? "open" : "xdg-open";
    const { exec } = await import("node:child_process");
    exec(`${open} ${flow.verification_uri}`);
  } catch { /* manual open is fine */ }

  console.log(`  ${d(t("initWaiting"))}`);

  try {
    const token = await store.pollDeviceFlow(flow.device_code, flow.interval || 5);
    const username = await store.init(token);
    console.log(`
  ${g("✓")} ${t("tokenOk")} (${b(username)})

  ${t("nowReady")}
    ${c(`${CMD} save`)}   ${t("saveHint")}
    ${c(`${CMD} load`)}   ${t("loadHint")}
`);
  } catch (e) {
    console.log(`\n  ${r("✗")} ${t("tokenFail")} ${e.message}`);
    console.log(`  ${t("tokenRetry")}\n`);
    process.exit(1);
  }
}

async function cmdInitToken() {
  console.log(`\n${b(`${CMD} init --token`)} — ${t("initTitle")}\n`);
  console.log(`  ${c("https://github.com/settings/tokens/new?scopes=gist&description=clisync")}\n`);

  const token = await askSecret(t("tokenPrompt"));

  if (!token) {
    console.log(`\n  ${r("✗")} ${t("tokenEmpty")}\n`);
    process.exit(1);
  }

  try {
    console.log(`\n  ${t("tokenChecking")}`);
    const username = await store.init(token);
    console.log(`
  ${g("✓")} ${t("tokenOk")} (${b(username)})
  ${d(`${t("tokenSaved")} ~/.clisync/auth.json`)}

  ${t("nowReady")}
    ${c(`${CMD} save`)}   ${t("saveHint")}
    ${c(`${CMD} load`)}   ${t("loadHint")}
`);
  } catch (e) {
    console.log(`\n  ${r("✗")} ${t("tokenFail")} ${e.message}`);
    console.log(`  ${t("tokenRetry")}\n`);
    process.exit(1);
  }
}

// ─── save ─────────────────────────────────────────────
async function cmdSave() {
  requireInit();
  const skipRedact = flags.has("--no-redact");

  console.log(`\n${b(`${CMD} save`)}\n`);
  console.log(`  ${t("scanning")}\n`);

  const results = scan();

  if (results.length === 0) {
    console.log(`  ${t("noConfigs")}\n`);
    console.log(`  ${t("supported")}`);
    for (const p of PROFILES) console.log(`    - ${p.name}`);
    console.log();
    return;
  }

  let total = 0;
  let totalSize = 0;
  for (const { profile, files } of results) {
    let toolSize = 0;
    for (const f of files) toolSize += Buffer.byteLength(f.content, "utf-8");
    totalSize += toolSize;
    console.log(`  ${g("✓")} ${profile.name} — ${files.length} ${t("files")}, ${fmtBytes(toolSize)}`);
    for (const f of files) {
      const size = Buffer.byteLength(f.content, "utf-8");
      console.log(`    ${f.rel} ${d("(" + fmtBytes(size) + ")")}`);
    }
    total += files.length;
  }
  console.log(`\n  ${b(t("total"))} ${total} ${t("files")}, ${fmtBytes(totalSize)}`);
  console.log(`  ${catSummary(results)}`);

  const filesMap = collectFiles(results, { skipRedact });

  if (skipRedact) {
    console.log(`\n  ${y("⚠")} ${t("noRedactWarn")}`);
  }

  console.log(`\n  ${t("uploading")}`);

  try {
    const { gistId, updated } = await store.push(filesMap);
    console.log(`
  ${g("✓")} ${updated ? t("updated") : t("created")} ${t("done")} (${total} ${t("files")})
  ${d("https://gist.github.com/" + gistId)}

  ${d(t("fromOther"))}
    ${c(`npx clisync init`)}   ${t("saveHint")}
    ${c(`npx clisync load`)}   ${t("loadHint")}
`);
  } catch (e) {
    console.log(`\n  ${r("✗")} ${t("uploadFail")} ${e.message}\n`);
    process.exit(1);
  }
}

// ─── load ─────────────────────────────────────────────
async function cmdLoad() {
  requireInit();
  const force = flags.has("--force");

  console.log(`\n${b(`${CMD} load`)}\n`);
  console.log(`  ${t("downloading")}\n`);

  let bundle;
  try {
    bundle = await store.pull();
  } catch (e) {
    console.log(`  ${r("✗")} ${e.message}`);
    if (e.message.includes("rate limited") || e.message.includes("GitHub API")) {
      console.log(`  ${t("loadNetworkError")}\n`);
    } else {
      console.log(`  ${t("loadFirst", { cmd: c(`${CMD} save`) })}\n`);
    }
    return;
  }

  console.log(`  ${d(t("savedAt") + " " + bundle.updated_at)}`);
  console.log(`  ${d(t("savedMachine") + " " + bundle.machine)}`);
  console.log(`  ${d(t("fileCount") + "   " + bundle.file_count)}\n`);

  // Confirmation prompt (skip with --force)
  if (!force) {
    const answer = await ask(`  ${t("confirmLoad")}`);
    if (answer.toLowerCase() !== "y") {
      console.log();
      return;
    }
    console.log();
  }

  let applied = 0;
  let skipped = 0;
  let totalSize = 0;

  const toolMap = {};
  for (const p of PROFILES) {
    for (const pp of p.paths) {
      toolMap[pp.rel] = p.name;
      if (pp.dir) {
        for (const rel of Object.keys(bundle.files)) {
          if (rel === pp.rel || rel.startsWith(pp.rel + "/")) toolMap[rel] = p.name;
        }
      }
    }
  }

  let currentTool = "";

  for (const [rel, content] of Object.entries(bundle.files)) {
    const tool = toolMap[rel] || t("other");
    if (tool !== currentTool) {
      currentTool = tool;
      console.log(`  ${b(tool)}`);
    }

    const size = Buffer.byteLength(content, "utf-8");
    totalSize += size;
    const target = abs(rel);
    const dir = path.dirname(target);

    if (fs.existsSync(target)) {
      const existing = fs.readFileSync(target, "utf-8");
      if (existing === content) {
        console.log(`    ${d("= " + rel)} ${d("(" + fmtBytes(size) + ", " + t("identical") + ")")}`);
        skipped++;
        continue;
      }
      if (!force) {
        fs.copyFileSync(target, target + ".bak");
      }
    }

    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(target, content, "utf-8");
    console.log(`    ${g("✓")} ${rel} ${d("(" + fmtBytes(size) + ")")}`);
    applied++;
  }

  console.log();
  console.log(`  ${b(t("total"))} ${applied + skipped} ${t("files")}, ${fmtBytes(totalSize)}`);
  console.log(`  ${catSummaryFromMap(bundle.files)}`);
  if (applied > 0) {
    console.log(`  ${g("✓")} ${applied} ${t("restored")}`);
  }
  if (skipped > 0) {
    console.log(`  ${d(skipped + " " + t("alreadySame"))}`);
  }
  if (!force && applied > 0) {
    console.log(`  ${d(t("backedUp"))}`);
  }
  console.log();
}

// ─── list ─────────────────────────────────────────────
function cmdList() {
  console.log(`\n${b(`${CMD} list`)}\n`);

  const results = scan();
  if (results.length === 0) {
    console.log(`  ${t("noLocal")}\n`);
    return;
  }

  for (const { profile, files } of results) {
    console.log(`  ${b(profile.name)}`);
    for (const f of files) {
      const size = fs.statSync(f.absPath).size;
      console.log(`    ${f.rel} ${d("(" + fmtBytes(size) + ")")}`);
    }
    console.log();
  }
}

// ─── status ──────────────────────────────────────────
function cmdStatus() {
  console.log(`\n${b(`${CMD} status`)}\n`);

  const info = store.getInfo();
  console.log(`  ${t("initialized")}  ${info.initialized ? g("✓") : r("✗")}`);
  if (info.username) console.log(`  ${t("account")}    ${info.username}`);
  if (info.gistId) console.log(`  Gist:      ${d("https://gist.github.com/" + info.gistId)}`);

  const results = scan();
  const total = results.reduce((s, r) => s + r.files.length, 0);
  console.log(`  ${t("local")}    ${total} ${t("files")} (${results.length} ${t("tools")})\n`);
}

// ─── link ────────────────────────────────────────────
function cmdLink() {
  const gistId = args.find((a) => !a.startsWith("-") && a !== "link");
  if (!gistId) {
    console.log(`\n  ${t("linkUsage")}\n`);
    return;
  }
  requireInit();
  store.link(gistId);
  console.log(`\n  ${g("✓")} ${t("linkDone")} (${d(gistId)})\n`);
}

// ─── help ─────────────────────────────────────────────
function showHelp() {
  console.log(`
  ${b(CMD)} v${VERSION} — ${t("helpDesc")}

  ${b(t("helpUsage"))}
    ${c(`${CMD} init`)}              ${t("helpInit")} (OAuth)
    ${c(`${CMD} init --token`)}      ${t("helpInit")} (PAT)
    ${c(`${CMD} save`)}              ${t("helpSave")}
    ${c(`${CMD} load`)}              ${t("helpLoad")}
    ${c(`${CMD} list`)}              ${t("helpList")}
    ${c(`${CMD} status`)}            ${t("helpStatus")}
    ${c(`${CMD} link <gist-id>`)}    ${t("helpLink")}

  ${b(t("helpOptions"))}
    ${c(`${CMD} save --no-redact`)}  ${t("helpNoRedact")}
    ${c(`${CMD} load --force`)}      ${t("helpForce")}
    ${c("--lang=en|ko")}              ${t("helpLang")}
    ${c("--en / --ko")}               ${t("helpLang")}

  ${b(t("helpTools"))}
    Claude Code, Gemini CLI, Codex, Aider, Continue, Copilot CLI
  `);
}

// ─── Helpers ─────────────────────────────────────────

function requireInit() {
  if (!store.isInitialized()) {
    console.log(`\n  ${r("✗")} ${t("requireInit", { cmd: c(`${CMD} init`) })}\n`);
    process.exit(1);
  }
}

function fmtBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

const CAT_KEYS = {
  settings: "catSettings",
  mcp: "catMcp",
  hooks: "catHooks",
  skills: "catSkills",
  instructions: "catInstructions",
  etc: "catEtc",
};

function catSummary(scanResults) {
  const counts = {};
  for (const { files } of scanResults) {
    for (const f of files) {
      const cat = f.cat || "etc";
      counts[cat] = (counts[cat] || 0) + 1;
    }
  }
  return Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([cat, n]) => `${t(CAT_KEYS[cat] || "catEtc")} ${n}`)
    .join(" | ");
}

function getCatForRel(rel) {
  for (const p of PROFILES) {
    for (const pp of p.paths) {
      if (rel === pp.rel || (pp.dir && rel.startsWith(pp.rel + "/"))) {
        return pp.cat || "etc";
      }
    }
  }
  return "etc";
}

function catSummaryFromMap(filesMap) {
  const counts = {};
  for (const rel of Object.keys(filesMap)) {
    const cat = getCatForRel(rel);
    counts[cat] = (counts[cat] || 0) + 1;
  }
  return Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([cat, n]) => `${t(CAT_KEYS[cat] || "catEtc")} ${n}`)
    .join(" | ");
}

// ─── Main ─────────────────────────────────────────────
try {
  switch (cmd) {
    case "init":    await cmdInit(); break;
    case "save":    await cmdSave(); break;
    case "load":    await cmdLoad(); break;
    case "list":    cmdList(); break;
    case "status":  cmdStatus(); break;
    case "link":    cmdLink(); break;
    case "version": console.log(`${CMD} v${VERSION}`); break;
    case undefined: showHelp(); break;
    default:
      console.log(`\n  ${r("✗")} ${t("unknownCmd")} ${cmd}`);
      showHelp();
      break;
  }
} catch (e) {
  console.error(`\n  ${r("✗")} ${e.message}\n`);
  process.exit(1);
}
