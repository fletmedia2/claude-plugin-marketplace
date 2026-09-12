import * as vscode from 'vscode';
import { resolveClaudeBinaryPath } from './claudeCli';

const CLAUDE_CODE_EXTENSION_ID = 'anthropic.claude-code';
let sharedTerminal: vscode.Terminal | undefined;

function isOfficialExtensionInstalled(): boolean {
  return vscode.extensions.getExtension(CLAUDE_CODE_EXTENSION_ID) !== undefined;
}

function resolveClaudeCommand(): string {
  return quoteArg(resolveClaudeBinaryPath());
}

function getTerminal(): vscode.Terminal {
  if (!sharedTerminal || sharedTerminal.exitStatus !== undefined) {
    sharedTerminal = vscode.window.createTerminal('Claude Plugin Marketplace');
  }
  return sharedTerminal;
}

function runInTerminal(command: string): void {
  const terminal = getTerminal();
  terminal.show();
  terminal.sendText(command);
}

export async function addMarketplaceSource(sourceId: string): Promise<void> {
  if (isOfficialExtensionInstalled()) {
    const uri = vscode.Uri.parse(
      `vscode://${CLAUDE_CODE_EXTENSION_ID}/install-plugin?marketplace=${encodeURIComponent(sourceId)}`
    );
    const opened = await vscode.env.openExternal(uri);
    if (opened) return;
  }
  const claude = resolveClaudeCommand();
  runInTerminal(`${claude} plugin marketplace add ${quoteArg(sourceId)}`);
}

export async function installPlugin(pluginName: string, marketplaceId: string): Promise<void> {
  if (isOfficialExtensionInstalled()) {
    const uri = vscode.Uri.parse(
      `vscode://${CLAUDE_CODE_EXTENSION_ID}/install-plugin?plugin=${encodeURIComponent(pluginName)}&marketplace=${encodeURIComponent(marketplaceId)}`
    );
    const opened = await vscode.env.openExternal(uri);
    if (opened) return;
  }
  const claude = resolveClaudeCommand();
  runInTerminal(
    `${claude} plugin marketplace add ${quoteArg(marketplaceId)} && ${claude} plugin install ${quoteArg(`${pluginName}@${marketplaceId}`)}`
  );
}

export async function uninstallPlugin(pluginName: string, marketplaceId: string): Promise<void> {
  const claude = resolveClaudeCommand();
  runInTerminal(`${claude} plugin uninstall ${quoteArg(`${pluginName}@${marketplaceId}`)}`);
}

function quoteArg(value: string): string {
  if (/^[\w./@-]+$/.test(value)) return value;
  return `"${value.replace(/(["$`\\])/g, '\\$1')}"`;
}
