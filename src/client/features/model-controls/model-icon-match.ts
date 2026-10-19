import { MODEL_ICONS } from './model-icon-data.ts';
import type { ModelIconMark } from './model-icon-data.ts';

export interface ModelIconTarget {
  readonly id: string;
  readonly name: string;
}

export interface ModelIconMatch {
  readonly slug: string;
  readonly mark: ModelIconMark;
}

interface Alias {
  readonly slug: string;
  readonly text: string;
  readonly compact: string;
  readonly explicit: boolean;
}

/*
 * Model families are not always named after the company that serves them.
 * The routing directory can put several brands under one provider (for
 * example Magpie), so these aliases are matched against the model row first
 * and the provider only when the row itself names no known family.
 *
 * The icon package also supplies a slug and a title for every mark; those are
 * added automatically below, so a provider or model that uses the upstream
 * name still gets its icon without another hand-written entry.
 */
const EXPLICIT_ALIASES: Readonly<Record<string, readonly string[]>> = {
  ai21: ['ai21', 'jamba'],
  alibaba: ['alibaba', 'wan'],
  anthropic: ['anthropic'],
  aws: ['aws', 'amazon'],
  azure: ['azure', 'microsoft azure'],
  azureai: ['azure ai', 'azureai'],
  baichuan: ['baichuan'],
  baidu: ['baidu'],
  bytedance: ['bytedance', 'seed', 'seedance', 'seedream'],
  claude: ['claude', 'anthropic claude', 'sonnet', 'opus', 'haiku'],
  claudecode: ['claude code'],
  cohere: ['cohere', 'command r', 'command a', 'aya'],
  codex: ['codex'],
  cogvideo: ['cogvideo', 'cog video'],
  cogview: ['cogview', 'cog view'],
  copilot: ['microsoft copilot', 'copilot'],
  dalle: ['dalle', 'dall e', 'openai dalle', 'openai dall e'],
  deepseek: ['deepseek', 'deep seek'],
  doubao: ['doubao', 'bytedance doubao'],
  flux: ['flux'],
  gemini: ['gemini', 'bard', 'learnlm', 'google gemini'],
  gemma: ['gemma'],
  githubcopilot: ['github copilot'],
  google: ['google'],
  googlecloud: ['google cloud'],
  grok: ['grok', 'xai grok', 'x ai grok'],
  hailuo: ['hailuo', 'minimax hailuo'],
  hedra: ['hedra'],
  hunyuan: ['hunyuan', 'tencent hunyuan', 'hy3', '混元'],
  ideogram: ['ideogram'],
  jimeng: ['jimeng'],
  kimi: ['kimi', 'moonshot kimi', 'moonshot ai kimi'],
  kling: ['kling'],
  kolors: ['kolors'],
  longcat: ['longcat', 'long cat'],
  luma: ['luma'],
  meta: ['llama', 'meta', 'meta ai'],
  microsoft: ['microsoft'],
  midjourney: ['midjourney'],
  minimax: ['minimax', 'mini max'],
  mistral: ['mistral', 'mixtral', 'codestral', 'pixtral', 'devstral', 'magistral'],
  moonshot: ['moonshot', 'moonshot ai'],
  nanobanana: ['nano banana'],
  nvidia: ['nvidia', 'nemotron'],
  openai: ['openai', 'open ai', 'gpt', 'chatgpt', 'o1', 'o3', 'o4', 'davinci', 'whisper'],
  palm: ['palm'],
  pika: ['pika'],
  qwen: ['qwen', 'tongyi', 'dashscope', 'qwq', 'qvq', 'alibaba qwen'],
  recraft: ['recraft'],
  reka: ['reka'],
  runway: ['runway'],
  sora: ['sora', 'openai sora'],
  spark: ['spark', 'iflytek', 'i flytek'],
  stability: ['stability', 'stable diffusion', 'sdxl'],
  stepfun: ['stepfun', 'step fun', 'step'],
  tiangong: ['tiangong'],
  tii: ['falcon'],
  vidu: ['vidu'],
  volcengine: ['volcengine'],
  wenxin: ['wenxin', 'ernie', 'ernie bot'],
  xai: ['xai', 'x ai'],
  xiaomimimo: ['xiaomimimo', 'xiaomi mimo', 'xiaomi mi mo', 'mimo', 'mi mo'],
  xuanyuan: ['xuanyuan', '轩辕'],
  yi: ['yi', '01 ai', '01ai', 'zero one', 'zeroone'],
  zhipu: ['zhipu', 'zhipu ai', 'chatglm', 'chat glm', 'glm', 'bigmodel', 'big model'],
};

/* A routing service identifies how a model is served, not which model it is. */
const ROUTING_SLUGS = new Set(['openrouter']);

function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/gu, '$1 $2')
    .replace(/([A-Za-z]{2,})(\d)/gu, '$1 $2')
    .replaceAll('&', ' and ')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ');
}

function addAlias(aliases: Alias[], seen: Set<string>, slug: string, value: string, explicit: boolean): void {
  const text = normalize(value);
  if (text === '') return;
  const compact = text.replaceAll(' ', '');
  const key = `${slug}\u0000${text}\u0000${explicit ? 'explicit' : 'auto'}`;
  if (seen.has(key)) return;
  seen.add(key);
  aliases.push({ slug, text, compact, explicit });
}

function buildAliases(): readonly Alias[] {
  const aliases: Alias[] = [];
  const seen = new Set<string>();
  for (const [slug, mark] of Object.entries(MODEL_ICONS)) {
    addAlias(aliases, seen, slug, slug, false);
    addAlias(aliases, seen, slug, mark.title, false);
  }
  for (const [slug, values] of Object.entries(EXPLICIT_ALIASES)) {
    if (MODEL_ICONS[slug] === undefined) continue;
    for (const value of values) addAlias(aliases, seen, slug, value, true);
  }
  return aliases.sort((left, right) => right.compact.length - left.compact.length
    || Number(right.explicit) - Number(left.explicit)
    || left.slug.localeCompare(right.slug));
}

const ALIASES = buildAliases();

/** True when `phrase` occupies whole normalized tokens, never a substring. */
function hasPhrase(text: string, phrase: string): boolean {
  let index = text.indexOf(phrase);
  while (index >= 0) {
    const before = index === 0 || text[index - 1] === ' ';
    const after = index + phrase.length === text.length || text[index + phrase.length] === ' ';
    if (before && after) return true;
    index = text.indexOf(phrase, index + 1);
  }
  return false;
}

function matches(text: string, compact: string, alias: Alias): boolean {
  if (hasPhrase(text, alias.text)) return true;
  if (compact === alias.compact) return true;
  /*
   * Camel-case names such as `DeepSeekV3` normalize to `deep seek v3`, while
   * the brand alias is `deepseek`. A long explicit alias can still appear as
   * a compact prefix or suffix; the five-character floor keeps short aliases
   * such as `step` from matching words like `stepper`.
   */
  return alias.explicit && alias.compact.length >= 5 && compact.includes(alias.compact);
}

function matchText(value: string, excludeRouting = false): Alias | null {
  const text = normalize(value);
  if (text === '') return null;
  const compact = text.replaceAll(' ', '');
  return ALIASES.find(alias => (!excludeRouting || !ROUTING_SLUGS.has(alias.slug))
    && matches(text, compact, alias)) ?? null;
}

/**
 * Resolve one row's mark, preferring the model over its routing group.
 *
 * The provider is a fallback because a group such as `Magpie` can carry
 * several brands; matching the group first made every row in it share one
 * initial. The model row is the closest statement of which family a route
 * actually serves.
 */
export function resolveModelIcon(provider: ModelIconTarget, model: ModelIconTarget): ModelIconMatch | null {
  /* Prefer a real model family in the row name/id over a routing service. */
  const modelFamily = matchText(model.name, true)
    ?? matchText(model.id, true)
    ?? matchText(`${model.id} ${model.name}`, true);
  const found = modelFamily
    ?? matchText(`${model.id} ${model.name}`)
    ?? matchText(`${provider.id} ${provider.name}`);
  if (found === null) return null;
  const mark = MODEL_ICONS[found.slug];
  return mark === undefined ? null : { slug: found.slug, mark };
}

/** The fallback seat: the model's own initial, not its routing group's. */
export function modelIconInitial(provider: ModelIconTarget, model: ModelIconTarget): string {
  return (model.name.trim() || provider.name.trim()).charAt(0).toUpperCase() || '·';
}
