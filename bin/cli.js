#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { scan, collectFiles } from "../src/scanner.js";
import { abs, PROFILES } from "../src/profiles.js";
import * as store from "../src/store.js";

const VERSION = "0.1.8";
const cmd = process.argv[2];
const flags = new Set(process.argv.slice(3).filter((a) => a.startsWith("-")));

// ─── Colors ───────────────────────────────────────────
const g = (s) => `\x1b[32m${s}\x1b[0m`;
const r = (s) => `\x1b[31m${s}\x1b[0m`;
const y = (s) => `\x1b[33m${s}\x1b[0m`;
const c = (s) => `\x1b[36m${s}\x1b[0m`;
const d = (s) => `\x1b[2m${s}\x1b[0m`;
const b = (s) => `\x1b[1m${s}\x1b[0m`;

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(question, (a) => { rl.close(); res(a.trim()); }));
}

// ─── init ─────────────────────────────────────────────
async function cmdInit() {
  console.log(`
${b("lcs init")} — 이 컴퓨터에 GitHub 토큰 등록

  이미 토큰이 있으면 바로 붙여넣기 하세요.
  처음이면 아래 링크에서 토큰을 만들 수 있습니다:
  ${c("https://github.com/settings/tokens/new?scopes=gist&description=llm-sync")}
  ${d("(gist 권한만 체크 → Generate token → 복사)")}
`);

  const token = await ask("  GitHub token: ");

  if (!token) {
    console.log(`\n  ${r("✗")} 토큰이 입력되지 않았습니다.\n`);
    process.exit(1);
  }

  try {
    console.log(`\n  토큰 확인 중...`);
    const username = await store.init(token);
    console.log(`
  ${g("✓")} 인증 완료! (${b(username)})
  ${d("토큰 저장됨: ~/.llm-sync/auth.json")}

  이제 사용할 수 있습니다:
    ${c("lcs save")}   ← 현재 설정 저장
    ${c("lcs load")}   ← 다른 컴퓨터에서 불러오기
`);
  } catch (e) {
    console.log(`\n  ${r("✗")} 토큰 인증 실패: ${e.message}`);
    console.log(`  토큰을 다시 확인해 주세요.\n`);
    process.exit(1);
  }
}

// ─── save ─────────────────────────────────────────────
async function cmdSave() {
  requireInit();
  const skipRedact = flags.has("--no-redact");

  console.log(`\n${b("lcs save")}\n`);
  console.log("  설정 파일 탐색 중...\n");

  const results = scan();

  if (results.length === 0) {
    console.log("  검색된 LLM CLI 설정이 없습니다.\n");
    console.log("  지원 도구:");
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
    console.log(`  ${g("✓")} ${profile.name} — ${files.length}개 파일, ${fmtBytes(toolSize)}`);
    for (const f of files) {
      const size = Buffer.byteLength(f.content, "utf-8");
      console.log(`    ${f.rel} ${d("(" + fmtBytes(size) + ")")}`);
    }
    total += files.length;
  }
  console.log(`\n  ${b("합계:")} ${total}개 파일, ${fmtBytes(totalSize)}`);
  console.log(`  ${catSummary(results)}`);

  const filesMap = collectFiles(results, { skipRedact });

  if (skipRedact) {
    console.log(`\n  ${y("⚠")} API 키 등 민감 정보가 포함된 채로 업로드됩니다.`);
  }

  console.log("\n  Gist에 업로드 중...");

  try {
    const { gistId, updated } = await store.push(filesMap);
    console.log(`
  ${g("✓")} ${updated ? "업데이트" : "생성"} 완료! (${total}개 파일)
  ${d("https://gist.github.com/" + gistId)}

  ${d("다른 컴퓨터에서:")}
    ${c("npx lcs init")}   ← 같은 토큰 입력
    ${c("npx lcs load")}   ← 설정 불러오기
`);
  } catch (e) {
    console.log(`\n  ${r("✗")} 업로드 실패: ${e.message}\n`);
    process.exit(1);
  }
}

// ─── load ─────────────────────────────────────────────
async function cmdLoad() {
  requireInit();
  const force = flags.has("--force");

  console.log(`\n${b("lcs load")}\n`);
  console.log("  Gist에서 다운로드 중...\n");

  let bundle;
  try {
    bundle = await store.pull();
  } catch (e) {
    console.log(`  ${r("✗")} ${e.message}`);
    console.log(`  먼저 다른 컴퓨터에서 ${c("lcs save")}를 실행하세요.\n`);
    return;
  }

  console.log(`  ${d("저장 시점: " + bundle.updated_at)}`);
  console.log(`  ${d("저장 머신: " + bundle.machine)}`);
  console.log(`  ${d("파일 수:   " + bundle.file_count + "개")}\n`);

  let applied = 0;
  let skipped = 0;
  let totalSize = 0;

  // Group files by tool for display
  const toolMap = {};
  for (const p of PROFILES) {
    for (const pp of p.paths) {
      toolMap[pp.rel] = p.name;
      // For dir entries, match prefix
      if (pp.dir) {
        for (const rel of Object.keys(bundle.files)) {
          if (rel.startsWith(pp.rel.replace(/\/$/, ""))) toolMap[rel] = p.name;
        }
      }
    }
  }

  let currentTool = "";

  for (const [rel, content] of Object.entries(bundle.files)) {
    const tool = toolMap[rel] || "기타";
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
        console.log(`    ${d("= " + rel)} ${d("(" + fmtBytes(size) + ", 동일)")}`);
        skipped++;
        continue;
      }
      // Backup before overwrite
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
  console.log(`  ${b("합계:")} ${applied + skipped}개 파일, ${fmtBytes(totalSize)}`);
  console.log(`  ${catSummaryFromMap(bundle.files)}`);
  if (applied > 0) {
    console.log(`  ${g("✓")} ${applied}개 파일 복원 완료`);
  }
  if (skipped > 0) {
    console.log(`  ${d(skipped + "개 파일은 이미 동일")}`);
  }
  if (!force && applied > 0) {
    console.log(`  ${d("기존 파일은 .bak으로 백업됨")}`);
  }
  console.log();
}

// ─── list ─────────────────────────────────────────────
function cmdList() {
  console.log(`\n${b("lcs list")}\n`);

  const results = scan();
  if (results.length === 0) {
    console.log("  이 컴퓨터에서 검색된 LLM CLI 설정이 없습니다.\n");
    return;
  }

  for (const { profile, files } of results) {
    console.log(`  ${b(profile.name)}`);
    for (const f of files) {
      const size = fs.statSync(f.absPath).size;
      const kb = size < 1024 ? `${size}B` : `${(size / 1024).toFixed(1)}KB`;
      console.log(`    ${f.rel} ${d("(" + kb + ")")}`);
    }
    console.log();
  }
}

// ─── status ──────────────────────────────────────────
function cmdStatus() {
  console.log(`\n${b("lcs status")}\n`);

  const info = store.getInfo();
  console.log(`  초기화:  ${info.initialized ? g("✓") : r("✗")}`);
  if (info.username) console.log(`  계정:    ${info.username}`);
  if (info.gistId) console.log(`  Gist:    ${d("https://gist.github.com/" + info.gistId)}`);

  const results = scan();
  const total = results.reduce((s, r) => s + r.files.length, 0);
  console.log(`  로컬:    ${total}개 파일 (${results.length}개 도구)\n`);
}

// ─── help ─────────────────────────────────────────────
function showHelp() {
  console.log(`
  ${b("lcs")} v${VERSION} — LLM CLI 설정 동기화

  ${b("사용법:")}
    ${c("lcs init")}              GitHub 토큰 설정 (최초 1회)
    ${c("lcs save")}              현재 설정 → Gist에 저장
    ${c("lcs load")}              Gist에서 → 현재 컴퓨터에 복원
    ${c("lcs list")}              로컬에 있는 설정 파일 목록
    ${c("lcs status")}            동기화 상태 확인

  ${b("옵션:")}
    ${c("lcs save --no-redact")}  API 키 마스킹 없이 저장
    ${c("lcs load --force")}      백업 없이 덮어쓰기

  ${b("지원 도구:")}
    Claude Code, Gemini CLI, Codex, Aider, Continue, Copilot CLI
  `);
}

// ─── Helpers ─────────────────────────────────────────

function requireInit() {
  if (!store.isInitialized()) {
    console.log(`\n  ${r("✗")} 먼저 ${c("lcs init")}을 실행하세요.\n`);
    process.exit(1);
  }
}

function fmtBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

const CAT_LABELS = {
  settings: "세팅",
  mcp: "MCP 서버",
  hooks: "훅",
  skills: "스킬",
  instructions: "인스트럭션",
  etc: "기타",
};

// Count categories from scan results
function catSummary(scanResults) {
  const counts = {};
  for (const { files } of scanResults) {
    for (const f of files) {
      const cat = f.cat || "etc";
      counts[cat] = (counts[cat] || 0) + 1;
    }
  }
  return Object.entries(counts)
    .map(([cat, n]) => `${CAT_LABELS[cat] || cat} ${n}개`)
    .join(" | ");
}

// Get category for a rel path by matching against profiles
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

// Count categories from a files map (for load)
function catSummaryFromMap(filesMap) {
  const counts = {};
  for (const rel of Object.keys(filesMap)) {
    const cat = getCatForRel(rel);
    counts[cat] = (counts[cat] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([cat, n]) => `${CAT_LABELS[cat] || cat} ${n}개`)
    .join(" | ");
}

// ─── Main ─────────────────────────────────────────────
switch (cmd) {
  case "init":    await cmdInit(); break;
  case "save":    await cmdSave(); break;
  case "load":    await cmdLoad(); break;
  case "list":    cmdList(); break;
  case "status":  cmdStatus(); break;
  case "-v": case "--version": console.log(`llm-sync v${VERSION}`); break;
  default:        showHelp(); break;
}
