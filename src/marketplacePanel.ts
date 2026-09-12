import * as vscode from 'vscode';
import { MarketplaceService } from './marketplaceService';
import { addMarketplaceSource, installPlugin } from './installer';
import { listInstalledPlugins, removePlugin, setPluginEnabled } from './claudeCli';
import { AutoTuneRunResult } from './autoTune';
import { PluginSuggestion } from './pluginSuggestions';

type WebviewToExtensionMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'addMarketplace' }
  | { type: 'install'; plugin: string; marketplace: string }
  | { type: 'toggleEnabled'; id: string; enabled: boolean }
  | { type: 'uninstall'; id: string }
  | { type: 'createAgent' };

export class MarketplacePanel {
  private static current: MarketplacePanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];

  static createOrShow(
    extensionUri: vscode.Uri,
    marketplaceService: MarketplaceService,
    onInstalledChanged: () => void,
    getLastAutoTune: () => AutoTuneRunResult | undefined,
    getLastSuggestions: () => PluginSuggestion[]
  ): void {
    if (MarketplacePanel.current) {
      MarketplacePanel.current.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'claudeMarketplace.panel',
      'Claude Code Marketplace',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    MarketplacePanel.current = new MarketplacePanel(panel, marketplaceService, onInstalledChanged, getLastAutoTune, getLastSuggestions);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly marketplaceService: MarketplaceService,
    private readonly onInstalledChanged: () => void,
    private readonly getLastAutoTune: () => AutoTuneRunResult | undefined,
    private readonly getLastSuggestions: () => PluginSuggestion[]
  ) {
    this.panel = panel;
    this.panel.webview.html = this.renderShell();
    this.panel.webview.onDidReceiveMessage((m: WebviewToExtensionMessage) => this.handleMessage(m), undefined, this.disposables);
    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
  }

  private async handleMessage(message: WebviewToExtensionMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        await this.pushData(false);
        break;
      case 'refresh':
        await this.pushData(true);
        break;
      case 'addMarketplace':
        await this.promptAddMarketplace();
        break;
      case 'createAgent':
        await vscode.commands.executeCommand('claudeMarketplace.createAgent');
        break;
      case 'install':
        await installPlugin(message.plugin, message.marketplace);
        this.onInstalledChanged();
        await this.pushData(false);
        break;
      case 'toggleEnabled':
        try {
          await setPluginEnabled(message.id, message.enabled);
        } catch (err) {
          vscode.window.showErrorMessage(
            `Could not ${message.enabled ? 'enable' : 'disable'} ${message.id}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
        this.onInstalledChanged();
        await this.pushData(false);
        break;
      case 'uninstall': {
        const confirmed = await vscode.window.showWarningMessage(`Uninstall ${message.id}?`, { modal: true }, 'Uninstall');
        if (confirmed === 'Uninstall') {
          try {
            await removePlugin(message.id);
          } catch (err) {
            vscode.window.showErrorMessage(`Could not uninstall ${message.id}: ${err instanceof Error ? err.message : String(err)}`);
          }
          this.onInstalledChanged();
          await this.pushData(false);
        }
        break;
      }
    }
  }

  private async pushData(force: boolean): Promise<void> {
    this.panel.webview.postMessage({ type: 'loading' });
    const [loaded, installed] = await Promise.all([
      this.marketplaceService.loadAll(force),
      listInstalledPlugins().catch(() => []),
    ]);
    const installedMap: Record<string, boolean> = {};
    for (const p of installed) installedMap[p.id] = p.enabled;
    const suggestedIds = this.getLastSuggestions().map((s) => `${s.pluginName}@${s.marketplaceId}`);
    this.panel.webview.postMessage({
      type: 'data',
      marketplaces: loaded,
      installed: installedMap,
      lastAutoTune: this.getLastAutoTune(),
      suggested: suggestedIds,
    });
  }

  private async promptAddMarketplace(): Promise<void> {
    const input = await vscode.window.showInputBox({
      title: 'Add a Claude Code Marketplace',
      placeHolder: 'owner/repo or https://github.com/owner/repo',
      prompt: 'Enter a GitHub-hosted marketplace (must contain .claude-plugin/marketplace.json)',
    });
    if (!input) return;
    await this.marketplaceService.addSource(input.trim());
    await addMarketplaceSource(input.trim());
    await this.pushData(true);
  }

  private dispose(): void {
    MarketplacePanel.current = undefined;
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
    this.panel.dispose();
  }

  private renderShell(): string {
    const nonce = getNonce();
    const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`;
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
    padding: 0;
  }
  #app { display: flex; flex-direction: column; height: 100vh; }

  header {
    padding: 18px 24px 14px;
    border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  header h1 { font-size: 18px; margin: 0; font-weight: 600; }
  header .subtitle { font-size: 12px; opacity: 0.7; margin-top: 2px; }
  .toolbar { display: flex; gap: 8px; align-items: center; }
  #search {
    flex: 1;
    max-width: 480px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    padding: 7px 10px;
    border-radius: 6px;
    font-size: 13px;
  }
  #search:focus { outline: 1px solid var(--vscode-focusBorder); }
  button {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    padding: 6px 14px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
    white-space: nowrap;
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary {
    background: transparent;
    color: var(--vscode-foreground);
    border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
  }
  button.secondary:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.15)); }
  button.install {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    padding: 5px 12px;
  }
  button.install.installed {
    background: transparent;
    border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
    color: var(--vscode-foreground);
    cursor: default;
  }

  #body { flex: 1; display: flex; overflow: hidden; }

  nav#categories {
    width: 220px;
    flex-shrink: 0;
    border-right: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
    overflow-y: auto;
    padding: 14px 8px;
  }
  nav#categories .section-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    opacity: 0.55;
    padding: 10px 10px 4px;
  }
  .cat-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 10px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    gap: 6px;
  }
  .cat-item:hover { background: var(--vscode-list-hoverBackground); }
  .cat-item.active { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  .cat-item .count { font-size: 11px; opacity: 0.6; }

  main {
    flex: 1;
    overflow-y: auto;
    padding: 18px 24px 40px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 14px;
  }
  .card {
    border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
    border-radius: 10px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: var(--vscode-editorWidget-background, transparent);
    transition: box-shadow 0.15s ease, border-color 0.15s ease;
  }
  .card:hover {
    border-color: var(--vscode-focusBorder);
    box-shadow: 0 2px 10px rgba(0,0,0,0.15);
  }
  .card-top { display: flex; align-items: flex-start; gap: 10px; }
  .avatar {
    width: 34px; height: 34px; border-radius: 8px;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    display: flex; align-items: center; justify-content: center;
    font-weight: 700; font-size: 14px; flex-shrink: 0;
  }
  .card-title-wrap { flex: 1; min-width: 0; }
  .card-name { font-weight: 600; font-size: 13.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .card-meta { font-size: 11px; opacity: 0.65; margin-top: 1px; }
  .card-desc {
    font-size: 12px;
    opacity: 0.9;
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    min-height: 2.8em;
  }
  .tags { display: flex; flex-wrap: wrap; gap: 5px; }
  .tag {
    font-size: 10.5px;
    padding: 2px 7px;
    border-radius: 100px;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
    opacity: 0.85;
  }
  .card-footer { display: flex; justify-content: space-between; align-items: center; margin-top: auto; gap: 8px; }
  .source-badge { font-size: 10.5px; opacity: 0.55; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .installed-controls { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
  .uninstall-link {
    background: none; border: none; padding: 0; color: inherit; opacity: 0.55;
    font-size: 11px; text-decoration: underline; cursor: pointer;
  }
  .uninstall-link:hover { opacity: 1; color: var(--vscode-errorForeground); }
  .switch {
    position: relative; width: 32px; height: 18px; border-radius: 100px;
    background: var(--vscode-badge-background); cursor: pointer; flex-shrink: 0;
    transition: background 0.15s ease;
  }
  .switch.on { background: var(--vscode-button-background); }
  .switch .knob {
    position: absolute; top: 2px; left: 2px; width: 14px; height: 14px;
    border-radius: 50%; background: #fff; transition: transform 0.15s ease;
  }
  .switch.on .knob { transform: translateX(14px); }
  .switch-wrap { display: flex; align-items: center; gap: 6px; }
  .switch-label { font-size: 10.5px; opacity: 0.7; }
  .suggested-badge {
    font-size: 10px; font-weight: 600; padding: 2px 7px; border-radius: 100px;
    background: var(--vscode-charts-green, var(--vscode-button-background));
    color: var(--vscode-button-foreground);
  }
  .card.suggested { border-color: var(--vscode-charts-green, var(--vscode-focusBorder)); }

  #autotune-banner {
    margin: 14px 24px 0;
    padding: 10px 14px;
    border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
    border-left: 3px solid var(--vscode-charts-green, var(--vscode-focusBorder));
    border-radius: 6px;
    background: var(--vscode-editorWidget-background, transparent);
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
  }
  #autotune-banner .at-text { font-size: 12px; }
  #autotune-banner .at-text .at-title { font-weight: 600; margin-right: 4px; }
  #autotune-banner .at-text .at-changes { opacity: 0.85; }
  #autotune-banner .at-close {
    background: none; border: none; color: inherit; opacity: 0.6; cursor: pointer; font-size: 14px; padding: 0 2px;
  }
  #autotune-banner .at-close:hover { opacity: 1; }

  .empty, .status, .error-box {
    opacity: 0.75;
    font-size: 13px;
    padding: 40px 10px;
    text-align: center;
  }
  .error-box { color: var(--vscode-errorForeground); opacity: 1; }
  .section-heading {
    font-size: 12px;
    font-weight: 600;
    opacity: 0.7;
    margin: 4px 0 10px;
  }
</style>
</head>
<body>
<div id="app">
  <header>
    <div>
      <h1>Claude Code Marketplace</h1>
      <div class="subtitle">Browse plugins &amp; skills from Claude Code marketplaces and install with one click.</div>
    </div>
    <div class="toolbar">
      <input id="search" type="text" placeholder="Search plugins by name, description, or tag&hellip;" />
      <button id="addBtn" class="secondary">+ Add Source</button>
      <button id="createAgentBtn" class="secondary">+ New Agent</button>
      <button id="refreshBtn" class="secondary">Refresh</button>
    </div>
  </header>
  <div id="autotune-banner" hidden></div>
  <div id="body">
    <nav id="categories"></nav>
    <main id="main"><div class="status">Loading marketplaces&hellip;</div></main>
  </div>
</div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  let marketplaces = [];
  let installed = {};
  let suggested = [];
  let autoTuneBannerDismissed = false;
  let activeCategory = 'all';
  let searchTerm = '';

  document.getElementById('refreshBtn').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
  document.getElementById('addBtn').addEventListener('click', () => vscode.postMessage({ type: 'addMarketplace' }));
  document.getElementById('createAgentBtn').addEventListener('click', () => vscode.postMessage({ type: 'createAgent' }));
  document.getElementById('search').addEventListener('input', (e) => {
    searchTerm = e.target.value.toLowerCase();
    renderMain();
  });

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message.type === 'loading') {
      document.getElementById('main').innerHTML = '<div class="status">Loading marketplaces&hellip;</div>';
    } else if (message.type === 'data') {
      marketplaces = message.marketplaces;
      installed = message.installed || {};
      suggested = message.suggested || [];
      renderAutoTuneBanner(message.lastAutoTune);
      renderCategories();
      renderMain();
    }
  });

  function renderAutoTuneBanner(lastAutoTune) {
    const banner = document.getElementById('autotune-banner');
    if (autoTuneBannerDismissed || !lastAutoTune || !lastAutoTune.changes || !lastAutoTune.changes.length) {
      banner.hidden = true;
      banner.innerHTML = '';
      return;
    }
    banner.hidden = false;
    const changeText = lastAutoTune.changes
      .map((c) => (c.proposedEnabled ? 'enabled ' : 'disabled ') + c.id)
      .join(', ');
    banner.innerHTML =
      '<div class="at-text"><span class="at-title">Auto-tuned for this workspace:</span>' +
      '<span class="at-changes">' + escapeHtml(changeText) + '</span></div>' +
      '<button class="at-close" title="Dismiss">&times;</button>';
    banner.querySelector('.at-close').addEventListener('click', () => {
      autoTuneBannerDismissed = true;
      banner.hidden = true;
    });
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function allPlugins() {
    const out = [];
    for (const m of marketplaces) {
      if (m.error || !m.manifest) continue;
      for (const p of m.manifest.plugins || []) {
        const id = p.name + '@' + m.ref.id;
        out.push({ plugin: p, marketplaceId: m.ref.id, marketplaceLabel: m.ref.label || m.ref.id, id, installedEnabled: installed[id], suggested: suggested.includes(id) });
      }
    }
    return out;
  }

  function categoriesOf(entry) {
    const cats = new Set();
    if (entry.plugin.category) cats.add(entry.plugin.category);
    for (const t of entry.plugin.tags || []) cats.add(t);
    for (const k of entry.plugin.keywords || []) cats.add(k);
    if (cats.size === 0) cats.add('Other');
    return Array.from(cats);
  }

  function renderCategories() {
    const entries = allPlugins();
    const counts = new Map();
    for (const e of entries) {
      for (const c of categoriesOf(e)) {
        counts.set(c, (counts.get(c) || 0) + 1);
      }
    }
    const sourceCounts = new Map();
    for (const m of marketplaces) {
      sourceCounts.set(m.ref.id, (m.manifest && m.manifest.plugins ? m.manifest.plugins.length : 0));
    }

    const installedCount = entries.filter((e) => e.installedEnabled !== undefined).length;
    const suggestedCount = entries.filter((e) => e.suggested).length;

    let html = '<div class="section-label">Browse</div>';
    html += catItem('all', 'All Plugins', entries.length);
    html += catItem('installed', 'Installed', installedCount);
    if (suggestedCount > 0) html += catItem('suggested', 'Suggested for This Project', suggestedCount);
    html += '<div class="section-label">Categories</div>';
    for (const [cat, count] of Array.from(counts.entries()).sort((a, b) => b[1] - a[1])) {
      html += catItem('cat:' + cat, cat, count);
    }
    html += '<div class="section-label">Sources</div>';
    for (const m of marketplaces) {
      html += catItem('src:' + m.ref.id, m.ref.label || m.ref.id, sourceCounts.get(m.ref.id) || 0);
    }

    const nav = document.getElementById('categories');
    nav.innerHTML = html;
    nav.querySelectorAll('.cat-item').forEach((el) => {
      el.addEventListener('click', () => {
        activeCategory = el.getAttribute('data-key');
        renderCategories();
        renderMain();
      });
    });
  }

  function catItem(key, label, count) {
    const active = key === activeCategory ? ' active' : '';
    return '<div class="cat-item' + active + '" data-key="' + escapeHtml(key) + '">' +
      '<span>' + escapeHtml(label) + '</span><span class="count">' + count + '</span></div>';
  }

  function matchesFilter(entry) {
    if (searchTerm) {
      const hay = (entry.plugin.name + ' ' + (entry.plugin.description || '') + ' ' + (entry.plugin.tags || []).join(' ')).toLowerCase();
      if (!hay.includes(searchTerm)) return false;
    }
    if (activeCategory === 'all') return true;
    if (activeCategory === 'installed') return entry.installedEnabled !== undefined;
    if (activeCategory === 'suggested') return entry.suggested;
    if (activeCategory.startsWith('src:')) return entry.marketplaceId === activeCategory.slice(4);
    if (activeCategory.startsWith('cat:')) return categoriesOf(entry).includes(activeCategory.slice(4));
    return true;
  }

  function renderMain() {
    const main = document.getElementById('main');
    const errors = marketplaces.filter((m) => m.error);
    const entries = allPlugins().filter(matchesFilter);

    let html = '';
    for (const m of errors) {
      html += '<div class="error-box">' + escapeHtml(m.ref.label || m.ref.id) + ': ' + escapeHtml(m.error) + '</div>';
    }
    if (!entries.length) {
      html += '<div class="empty">No plugins match. Try a different search or category.</div>';
      main.innerHTML = html;
      return;
    }

    html += '<div class="grid">';
    for (const entry of entries) {
      const p = entry.plugin;
      const initial = (p.displayName || p.name || '?').charAt(0).toUpperCase();
      const author = p.author && p.author.name ? p.author.name : '';
      const tags = ((p.tags || []).concat(p.category ? [p.category] : [])).slice(0, 4);
      html += '<div class="card' + (entry.suggested ? ' suggested' : '') + '">' +
        '<div class="card-top">' +
          '<div class="avatar">' + escapeHtml(initial) + '</div>' +
          '<div class="card-title-wrap">' +
            '<div class="card-name">' + escapeHtml(p.displayName || p.name) + (entry.suggested ? ' <span class="suggested-badge">Suggested</span>' : '') + '</div>' +
            '<div class="card-meta">' + [author, p.version ? 'v' + p.version : ''].filter(Boolean).map(escapeHtml).join(' &middot; ') + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="card-desc">' + escapeHtml(p.description || '') + '</div>' +
        (tags.length ? '<div class="tags">' + tags.map((t) => '<span class="tag">' + escapeHtml(t) + '</span>').join('') + '</div>' : '') +
        '<div class="card-footer">' +
          '<span class="source-badge">' + escapeHtml(entry.marketplaceLabel) + '</span>' +
          (entry.installedEnabled === undefined
            ? '<button class="install" data-plugin="' + escapeHtml(p.name) + '" data-marketplace="' + escapeHtml(entry.marketplaceId) + '">Install</button>'
            : '<div class="installed-controls">' +
                '<button class="uninstall-link" data-id="' + escapeHtml(entry.id) + '">Uninstall</button>' +
                '<div class="switch-wrap">' +
                  '<span class="switch-label">' + (entry.installedEnabled ? 'On' : 'Off') + '</span>' +
                  '<div class="switch' + (entry.installedEnabled ? ' on' : '') + '" data-id="' + escapeHtml(entry.id) + '" data-enabled="' + entry.installedEnabled + '">' +
                    '<div class="knob"></div>' +
                  '</div>' +
                '</div>' +
              '</div>') +
        '</div>' +
      '</div>';
    }
    html += '</div>';
    main.innerHTML = html;
    main.querySelectorAll('button.install').forEach((btn) => {
      btn.addEventListener('click', () => {
        vscode.postMessage({
          type: 'install',
          plugin: btn.getAttribute('data-plugin'),
          marketplace: btn.getAttribute('data-marketplace'),
        });
        btn.textContent = 'Installing…';
      });
    });
    main.querySelectorAll('.switch').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-id');
        const nextEnabled = el.getAttribute('data-enabled') !== 'true';
        el.classList.toggle('on', nextEnabled);
        el.setAttribute('data-enabled', String(nextEnabled));
        const label = el.parentElement.querySelector('.switch-label');
        if (label) label.textContent = nextEnabled ? 'On' : 'Off';
        vscode.postMessage({ type: 'toggleEnabled', id, enabled: nextEnabled });
      });
    });
    main.querySelectorAll('.uninstall-link').forEach((btn) => {
      btn.addEventListener('click', () => {
        vscode.postMessage({ type: 'uninstall', id: btn.getAttribute('data-id') });
      });
    });
  }

  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
