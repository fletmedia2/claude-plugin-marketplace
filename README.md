# Claude Code Marketplace

A VS Code extension for browsing, installing, and managing [Claude Code](https://claude.com/claude-code) plugins and skills — right inside the editor.

## Features

- **Graphical marketplace panel** — search, category/source filters, and a card grid for every plugin across your configured marketplaces (defaults to the official and community marketplaces).
- **One-click install** — delegates to the official Claude Code VS Code extension's own install flow when available, falling back to the `claude` CLI otherwise.
- **Inline enable/disable toggles** and an Uninstall action on every installed plugin's card — no command palette required.
- **Workspace-aware auto-tune** — detects what your project actually uses (via `package.json` dependencies and telltale config files) and automatically enables/disables already-installed plugins to match, live, as you work.
- **Plugin suggestions** — flags plugins that aren't installed yet but match a detected need, surfaced as a notification and a "Suggested for This Project" section in the panel. Never installs anything automatically.
- **Create Agent wizard** — a graphical form for scaffolding a new Claude Code subagent (`.claude/agents/*.md`) without hand-writing YAML frontmatter.

## Installing

```
npm install
npm run build
npx vsce package
```

Then in VS Code: Extensions panel → `...` → **Install from VSIX...** → select the generated `.vsix`.

For development, open this folder in VS Code and press `F5` to launch an Extension Development Host.

---

Made by Flet Media.
