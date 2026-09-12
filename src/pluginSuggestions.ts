import { listInstalledPlugins } from './claudeCli';
import { MarketplaceService } from './marketplaceService';
import { HEURISTICS, buildWorkspaceContext } from './relevance';

export interface PluginSuggestion {
  pluginName: string;
  marketplaceId: string;
  marketplaceLabel: string;
  description: string;
}

/**
 * Proposes installing plugins that aren't installed anywhere yet but whose
 * heuristic signal is present in the workspace (e.g. @supabase/supabase-js
 * in package.json but no supabase plugin installed from any marketplace).
 * Never installs anything itself — installing new, previously-untrusted
 * plugin code is a bigger step than toggling something already installed,
 * so this only surfaces a suggestion for the user to act on.
 */
export async function computeSuggestions(marketplaceService: MarketplaceService): Promise<PluginSuggestion[]> {
  const [installed, ctx, marketplaces] = await Promise.all([
    listInstalledPlugins(),
    buildWorkspaceContext(),
    marketplaceService.loadAll(false),
  ]);
  const installedNames = new Set(installed.map((p) => p.id.split('@')[0]));
  const suggestions: PluginSuggestion[] = [];

  for (const heuristic of HEURISTICS) {
    if (installedNames.has(heuristic.pluginName)) continue;
    const relevant = await heuristic.detect(ctx);
    if (!relevant) continue;

    for (const m of marketplaces) {
      if (m.error || !m.manifest) continue;
      const match = m.manifest.plugins.find((p) => p.name === heuristic.pluginName);
      if (match) {
        suggestions.push({
          pluginName: heuristic.pluginName,
          marketplaceId: m.ref.id,
          marketplaceLabel: m.ref.label || m.ref.id,
          description: match.description || '',
        });
        break;
      }
    }
  }

  return suggestions;
}
