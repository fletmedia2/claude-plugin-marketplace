import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { MarketplaceService } from './marketplaceService';
import { MarketplacePanel } from './marketplacePanel';
import { CreateAgentPanel } from './createAgentPanel';
import { InstalledTreeProvider } from './installedTreeProvider';
import { uninstallPlugin } from './installer';
import { autoTuneWorkspace, AutoTuneRunResult } from './autoTune';
import { computeSuggestions, PluginSuggestion } from './pluginSuggestions';
import { RELEVANCE_WATCH_GLOBS } from './relevance';

const CHECK_DEBOUNCE_MS = 4000;

export function activate(context: vscode.ExtensionContext): void {
  const marketplaceService = new MarketplaceService(context);
  const installedTree = new InstalledTreeProvider();
  let lastAutoTuneResult: AutoTuneRunResult | undefined;
  let lastSuggestions: PluginSuggestion[] = [];
  const notifiedSuggestions = new Set<string>();

  vscode.window.registerTreeDataProvider('claudeMarketplace.installed', installedTree);

  const openPanel = () =>
    MarketplacePanel.createOrShow(
      context.extensionUri,
      marketplaceService,
      () => installedTree.refresh(),
      () => lastAutoTuneResult,
      () => lastSuggestions
    );

  async function performAutoTune(interactive: boolean): Promise<void> {
    let result: AutoTuneRunResult;
    try {
      result = await autoTuneWorkspace();
    } catch (err) {
      if (interactive) {
        vscode.window.showErrorMessage(`Auto-tune failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    lastAutoTuneResult = result;
    if (result.changes.length > 0) {
      installedTree.refresh();
      const summary = result.changes.map((c) => `${c.proposedEnabled ? 'enabled' : 'disabled'} ${c.id}`).join(', ');
      vscode.window.showInformationMessage(`Claude Marketplace auto-tuned this workspace: ${summary}.`);
    } else if (interactive) {
      vscode.window.showInformationMessage('Auto-tune: plugin state already matches what this workspace uses.');
    }
    if (result.errors.length > 0) {
      vscode.window.showWarningMessage(`Auto-tune had errors: ${result.errors.join('; ')}`);
    }
  }

  async function performSuggestions(interactive: boolean): Promise<void> {
    let suggestions: PluginSuggestion[];
    try {
      suggestions = await computeSuggestions(marketplaceService);
    } catch (err) {
      if (interactive) {
        vscode.window.showErrorMessage(`Could not check for plugin suggestions: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    lastSuggestions = suggestions;
    const fresh = suggestions.filter((s) => !notifiedSuggestions.has(s.pluginName));
    for (const s of suggestions) notifiedSuggestions.add(s.pluginName);

    if (fresh.length > 0) {
      const names = fresh.map((s) => s.pluginName).join(', ');
      vscode.window
        .showInformationMessage(
          `Claude Marketplace: this workspace looks like it could use ${fresh.length === 1 ? 'the ' + names + ' plugin' : names}. Not installed automatically — review it first.`,
          'Open Marketplace',
          'Dismiss'
        )
        .then((choice) => {
          if (choice === 'Open Marketplace') openPanel();
        });
    } else if (interactive) {
      vscode.window.showInformationMessage(
        suggestions.length > 0
          ? `Claude Marketplace: ${suggestions.length} suggestion(s) already surfaced this session — see the Suggested tab in the marketplace panel.`
          : 'Claude Marketplace: no new plugin suggestions for this workspace.'
      );
    }
  }

  async function performWorkspaceChecks(interactive: boolean): Promise<void> {
    if (!vscode.workspace.workspaceFolders?.length) return;
    await performAutoTune(interactive);
    await performSuggestions(interactive);
  }

  const claudeDir = path.join(os.homedir(), '.claude');
  const settingsWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(vscode.Uri.file(claudeDir), 'settings.json')
  );
  settingsWatcher.onDidChange(() => installedTree.refresh());
  settingsWatcher.onDidCreate(() => installedTree.refresh());
  settingsWatcher.onDidDelete(() => installedTree.refresh());

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleChecks = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => void performWorkspaceChecks(false), CHECK_DEBOUNCE_MS);
  };
  const relevanceWatchers = RELEVANCE_WATCH_GLOBS.map((glob) => {
    const watcher = vscode.workspace.createFileSystemWatcher(glob);
    watcher.onDidChange(scheduleChecks);
    watcher.onDidCreate(scheduleChecks);
    watcher.onDidDelete(scheduleChecks);
    return watcher;
  });

  context.subscriptions.push(
    settingsWatcher,
    ...relevanceWatchers,
    vscode.workspace.onDidChangeWorkspaceFolders(() => void performWorkspaceChecks(false)),
    vscode.commands.registerCommand('claudeMarketplace.open', openPanel),
    vscode.commands.registerCommand('claudeMarketplace.createAgent', () => CreateAgentPanel.createOrShow()),
    vscode.commands.registerCommand('claudeMarketplace.refresh', () => installedTree.refresh()),
    vscode.commands.registerCommand('claudeMarketplace.autoTune', () => performWorkspaceChecks(true)),
    vscode.commands.registerCommand('claudeMarketplace.uninstallPlugin', async (item: { pluginId?: string }) => {
      const id = item?.pluginId ?? (await vscode.window.showInputBox({ prompt: 'plugin-name@marketplace' }));
      if (!id || !id.includes('@')) return;
      const [pluginName, marketplaceId] = id.split('@');
      await uninstallPlugin(pluginName, marketplaceId);
      installedTree.refresh();
    }),
    { dispose: () => debounceTimer && clearTimeout(debounceTimer) }
  );

  void performWorkspaceChecks(false);
}

export function deactivate(): void {}
