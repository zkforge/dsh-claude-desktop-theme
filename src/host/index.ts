import z from '@deepseek-ai/schemastery';
import type { Context } from '@deepseek-ai/cordis';
import {
  DEFAULT_APPEARANCE, DEFAULT_FEATURES, DEFAULT_FONTS, DEFAULT_VIEW, DEFAULT_PERSONALIZATION, FONT_NAME_MAX_LENGTH,
} from '../shared/config.ts';
import { mountStatistics } from './stats/service.ts';
import { mountContextBreakdown } from './context/service.ts';
import { mountDeepSeekBalance } from './balance.ts';

/** Same shapes the client normalizer accepts, so both boundaries agree. */
const HEX_COLOUR = /^(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6})?$/;
const FONT_NAME = new RegExp(`^[\\p{L}\\p{N} ._-]{0,${FONT_NAME_MAX_LENGTH}}$`, 'u');

/**
 * Fields are marked `.volatile()` so the DSH settings layer projects them into
 * a configuration form: only volatile paths are served to the client
 * (`dsh-settings` `volatileForm`/`projectForm`), and the generated form is what
 * the browser half reads through `ctx.configForms.get(entryId)`. Marking them
 * also gives the plugin a real settings surface: the row configuration page
 * registered by the browser half writes these paths back through the same
 * transport, and the Host validates the whole candidate before touching disk.
 *
 * The `pattern` guards are the first of three: the settings boundary rejects an
 * unusable candidate, the configuration page validates before it submits, and
 * `adoptConfig` falls back to the defaults for a hand-edited patch file.
 */
export const Config = z.object({
  enabled: z.boolean().default(false).description('启用 CCD 风格界面').volatile(),
  debug: z.boolean().default(false).description('在控制台输出调试日志').volatile(),
  features: z.object({
    shell: z.boolean().default(DEFAULT_FEATURES.shell),
    sidebar: z.boolean().default(DEFAULT_FEATURES.sidebar),
    'new-session': z.boolean().default(DEFAULT_FEATURES['new-session']),
    conversation: z.boolean().default(DEFAULT_FEATURES.conversation),
    'tool-calls': z.boolean().default(DEFAULT_FEATURES['tool-calls']),
    statistics: z.boolean().default(DEFAULT_FEATURES.statistics),
    'composer-pet': z.boolean().default(DEFAULT_FEATURES['composer-pet']),
    'composer-stats': z.boolean().default(DEFAULT_FEATURES['composer-stats']),
    'context-panel': z.boolean().default(DEFAULT_FEATURES['context-panel']),
    'hero-ripples': z.boolean().default(DEFAULT_FEATURES['hero-ripples']),
  }).default({ ...DEFAULT_FEATURES }).description('按模块启用').volatile(),
  /* One volatile node per section, exactly like `features`: Cordis rejects a
     volatile field nested inside another volatile field ("volatile fields
     require a fixed object path without an enclosing volatile field"), and a
     volatile object already makes its whole subtree editable. */
  appearance: z.object({
    canvas: z.string().default(DEFAULT_APPEARANCE.canvas)
      .description('会话与画布背景色（#rrggbb，留空用内置值）')
      .pattern(HEX_COLOUR),
    sidebar: z.string().default(DEFAULT_APPEARANCE.sidebar)
      .description('侧栏背景色（#rrggbb，留空用内置值）')
      .pattern(HEX_COLOUR),
  }).default({ ...DEFAULT_APPEARANCE }).description('背景色').volatile(),
  fonts: z.object({
    uiLatin: z.string().default(DEFAULT_FONTS.uiLatin)
      .description('界面西文字体名（留空用系统栈）')
      .pattern(FONT_NAME),
    uiCjk: z.string().default(DEFAULT_FONTS.uiCjk)
      .description('界面中文字体名（留空用系统栈）')
      .pattern(FONT_NAME),
    code: z.string().default(DEFAULT_FONTS.code)
      .description('代码与等宽字体名（留空用系统栈）')
      .pattern(FONT_NAME),
  }).default({ ...DEFAULT_FONTS }).description('字体').volatile(),
  personalization: z.object({
    petStyle: z.union(['whale', 'claude']).default(DEFAULT_PERSONALIZATION.petStyle)
      .description('输入框宠物样式'),
    runningStyle: z.union(['whale', 'claude']).default(DEFAULT_PERSONALIZATION.runningStyle)
      .description('聊天输出中的等待图标与状态样式'),
    replySignatureStyle: z.union(['whale', 'claude']).default(DEFAULT_PERSONALIZATION.replySignatureStyle)
      .description('回复结束后的签名图标样式'),
    greetingStyle: z.union(['explore', 'claude']).default(DEFAULT_PERSONALIZATION.greetingStyle)
      .description('首页问候语与图标样式'),
    greetingName: z.string().default('').pattern(/^.{0,64}$/u).description('问候语中的称呼（可留空）'),
  }).default({ ...DEFAULT_PERSONALIZATION }).description('个性化').volatile(),
  view: z.object({
    showModelIcons: z.boolean().default(DEFAULT_VIEW.showModelIcons)
      .description('显示模型选单中的前置图标（默认开启）'),
    showSidebarBrand: z.boolean().default(DEFAULT_VIEW.showSidebarBrand)
      .description('显示侧栏 DeepSeek Harness 品牌条目（默认关闭）'),
    showHeaderSubagents: z.boolean().default(DEFAULT_VIEW.showHeaderSubagents)
      .description('显示顶栏子代理入口（仅控制入口显示）'),
    showHeaderTeam: z.boolean().default(DEFAULT_VIEW.showHeaderTeam)
      .description('显示顶栏团队入口（仅控制入口显示）'),
    groupByStatus: z.boolean().default(DEFAULT_VIEW.groupByStatus)
      .description('按会话状态分组（保留原生项目视图选项）'),
    showEmptyGroups: z.boolean().default(DEFAULT_VIEW.showEmptyGroups)
      .description('显示空分组（关掉时没有会话的工作区不再显示）'),
  }).default({ ...DEFAULT_VIEW }).description('视图选项').volatile(),
});

/**
 * One declared configuration field as the loader hands it over: DSH resolves a
 * plugin's config into reactive cells, so the current value is read through
 * `get()` rather than off the object (the same shape the host's own plugins
 * read, e.g. `this.config.selectedDefault.get()`).
 */
interface ConfigCell<T> {
  get(): T;
}

/** The one Host field this half reads. */
interface HostConfig {
  readonly enabled?: ConfigCell<boolean> | boolean;
}

/** Read one reactive cell, or a plain value if a deployment resolves the config eagerly. */
function readValue<T>(node: ConfigCell<T> | T | undefined, fallback: T): T {
  if (node === undefined) return fallback;
  if (typeof node === 'object' && node !== null && typeof (node as ConfigCell<T>).get === 'function') {
    try {
      return (node as ConfigCell<T>).get();
    } catch {
      return fallback;
    }
  }
  return node as T;
}

/**
 * Host half: the configuration surface the interface reads, plus the read-only
 * session-log fold behind the statistics card.
 *
 * The card's numbers come from a projection unit of the host's own session
 * projection seam (see `stats/unit.ts`) and are served over the host's
 * authenticated fetch registry; nothing is written back to a profile, a
 * session log, or any second state store.
 *
 * Registration follows the plugin switch alone: while the plugin is on, the
 * fold and the route are live, so turning the statistics *feature* on in the
 * settings page shows the card without a restart. Turning the plugin itself
 * off costs the host nothing, because nothing is registered at all.
 *
 * @param ctx - host plugin context.
 * @param config - resolved Host configuration cells (validated by the loader).
 */
export function apply(ctx: Context, config: unknown): void {
  const host = (typeof config === 'object' && config !== null ? config : {}) as HostConfig;
  mountStatistics(ctx, () => readValue(host.enabled, false) === true);
  mountContextBreakdown(ctx, () => readValue(host.enabled, false) === true);
  mountDeepSeekBalance(ctx, () => readValue(host.enabled, false) === true);
}
