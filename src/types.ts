export interface PluginAuthor {
  name: string;
  email?: string;
  url?: string;
}

export interface PluginSourceObject {
  source: 'github' | 'url' | 'npm' | 'archive' | 'command';
  repo?: string;
  url?: string;
  package?: string;
  ref?: string;
  sha?: string;
  version?: string;
  command?: string;
}

export interface PluginManifestEntry {
  name: string;
  displayName?: string;
  description: string;
  version?: string;
  author?: PluginAuthor;
  homepage?: string;
  repository?: string;
  license?: string;
  keywords?: string[];
  category?: string;
  tags?: string[];
  source: string | PluginSourceObject;
}

export interface MarketplaceManifest {
  name: string;
  owner?: PluginAuthor;
  plugins: PluginManifestEntry[];
}

export interface MarketplaceSourceRef {
  /** GitHub "owner/repo" or a full marketplace source string, used as the unique id */
  id: string;
  /** Optional friendly label shown in the UI */
  label?: string;
  /** True for the couple of sources we ship by default */
  builtin?: boolean;
}

export interface LoadedMarketplace {
  ref: MarketplaceSourceRef;
  manifest?: MarketplaceManifest;
  error?: string;
}

export interface InstalledPluginInfo {
  id: string;
  enabled: boolean;
}
