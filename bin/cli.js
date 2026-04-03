#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { scan, collectFiles } from "../src/scanner.js";
import { abs, PROFILES } from "../src/profiles.js";
import * as store from "../src/store.js";
import { t, setLang, getLang } from "../src/i18n.js";

const VERSION = "0.2.1";
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("-")));
// Handle version flags before cmd parsing
if (flags.has("-v") || flags.has("--version")) {
  console.log(`lcs v${VERSION}`);
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

// ─── Secure input ────────────────────────────────────
function askSecret(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, terminal: false });
    process.stdout.write(question);

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    let input = "";
    const onData = (ch) => {
      const s = ch.toString();
      if (s === "\n" || s === "\r" || s === "\r\n") {
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        process.stdin.removeListener("data", onData);
        process.stdin.pause();
        rl.close();
        process.stdout.write("\n");
        resolve(input.trim());
      } else if (s === "\u0003") { // Ctrl+C
        process.stdout.write("\n");
        process.exit(1);
      } else if (s === "\u007f" || s === "\b") { // Backspace
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
  console.log(`
${b("lcs init")} — ${t("initTitle")}

  ${t("initHasToken")}
  ${t("initNewToken")}
  ${c("https://github.com/settings/tokens/new?scopes=gist&description=llm-sync")}
  ${d(`(${t("initHint")})`)}
`);

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
  ${d(`${t("tokenSaved")} ~/.llm-sync/auth.json`)}

  ${t("nowReady")}
    ${c("lcs save")}   ${t("saveHint")}
    ${c("lcs load")}   ${t("loadHint")}
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

  console.log(`\n${b("lcs save")}\n`);
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
    ${c("npx llm-configsync init")}   ${t("saveHint")}
    ${c("npx llm-configsync load")}   ${t("loadHint")}
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

  console.log(`\n${b("lcs load")}\n`);
  console.log(`  ${t("downloading")}\n`);

  let bundle;
  try {
    bundle = await store.pull();
  } catch (e) {
    console.log(`  ${r("✗")} ${e.message}`);
    console.log(`  ${t("loadFirst")} ${c("lcs save")} ${t("loadFirstSuffix")}\n`);
    return;
  }

  console.log(`  ${d(t("savedAt") + " " + bundle.updated_at)}`);
  console.log(`  ${d(t("savedMachine") + " " + bundle.machine)}`);
  console.log(`  ${d(t("fileCount") + "   " + bundle.file_count)}\n`);

  let applied = 0;
  let skipped = 0;
  let totalSize = 0;

  // Group files by tool for display
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

    // Skip if identical
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
  console.log(`\n${b("lcs list")}\n`);

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
  console.log(`\n${b("lcs status")}\n`);

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
  ${b("lcs")} v${VERSION} — ${t("helpDesc")}

  ${b(t("helpUsage"))}
    ${c("lcs init")}              ${t("helpInit")}
    ${c("lcs save")}              ${t("helpSave")}
    ${c("lcs load")}              ${t("helpLoad")}
    ${c("lcs list")}              ${t("helpList")}
    ${c("lcs status")}            ${t("helpStatus")}
    ${c("lcs link <gist-id>")}    ${t("helpLink")}

  ${b(t("helpOptions"))}
    ${c("lcs save --no-redact")}  ${t("helpNoRedact")}
    ${c("lcs load --force")}      ${t("helpForce")}
    ${c("--lang=en|ko")}          ${t("helpLang")}
    ${c("--en / --ko")}           ${t("helpLang")}

  ${b(t("helpTools"))}
    Claude Code, Gemini CLI, Codex, Aider, Continue, Copilot CLI
  `);
}

// ─── Helpers ─────────────────────────────────────────

function requireInit() {
  if (!store.isInitialized()) {
    console.log(`\n  ${r("✗")} ${t("requireInit")} ${c("lcs init")} ${t("requireInitSuffix")}\n`);
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
    .map(([cat, n]) => `${t(CAT_KEYS[cat] || "catEtc")} ${n}`)
    .join(" | ");
}

function getCatForRel(rel) {
  for (const p of PROFILES) {
    for (const pp of p.paths) {
      if (rel === pp.rel || (pp.dir && rel.startsWith(pp.rel))) {
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
    .map(([cat, n]) => `${t(CAT_KEYS[cat] || "catEtc")} ${n}`)
    .join(" | ");
}

// ─── Main ─────────────────────────────────────────────
switch (cmd) {
  case "init":    await cmdInit(); break;
  case "save":    await cmdSave(); break;
  case "load":    await cmdLoad(); break;
  case "list":    cmdList(); break;
  case "status":  cmdStatus(); break;
  case "link":    cmdLink(); break;
  case "version": console.log(`lcs v${VERSION}`); break;
  case undefined: showHelp(); break;
  default:
    console.log(`\n  ${r("✗")} ${t("unknownCmd")} ${cmd}`);
    showHelp();
    break;
}
