import { join } from "node:path";
import { homedir } from "node:os";

const HOME = homedir();

export const PROFILES = [
  {
    name: "Claude Code",
    id: "claude-code",
    paths: [
      { rel: ".claude/settings.json", desc: "Global settings", cat: "settings" },
      { rel: ".claude/keybindings.json", desc: "Keyboard shortcuts", cat: "settings" },
      { rel: ".claude/CLAUDE.md", desc: "Global instructions", cat: "instructions" },
      { rel: ".claude/hooks", desc: "Hooks", dir: true, cat: "hooks" },
      { rel: ".claude/skills", desc: "Skills (slash commands)", dir: true, cat: "skills" },
      { rel: ".claude/plugins/installed_plugins.json", desc: "Installed plugins list", cat: "settings" },
      { rel: ".claude/teams", desc: "Team configs", dir: true, cat: "settings" },
    ],
  },
  {
    name: "Gemini CLI",
    id: "gemini-cli",
    paths: [
      { rel: ".gemini/settings.json", desc: "Settings", cat: "settings" },
      { rel: ".gemini/projects.json", desc: "Project configs", cat: "settings" },
      { rel: ".gemini/antigravity/mcp_config.json", desc: "MCP configs", cat: "mcp" },
    ],
  },
  {
    name: "OpenAI Codex",
    id: "codex",
    paths: [
      { rel: ".codex/config.toml", desc: "Config", cat: "settings" },
      { rel: ".codex/rules", desc: "Rules", dir: true, cat: "instructions" },
    ],
  },
  {
    name: "Aider",
    id: "aider",
    paths: [
      { rel: ".aider.conf.yml", desc: "Config", cat: "settings" },
      { rel: ".aider.model.settings.yml", desc: "Model settings", cat: "settings" },
    ],
  },
  {
    name: "Continue",
    id: "continue",
    paths: [
      { rel: ".continue/config.json", desc: "Config", cat: "settings" },
      { rel: ".continue/config.yaml", desc: "Config (YAML)", cat: "settings" },
    ],
  },
  {
    name: "GitHub Copilot CLI",
    id: "copilot-cli",
    paths: [
      { rel: ".config/github-copilot/settings.json", desc: "Settings", cat: "settings" },
    ],
  },
];

export function abs(rel) {
  return join(HOME, rel);
}
