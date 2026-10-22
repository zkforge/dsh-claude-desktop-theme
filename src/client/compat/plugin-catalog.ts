import type { Context } from '@deepseek-ai/cordis';

export interface PluginCatalogEntry {
  name: string;
  version?: string;
  title: string;
  optionalOfficial: boolean;
}
export interface PluginCatalogPort {
  read(): Promise<readonly PluginCatalogEntry[]>;
  subscribe(listener: () => void): () => void;
}

/** Read installed versions and available official bundles from the same host
 * catalog as the native page. No package metadata is guessed from its name. */
export function pluginCatalogPort(ctx: Context): PluginCatalogPort {
  const remote = ctx.remote as unknown as {
    pluginManager: { listBundles(): Promise<{ ok: boolean; value?: unknown }> };
    $on(event: string, listener: () => void): () => void;
  };
  return {
    async read() {
      const result = await remote.pluginManager.listBundles();
      if (!result.ok || !Array.isArray(result.value)) throw new Error('Plugin catalog unavailable');
      return result.value.flatMap((value: unknown) => {
        if (!value || typeof value !== 'object') return [];
        const item = value as { name?: unknown; version?: unknown; official?: unknown; optional?: unknown; meta?: { title?: unknown } };
        if (typeof item.name !== 'string') return [];
        const title = item.meta?.title;
        const resolved = typeof title === 'string' ? title : title && typeof title === 'object'
          ? ctx.locale.resolveText(title as Parameters<typeof ctx.locale.resolveText>[0]) : item.name;
        return [{ name: item.name, title: resolved || item.name, optionalOfficial: item.official === true && item.optional === true,
          ...(typeof item.version === 'string' ? { version: item.version } : {}) }];
      });
    },
    subscribe: listener => remote.$on('plugin-manager/changed', listener),
  };
}
