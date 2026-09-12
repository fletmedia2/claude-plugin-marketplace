import * as vscode from 'vscode';

/**
 * Only plugins with a clear, checkable file/dependency signal go through this
 * table — it backs both auto-tune (enable/disable what's already installed)
 * and plugin suggestions (propose installing something that isn't). Anything
 * without a reliable signal (10x-team, adobe-for-creativity, github,
 * context7...) is deliberately absent: we'd rather stay silent than guess.
 */
export interface Heuristic {
  /** Bare plugin name, matched against the part of an id before "@" */
  pluginName: string;
  detect(ctx: WorkspaceContext): Promise<boolean>;
}

export interface WorkspaceContext {
  deps: Set<string>;
  hasFiles(glob: string): Promise<boolean>;
}

/**
 * File globs that feed the heuristics below. Exported so the extension can
 * watch these specific patterns and re-run detection when one of them
 * changes, instead of only checking at workspace-open time.
 */
export const RELEVANCE_WATCH_GLOBS = [
  '**/package.json',
  '**/supabase/config.toml',
  '**/sentry.{client,server,edge}.config.{js,ts}',
  '**/app.json',
  '**/app.config.{js,ts}',
  '**/playwright.config.{js,ts}',
  '**/*.swift',
  '**/*.kt',
  '**/*.kts',
];

export const HEURISTICS: Heuristic[] = [
  { pluginName: 'supabase', detect: (ctx) => hasAny(ctx, ['@supabase/supabase-js', '@supabase/ssr'], ['**/supabase/config.toml']) },
  { pluginName: 'stripe', detect: (ctx) => hasAny(ctx, ['stripe', '@stripe/stripe-js', '@stripe/react-stripe-js'], []) },
  { pluginName: 'sentry', detect: (ctx) => hasAny(ctx, ['@sentry/node', '@sentry/nextjs', '@sentry/react'], ['**/sentry.{client,server,edge}.config.{js,ts}']) },
  { pluginName: 'expo', detect: (ctx) => hasAny(ctx, ['expo'], ['**/app.json', '**/app.config.{js,ts}']) },
  { pluginName: 'playwright', detect: (ctx) => hasAny(ctx, ['@playwright/test', 'playwright'], ['**/playwright.config.{js,ts}']) },
  { pluginName: 'swift-lsp', detect: (ctx) => hasAny(ctx, [], ['**/*.swift']) },
  { pluginName: 'kotlin-lsp', detect: (ctx) => hasAny(ctx, [], ['**/*.kt', '**/*.kts']) },
];

async function hasAny(ctx: WorkspaceContext, deps: string[], globs: string[]): Promise<boolean> {
  if (deps.some((d) => ctx.deps.has(d))) return true;
  for (const g of globs) {
    if (await ctx.hasFiles(g)) return true;
  }
  return false;
}

export async function buildWorkspaceContext(): Promise<WorkspaceContext> {
  const deps = new Set<string>();
  const pkgFiles = await vscode.workspace.findFiles('**/package.json', '**/node_modules/**', 5);
  for (const uri of pkgFiles) {
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const pkg = JSON.parse(Buffer.from(bytes).toString('utf8'));
      for (const dep of Object.keys(pkg.dependencies ?? {})) deps.add(dep);
      for (const dep of Object.keys(pkg.devDependencies ?? {})) deps.add(dep);
    } catch {
      // ignore unreadable/invalid package.json
    }
  }

  const fileCache = new Map<string, boolean>();
  return {
    deps,
    async hasFiles(glob: string): Promise<boolean> {
      if (fileCache.has(glob)) return fileCache.get(glob)!;
      const found = await vscode.workspace.findFiles(glob, '**/node_modules/**', 1);
      const result = found.length > 0;
      fileCache.set(glob, result);
      return result;
    },
  };
}
