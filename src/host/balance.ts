import type { Context } from '@deepseek-ai/cordis';
import { BALANCE_PATH, readCnyBalance } from '../shared/balance.ts';

interface LoaderEntry {
  readonly disabled?: boolean;
  readonly options?: { readonly name?: string; readonly config?: { apiKeyEnv?: string; baseURL?: string } };
}

/** Resolve the same reference as DSH's official API-key provider, only on Host. */
export async function readBalanceKey(ctx: Context): Promise<string | undefined> {
  const loader = ctx.get('loader') as { entries(): Iterable<LoaderEntry> } | undefined;
  const entry = loader && [...loader.entries()].find(entry => entry.disabled !== true
    && entry.options?.name === '@deepseek-ai/dsh-llm-deepseek-api-key');
  if (!entry) return undefined;
  const config = entry.options?.config;
  const environment = ctx.get('launchEnvironment') as { get(name: string): { value: string } | undefined } | undefined;
  const baseURL = config?.baseURL ?? (environment ? environment.get('DEEPSEEK_BASE_URL')?.value
    : process.env['DEEPSEEK_BASE_URL']) ?? 'https://api.deepseek.com/anthropic';
  // A custom endpoint's credential must never be sent to the official API.
  if (new URL(baseURL).origin !== 'https://api.deepseek.com') return undefined;
  const ref = config?.apiKeyEnv ?? 'DEEPSEEK_API_KEY';
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(ref)) return undefined;
  const credentials = ctx.get('credentials') as { resolve(ref: string): Promise<{ value: string } | undefined> } | undefined;
  const key = credentials ? (await credentials.resolve(ref))?.value
    : environment ? environment.get(ref)?.value : process.env[ref];
  return key?.trim() || undefined;
}

/** Authenticated renderer route; only normalized balances leave the Host. */
export function mountDeepSeekBalance(ctx: Context, isEnabled: () => boolean): void {
  ctx.inject(['connection'], injected => {
    if (!isEnabled()) return;
    const connection = injected.get('connection') as { fetch: { register(route: {
      path: string; methods: readonly string[]; requestBody: 'buffered';
      fetch(request: Request): Promise<Response>;
    }): () => Promise<void> } } | undefined;
    if (!connection) return;
    ctx.effect(() => connection.fetch.register({
      path: BALANCE_PATH, methods: ['GET'], requestBody: 'buffered',
      fetch: async request => {
        const reply = (state: string, balance: unknown = null) => Response.json({ state, balance }, {
          headers: { 'cache-control': 'no-store' },
        });
        if (!isEnabled()) return reply('unconfigured');
        try {
          const key = await readBalanceKey(injected);
          if (!key) return reply('unconfigured');
          const response = await fetch('https://api.deepseek.com/user/balance', {
            headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
            redirect: 'error', signal: AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]),
          });
          if (response.status === 401 || response.status === 403) return reply('unauthorized');
          if (!response.ok) return reply('error');
          const balance = readCnyBalance(await response.json());
          return reply(balance ? 'ready' : 'no-cny', balance);
        } catch {
          // Never forward upstream bodies or exceptions that might contain credentials.
          return reply('error');
        }
      },
    }), 'deepseek: balance route');
  });
}
