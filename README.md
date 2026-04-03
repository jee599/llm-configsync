<p align="center">
  <strong>llm-configsync</strong>
</p>

<p align="center">
  <strong>Sync all your LLM CLI settings across machines. 6 tools, 1 command.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/llm-configsync"><img src="https://img.shields.io/npm/v/llm-configsync?style=flat-square" alt="npm" /></a>
  <a href="https://github.com/jee599/llm-configsync/blob/main/LICENSE"><img src="https://img.shields.io/github/license/jee599/llm-configsync?style=flat-square" alt="License" /></a>
  <img src="https://img.shields.io/badge/dependencies-0-brightgreen?style=flat-square" alt="Zero Dependencies" />
</p>

---

New machine. Claude Code, Gemini CLI, Codex all installed — but none of your settings, MCP servers, hooks, or slash commands carried over. You're setting everything up from scratch. Again.

**llm-configsync** backs up all your LLM CLI configs to a private GitHub Gist and restores them anywhere in one command.

```
Machine A                     GitHub Gist              Machine B
                               (private)
~/.claude/*  ─┐                                   ┌─> ~/.claude/*
~/.gemini/*  ─┼── lcs save ──>  JSON bundle ──> lcs load ──┼─> ~/.gemini/*
~/.codex/*   ─┘                                   └─> ~/.codex/*
```

## Install

```bash
npm install -g llm-configsync
```

## Quick Start

```bash
# Machine A — save your settings
lcs init     # paste GitHub token (gist scope only)
lcs save     # done

# Machine B — restore everything
lcs init     # same token
lcs load     # done — all configs restored
```

```
lcs save

  ✓ Claude Code — 5 files, 8.2KB
    .claude/settings.json (1.5KB)
    .claude/CLAUDE.md (3.1KB)
    .claude/hooks/contextzip-rewrite.sh (1.5KB)
    .claude/skills/github-readme/SKILL.md (1.8KB)
    .claude/plugins/installed_plugins.json (348B)
  ✓ Gemini CLI — 2 files, 348B
    .gemini/settings.json (82B)
    .gemini/projects.json (266B)
  ✓ OpenAI Codex — 2 files, 1.8KB
    .codex/config.toml (612B)
    .codex/rules/default.rules (1.2KB)

  Total: 9 files, 10.4KB
  Settings 4 | MCP 0 | Hooks 1 | Skills 1 | Instructions 3
```

## What Gets Synced

| Tool | Files synced |
|:---|:---|
| **Claude Code** | `settings.json`, `keybindings.json`, `CLAUDE.md`, `hooks/`, `skills/`, `plugins/installed_plugins.json`, `plugins/known_marketplaces.json`, `plugins/blocklist.json`, `teams/` |
| **Gemini CLI** | `settings.json`, `projects.json`, `antigravity/mcp_config.json` |
| **OpenAI Codex** | `config.toml`, `instructions.md`, `rules/` |
| **Aider** | `.aider.conf.yml`, `.aider.model.settings.yml`, `.aider.models.json` |
| **Continue** | `.continue/.continuerc.json`, `.continue/config.yaml`, `.continue/config.ts`, `.continue/.continueignore` |
| **Copilot CLI** | `.config/github-copilot/settings.json` |

## Commands

| Command | What it does |
|:---|:---|
| `lcs init` | Set up GitHub token (once per machine) |
| `lcs save` | Upload configs to private Gist |
| `lcs load` | Download and restore configs |
| `lcs list` | Show detected local configs |
| `lcs status` | Show sync status |
| `lcs link <gist-id>` | Link to existing Gist |
| `lcs save --no-redact` | Upload without redacting API keys |
| `lcs load --force` | Overwrite without backups |
| `lcs --version` | Show version |
| `--lang=en` / `--ko` | Change language (auto-detected) |

## Safety

- **17 API key patterns auto-redacted** — OpenAI, Anthropic, Google, AWS, GitHub, GitLab, HuggingFace, Slack, Replicate, Vercel, Supabase, and generic key-value patterns
- **Sensitive files auto-skipped** — `auth.json`, `credentials.json`, `.env`, `.pem`, `.key` files are never uploaded
- **Private Gist** — only you can see it
- **Backups** — existing files saved as `.bak` before overwriting
- **File size limit** — files over 1MB are skipped; binary files auto-detected and excluded
- **Path traversal protection** — validates all paths on restore
- **Token security** — hidden input on entry, file permissions set to owner-only (0600)
- **Cross-platform** — works on macOS, Linux, and Windows with consistent path handling
- **Zero dependencies** — Node.js 18+ built-in modules only

## Language

Auto-detects system locale (English/Korean). Override with `--lang=en` or `--ko`.

## How It Works

```
lcs save:
  ~/.claude/* ──> scan ──> skip sensitive ──> redact secrets ──> JSON bundle ──> Gist API
                                                                                     |
lcs load:                                                                            |
  Gist API ──> download ──> validate paths ──> backup existing ──> write files ──────┘
```

No server, no database, no account to create. Just your GitHub token and a private Gist.

## Adding a New Tool

Edit `src/profiles.js`:

```js
{
  name: "My Tool",
  id: "my-tool",
  paths: [
    { rel: ".my-tool/config.json", desc: "Config", cat: "settings" },
    { rel: ".my-tool/plugins/", desc: "Plugins", dir: true, cat: "skills" },
  ],
}
```

> [!TIP]
> PRs welcome for new LLM CLI tools. Just add the config paths.

## License

MIT

---

<p align="center">
  <sub>Built by <a href="https://github.com/jee599">jee599</a></sub>
</p>
