import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

type WebviewToExtensionMessage =
  | { type: 'ready' }
  | {
      type: 'create';
      scope: 'project' | 'personal';
      name: string;
      description: string;
      tools: string[];
      allTools: boolean;
      model: string;
      prompt: string;
    };

const AVAILABLE_TOOLS = ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash', 'WebFetch', 'WebSearch', 'Agent'];

export class CreateAgentPanel {
  private static current: CreateAgentPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];

  static createOrShow(): void {
    if (CreateAgentPanel.current) {
      CreateAgentPanel.current.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'claudeMarketplace.createAgent',
      'Create Claude Agent',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    CreateAgentPanel.current = new CreateAgentPanel(panel);
  }

  private constructor(panel: vscode.WebviewPanel) {
    this.panel = panel;
    this.panel.webview.html = this.renderShell();
    this.panel.webview.onDidReceiveMessage((m: WebviewToExtensionMessage) => this.handleMessage(m), undefined, this.disposables);
    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
  }

  private async handleMessage(message: WebviewToExtensionMessage): Promise<void> {
    if (message.type !== 'create') return;

    const name = message.name.trim();
    if (!/^[a-z][a-z0-9-]*$/.test(name)) {
      vscode.window.showErrorMessage('Agent name must be lowercase kebab-case (letters, digits, hyphens), e.g. "sourcd-reviewer".');
      return;
    }
    if (!message.description.trim()) {
      vscode.window.showErrorMessage('Description is required — Claude uses it to decide when to delegate to this agent.');
      return;
    }

    const baseDir =
      message.scope === 'project'
        ? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
        : os.homedir();
    if (!baseDir) {
      vscode.window.showErrorMessage('No workspace folder is open — open a folder to create a project-scoped agent, or choose Personal.');
      return;
    }

    const agentsDir = path.join(baseDir, '.claude', 'agents');
    const filePath = path.join(agentsDir, `${name}.md`);
    if (fs.existsSync(filePath)) {
      const overwrite = await vscode.window.showWarningMessage(`${name}.md already exists. Overwrite?`, { modal: true }, 'Overwrite');
      if (overwrite !== 'Overwrite') return;
    }

    const frontmatterLines = ['---', `name: ${name}`, `description: ${yamlScalar(message.description.trim())}`];
    if (!message.allTools && message.tools.length > 0) {
      frontmatterLines.push('tools:');
      for (const t of message.tools) frontmatterLines.push(`  - ${t}`);
    }
    if (message.model && message.model !== 'inherit') {
      frontmatterLines.push(`model: ${message.model}`);
    }
    frontmatterLines.push('---', '', message.prompt.trim() || 'TODO: system prompt for this agent.', '');
    const content = frontmatterLines.join('\n');

    try {
      fs.mkdirSync(agentsDir, { recursive: true });
      fs.writeFileSync(filePath, content, 'utf8');
    } catch (err) {
      vscode.window.showErrorMessage(`Could not write agent file: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    const doc = await vscode.workspace.openTextDocument(filePath);
    await vscode.window.showTextDocument(doc);
    vscode.window.showInformationMessage(
      `Created agent "${name}" at ${message.scope === 'project' ? '.claude/agents/' : '~/.claude/agents/'}${name}.md. It's available next session (or now via /reload-plugins if supported).`
    );
  }

  private dispose(): void {
    CreateAgentPanel.current = undefined;
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
    this.panel.dispose();
  }

  private renderShell(): string {
    const nonce = getNonce();
    const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`;
    const toolCheckboxes = AVAILABLE_TOOLS.map(
      (t) => `<label class="tool-item"><input type="checkbox" value="${t}" checked /> ${t}</label>`
    ).join('');

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    margin: 0;
    padding: 24px;
    max-width: 720px;
  }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .subtitle { font-size: 12px; opacity: 0.7; margin-bottom: 20px; }
  .field { margin-bottom: 16px; }
  label.field-label { display: block; font-size: 12px; font-weight: 600; margin-bottom: 4px; }
  .hint { font-size: 11px; opacity: 0.65; margin-top: 3px; }
  input[type=text], textarea, select {
    width: 100%;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    padding: 7px 9px;
    border-radius: 6px;
    font-size: 13px;
    font-family: var(--vscode-font-family);
  }
  textarea { resize: vertical; min-height: 70px; }
  textarea#prompt { min-height: 160px; font-family: var(--vscode-editor-font-family, monospace); }
  input[type=text]:focus, textarea:focus, select:focus { outline: 1px solid var(--vscode-focusBorder); }
  .scope-row { display: flex; gap: 16px; }
  .scope-row label { display: flex; align-items: center; gap: 6px; font-size: 13px; }
  .tools-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px 12px; }
  .tool-item { display: flex; align-items: center; gap: 6px; font-size: 12.5px; }
  .all-tools-row { margin-bottom: 8px; font-size: 12.5px; display: flex; align-items: center; gap: 6px; }
  button {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    padding: 8px 18px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
</style>
</head>
<body>
  <h1>Create a New Agent</h1>
  <div class="subtitle">A specialized assistant Claude can delegate to for a specific kind of task. Fill this in and it's written straight to a ready-to-use file — no YAML by hand.</div>

  <div class="field">
    <label class="field-label">Where should it live?</label>
    <div class="scope-row">
      <label><input type="radio" name="scope" value="project" checked /> This project (<code>.claude/agents/</code>)</label>
      <label><input type="radio" name="scope" value="personal" /> Every project (<code>~/.claude/agents/</code>)</label>
    </div>
  </div>

  <div class="field">
    <label class="field-label" for="name">Name</label>
    <input type="text" id="name" placeholder="e.g. sourcd-reviewer" />
    <div class="hint">Lowercase, kebab-case. This becomes the filename.</div>
  </div>

  <div class="field">
    <label class="field-label" for="description">Description (when should Claude use this agent?)</label>
    <textarea id="description" placeholder="Use this agent to review new Supabase migrations for missing RLS policies before merging."></textarea>
    <div class="hint">This is what Claude reads to decide whether to delegate to this agent — describe the task, not the agent's name.</div>
  </div>

  <div class="field">
    <label class="field-label">Tools it can use</label>
    <div class="all-tools-row"><label><input type="checkbox" id="allTools" /> All tools (no restriction)</label></div>
    <div class="tools-grid" id="toolsGrid">${toolCheckboxes}</div>
    <div class="hint">Read-only agents (Read/Grep/Glob only) are safer for review-style tasks.</div>
  </div>

  <div class="field">
    <label class="field-label" for="model">Model</label>
    <select id="model">
      <option value="inherit">Inherit from main conversation (default)</option>
      <option value="sonnet">Sonnet</option>
      <option value="opus">Opus</option>
      <option value="haiku">Haiku</option>
    </select>
  </div>

  <div class="field">
    <label class="field-label" for="prompt">System prompt</label>
    <textarea id="prompt" placeholder="You are a focused reviewer for the sourcd-app codebase.&#10;Check for: missing RLS policies, unvalidated webhook signatures, naming inconsistent with existing migrations."></textarea>
  </div>

  <button id="createBtn">Create Agent</button>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  document.getElementById('allTools').addEventListener('change', (e) => {
    document.getElementById('toolsGrid').style.opacity = e.target.checked ? '0.4' : '1';
    document.querySelectorAll('#toolsGrid input').forEach((el) => (el.disabled = e.target.checked));
  });
  document.getElementById('createBtn').addEventListener('click', () => {
    const scope = document.querySelector('input[name=scope]:checked').value;
    const name = document.getElementById('name').value;
    const description = document.getElementById('description').value;
    const allTools = document.getElementById('allTools').checked;
    const tools = Array.from(document.querySelectorAll('#toolsGrid input:checked')).map((el) => el.value);
    const model = document.getElementById('model').value;
    const prompt = document.getElementById('prompt').value;
    vscode.postMessage({ type: 'create', scope, name, description, tools, allTools, model, prompt });
  });
  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
  }
}

function yamlScalar(value: string): string {
  if (/[:#"'{}\[\]|>*&!%@`,\n]/.test(value) || value.trim() !== value) {
    return JSON.stringify(value);
  }
  return value;
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
