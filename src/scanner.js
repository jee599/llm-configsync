import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PROFILES, abs } from "./profiles.js";

const SECRET_PATTERNS = [
  /sk-[a-zA-Z0-9_-]{20,}/g,
  /sk-ant-[a-zA-Z0-9_-]{20,}/g,
  /AIza[a-zA-Z0-9_-]{30,}/g,
  /ghp_[a-zA-Z0-9]{36}/g,
  /gho_[a-zA-Z0-9]{36}/g,
  /xoxb-[a-zA-Z0-9-]+/g,
  /xoxp-[a-zA-Z0-9-]+/g,
];

function redact(content) {
  let result = content;
  for (const p of SECRET_PATTERNS) {
    result = result.replace(p, "__REDACTED__");
  }
  return result;
}

const SKIP_PATTERNS = [/\.bak$/, /\.tmp$/, /\.log$/, /\.sqlite/, /\.pb$/];

function shouldSkip(name) {
  return SKIP_PATTERNS.some((p) => p.test(name));
}

function readDir(dirPath, baseRel, cat) {
  const out = [];
  if (!existsSync(dirPath)) return out;
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    if (shouldSkip(entry.name)) continue;
    const full = join(dirPath, entry.name);
    const rel = join(baseRel, entry.name);
    if (entry.isDirectory()) {
      out.push(...readDir(full, rel, cat));
    } else {
      try {
        out.push({ rel, absPath: full, content: readFileSync(full, "utf-8"), cat });
      } catch { /* skip binary */ }
    }
  }
  return out;
}

// Returns [{ profile, files: [{ rel, absPath, content, cat }] }]
// Only profiles that have at least one file found
export function scan() {
  const results = [];
  for (const profile of PROFILES) {
    const files = [];
    for (const p of profile.paths) {
      const absPath = abs(p.rel);
      if (!existsSync(absPath)) continue;
      if (p.dir) {
        files.push(...readDir(absPath, p.rel, p.cat || "etc"));
      } else {
        try {
          files.push({ rel: p.rel, absPath, content: readFileSync(absPath, "utf-8"), cat: p.cat || "etc" });
        } catch { /* skip */ }
      }
    }
    if (files.length > 0) {
      results.push({ profile, files });
    }
  }
  return results;
}

// Collect files into { rel: content } map for upload
export function collectFiles(scanResults, { skipRedact = false } = {}) {
  const map = {};
  for (const { files } of scanResults) {
    for (const f of files) {
      map[f.rel] = skipRedact ? f.content : redact(f.content);
    }
  }
  return map;
}
