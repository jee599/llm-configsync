<p align="center">
  <strong>clisync</strong>
</p>

<p align="center">
  Sync Claude Code, Gemini CLI, Codex, Aider settings across machines.<br>
  <strong>6 tools. 1 command. 10 seconds.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/clisync"><img src="https://img.shields.io/npm/v/clisync?style=flat-square" alt="npm" /></a>
  <a href="https://github.com/jee599/clisync/blob/main/LICENSE"><img src="https://img.shields.io/github/license/jee599/clisync?style=flat-square" alt="License" /></a>
  <img src="https://img.shields.io/badge/dependencies-0-brightgreen?style=flat-square" alt="Zero Dependencies" />
</p>

---

New machine. Claude Code, Gemini CLI, Codex all installed — but none of your settings, MCP servers, hooks, or slash commands carried over. You're setting everything up from scratch. Again.

**clisync** backs up all your LLM CLI configs to a private GitHub Gist and restores them anywhere in one command. **API keys are auto-redacted** (17 patterns) so your secrets never leave your machine.

```
Machine A                     GitHub Gist              Machine B
                               (private)
~/.claude/*  ─┐                                    ┌─> ~/.claude/*
~/.gemini/*  ─┼─ clisync save ─>  JSON bundle ─> clisync load ─┼─> ~/.gemini/*
~/.codex/*   ─┘                                    └─> ~/.codex/*
```

## Install

```bash
npm install -g clisync
```

## Quick Start

```bash
# Machine A — save your settings
clisync init     # opens browser → click "Authorize" → done
clisync save     # done

# Machine B — restore everything
clisync init     # same GitHub account
clisync load     # done — all configs restored
```

```
clisync init

  Open this URL in your browser and enter the code:
  https://github.com/login/device

  Code: ABCD-1234

  Waiting for browser authorization...

  ✓ Authenticated! (jee599)
```

> Prefer a personal access token? Use `clisync init --token`

```
clisync save

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
  Settings 5 | Hooks 1 | Skills 1 | Instructions 2
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

## Why Not chezmoi / yadm?

General dotfile managers work, but they don't know which files your LLM tools use. clisync does:

- **Auto-discovers** config paths for 6 LLM CLI tools
- **Auto-redacts** 17 API key patterns (OpenAI, Anthropic, AWS, GitHub, HuggingFace, etc.)
- **Auto-skips** sensitive files (`auth.json`, `.env`, `.pem`, `.key`)
- **Zero config** — no manifest file to maintain

## Commands

| Command | What it does |
|:---|:---|
| `clisync init` | Authenticate via GitHub OAuth (once per machine) |
| `clisync init --token` | Authenticate via personal access token |
| `clisync save` | Upload configs to private Gist |
| `clisync load` | Download and restore configs |
| `clisync list` | Show detected local configs |
| `clisync status` | Show sync status |
| `clisync link <gist-id>` | Link to existing Gist |

| Option | What it does |
|:---|:---|
| `--no-redact` | Upload without redacting API keys |
| `--force` | Overwrite without backups or confirmation |
| `--version` / `-v` | Show version |
| `--lang=en` / `--ko` | Change language (auto-detected) |

## Safety

- **17 API key patterns auto-redacted** — OpenAI, Anthropic, Google, AWS, GitHub, GitLab, HuggingFace, Slack, Replicate, Vercel, Supabase, and generic key-value patterns
- **Sensitive files auto-skipped** — `auth.json`, `credentials.json`, `.env`, `.pem`, `.key` are never uploaded
- **Confirmation prompt** — `clisync load` asks before overwriting (skip with `--force`)
- **Backups** — existing files saved as `.bak` before overwriting
- **AES-256-GCM encrypted** — Gist content is encrypted with a key derived from your token. Even with the URL, no one can read it without your token
- **Private Gist** — unlisted, not indexed by search
- **Token security** — hidden input on entry, file permissions 0600 (Unix)
- **Path traversal protection** — validates all paths on restore
- **Cross-platform** — macOS, Linux, Windows with consistent forward-slash path handling
- **Zero dependencies** — Node.js 18+ built-in modules only

## Language

Auto-detects system locale (English/Korean). Override with `--lang=en` or `--ko`.

## How It Works

```
clisync save:
  ~/.claude/* ──> scan ──> skip sensitive ──> redact secrets ──> JSON ──> Gist API
                                                                              |
clisync load:                                                                 |
  Gist API ──> download ──> validate paths ──> confirm ──> backup ──> write ──┘
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
