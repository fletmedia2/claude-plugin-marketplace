import * as vscode from 'vscode';
import { listInstalledPlugins } from './claudeCli';

export class InstalledPluginItem extends vscode.TreeItem {
  constructor(public readonly pluginId: string, enabled: boolean, version: string, scope: string) {
    super(pluginId, vscode.TreeItemCollapsibleState.None);
    this.description = `${enabled ? '' : 'disabled · '}v${version} · ${scope}`;
    this.iconPath = new vscode.ThemeIcon(enabled ? 'extensions' : 'circle-slash');
    this.contextValue = 'installedPlugin';
  }
}

export class InstalledTreeProvider implements vscode.TreeDataProvider<InstalledPluginItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private cached: InstalledPluginItem[] = [];

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: InstalledPluginItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<InstalledPluginItem[]> {
    try {
      const plugins = await listInstalledPlugins();
      this.cached = plugins
        .slice()
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((p) => new InstalledPluginItem(p.id, p.enabled, p.version, p.scope));
    } catch {
      // claude CLI unavailable or not yet configured; show last known list
    }
    return this.cached;
  }
}
