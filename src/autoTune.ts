import { InstalledPluginRecord, listInstalledPlugins, setPluginEnabled } from './claudeCli';
import { HEURISTICS, buildWorkspaceContext } from './relevance';

export interface AutoTuneProposal {
  id: string;
  bareName: string;
  currentlyEnabled: boolean;
  proposedEnabled: boolean;
}

export async function computeAutoTuneProposals(knownInstalled?: InstalledPluginRecord[]): Promise<AutoTuneProposal[]> {
  const [installed, ctx] = await Promise.all([knownInstalled ?? listInstalledPlugins(), buildWorkspaceContext()]);
  const proposals: AutoTuneProposal[] = [];

  for (const heuristic of HEURISTICS) {
    const matches = installed.filter((p) => p.id.split('@')[0] === heuristic.pluginName);
    if (matches.length === 0) continue;
    const relevant = await heuristic.detect(ctx);
    for (const plugin of matches) {
      if (plugin.enabled !== relevant) {
        proposals.push({
          id: plugin.id,
          bareName: heuristic.pluginName,
          currentlyEnabled: plugin.enabled,
          proposedEnabled: relevant,
        });
      }
    }
  }

  return proposals;
}

export interface AutoTuneRunResult {
  appliedAt: number;
  changes: AutoTuneProposal[];
  errors: string[];
}

/**
 * Computes and immediately applies plugin enable/disable changes for the
 * current workspace, with no confirmation step. Safe to call repeatedly:
 * once state matches what's detected, it's a no-op. Callers control *when*
 * this runs (workspace open, folder change, manual re-check) — it should
 * not be wired to fire on every UI refresh, since that would fight a toggle
 * the user just flipped by hand moments earlier.
 */
export async function autoTuneWorkspace(): Promise<AutoTuneRunResult> {
  const proposals = await computeAutoTuneProposals();
  const changes: AutoTuneProposal[] = [];
  const errors: string[] = [];

  for (const proposal of proposals) {
    try {
      await setPluginEnabled(proposal.id, proposal.proposedEnabled);
      changes.push(proposal);
    } catch (err) {
      errors.push(`${proposal.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { appliedAt: Date.now(), changes, errors };
}
