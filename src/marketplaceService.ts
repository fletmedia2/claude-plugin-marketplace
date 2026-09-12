import * as vscode from 'vscode';
import { LoadedMarketplace, MarketplaceManifest, MarketplaceSourceRef } from './types';

const STORAGE_KEY = 'claudeMarketplace.sources';
const CACHE_PREFIX = 'claudeMarketplace.cache.';
const CACHE_TTL_MS = 15 * 60 * 1000;

const DEFAULT_SOURCES: MarketplaceSourceRef[] = [
  { id: 'anthropics/claude-plugins-official', label: 'Anthropic Official', builtin: true },
  { id: 'anthropics/claude-plugins-community', label: 'Community', builtin: true },
];

interface CacheEntry {
  fetchedAt: number;
  manifest?: MarketplaceManifest;
  error?: string;
}

export class MarketplaceService {
  constructor(private readonly context: vscode.ExtensionContext) {}

  getSources(): MarketplaceSourceRef[] {
    const stored = this.context.globalState.get<MarketplaceSourceRef[]>(STORAGE_KEY);
    if (!stored || stored.length === 0) {
      return DEFAULT_SOURCES;
    }
    const byId = new Map(stored.map((s) => [s.id, s]));
    for (const def of DEFAULT_SOURCES) {
      if (!byId.has(def.id)) byId.set(def.id, def);
    }
    return Array.from(byId.values());
  }

  async addSource(id: string, label?: string): Promise<void> {
    const sources = this.getSources().filter((s) => s.id !== id);
    sources.push({ id, label });
    await this.context.globalState.update(STORAGE_KEY, sources);
  }

  async removeSource(id: string): Promise<void> {
    const sources = this.getSources().filter((s) => s.id !== id);
    await this.context.globalState.update(STORAGE_KEY, sources);
    await this.context.globalState.update(CACHE_PREFIX + id, undefined);
  }

  async loadAll(forceRefresh = false): Promise<LoadedMarketplace[]> {
    const sources = this.getSources();
    return Promise.all(sources.map((ref) => this.load(ref, forceRefresh)));
  }

  async load(ref: MarketplaceSourceRef, forceRefresh = false): Promise<LoadedMarketplace> {
    const cacheKey = CACHE_PREFIX + ref.id;
    if (!forceRefresh) {
      const cached = this.context.globalState.get<CacheEntry>(cacheKey);
      if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
        return { ref, manifest: cached.manifest, error: cached.error };
      }
    }

    try {
      const manifest = await this.fetchManifest(ref.id);
      await this.context.globalState.update(cacheKey, { fetchedAt: Date.now(), manifest } as CacheEntry);
      return { ref, manifest };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await this.context.globalState.update(cacheKey, { fetchedAt: Date.now(), error } as CacheEntry);
      return { ref, error };
    }
  }

  private async fetchManifest(sourceId: string): Promise<MarketplaceManifest> {
    const repo = parseGitHubRepo(sourceId);
    if (!repo) {
      throw new Error(
        'Only GitHub-hosted marketplaces (owner/repo or github.com URL) can be browsed here. ' +
          'Add it with "claude plugin marketplace add" instead.'
      );
    }

    const branch = await this.getDefaultBranch(repo);
    const rawUrl = `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${branch}/.claude-plugin/marketplace.json`;
    const res = await fetch(rawUrl);
    if (!res.ok) {
      throw new Error(`Could not find .claude-plugin/marketplace.json in ${repo.owner}/${repo.repo} (HTTP ${res.status})`);
    }
    const manifest = (await res.json()) as MarketplaceManifest;
    if (!manifest || !Array.isArray(manifest.plugins)) {
      throw new Error(`Malformed marketplace.json in ${repo.owner}/${repo.repo}`);
    }
    return manifest;
  }

  private async getDefaultBranch(repo: { owner: string; repo: string }): Promise<string> {
    try {
      const res = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.repo}`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'claude-plugin-marketplace-vscode' },
      });
      if (res.ok) {
        const json = (await res.json()) as { default_branch?: string };
        if (json.default_branch) return json.default_branch;
      }
    } catch {
      // fall through to guesses below
    }
    return 'main';
  }
}

export function parseGitHubRepo(sourceId: string): { owner: string; repo: string } | undefined {
  const trimmed = sourceId.trim();

  const shorthand = trimmed.match(/^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
  if (shorthand && !trimmed.includes('://')) {
    return { owner: shorthand[1], repo: shorthand[2] };
  }

  try {
    const url = new URL(trimmed);
    if (url.hostname === 'github.com') {
      const parts = url.pathname.replace(/^\//, '').replace(/\.git$/, '').split('/');
      if (parts.length >= 2) {
        return { owner: parts[0], repo: parts[1] };
      }
    }
  } catch {
    // not a URL
  }

  return undefined;
}
