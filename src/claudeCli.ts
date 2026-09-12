import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

const CLAUDE_CODE_EXTENSION_ID = 'anthropic.claude-code';

export function resolveClaudeBinaryPath(): string {
  const ext = vscode.extensions.getExtension(CLAUDE_CODE_EXTENSION_ID);
  if (ext) {
    const binaryName = process.platform === 'win32' ? 'claude.exe' : 'claude';
    const bundled = path.join(ext.extensionPath, 'resources', 'native-binary', binaryName);
    if (fs.existsSync(bundled)) return bundled;
  }
  return 'claude';
}

export interface InstalledPluginRecord {
  id: string;
  version: string;
  scope: 'user' | 'project' | 'local';
  enabled: boolean;
  installPath: string;
}

function runClaudeJson(args: string[], cwd?: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    execFile(resolveClaudeBinaryPath(), args, { cwd, timeout: 20000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr?.toString() || err.message));
        return;
      }
      try {
        resolve(JSON.parse(stdout.toString()));
      } catch {
        reject(new Error(`Could not parse claude CLI output: ${stdout}`));
      }
    });
  });
}

export async function listInstalledPlugins(cwd?: string): Promise<InstalledPluginRecord[]> {
  const result = await runClaudeJson(['plugin', 'list', '--json'], cwd);
  return result as InstalledPluginRecord[];
}

export async function setPluginEnabled(id: string, enabled: boolean, cwd?: string): Promise<void> {
  await runClaudeJson(['plugin', enabled ? 'enable' : 'disable', id, '--json'], cwd);
}

export async function removePlugin(id: string, cwd?: string): Promise<void> {
  await runClaudeJson(['plugin', 'uninstall', id, '--json'], cwd);
}
