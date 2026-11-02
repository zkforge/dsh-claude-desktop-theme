import { useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type { SessionInfoPort } from '../../contracts/session-info.ts';
import type { ContextProjectionRead } from '../../contracts/ports.ts';
import { InfoText } from './InfoText.tsx';
import { useCardDrag } from './useCardDrag.ts';
import {
  barSegments, contextBreakdown, formatPercent, formatTokens, shortenPath, toolLabel,
  type ContextSlice,
} from '../../../shared/context.ts';
import {
  instructionFilePath, readCardPreferences, type SessionCardId, type SessionCardPreferences,
} from '../../../shared/session-info.ts';

/* v2: the default order and open state changed, so older saved layouts are dropped. */
const STORAGE = 'ccd-session-cards-v2';
const COPY = {
  zh: {
    context: '上下文', environment: '环境', usage: '会话用量', waiting: '等待数据', used: (percent: number) => `已使用 ${percent}%`,
    input: '输入 token', output: '输出 token', cache: '缓存命中率', prompts: '提示次数', tps: '输出 TPS',
    local: '工作区', path: '工作目录', branch: 'Git 分支', worktreeLabel: '工作树', worktree: '独立工作树', checkout: '主工作树',
    restart: '需重启 DSH', restartHint: '请完整退出并重新打开 DSH，以加载环境查询接口；仅重载窗口不会更新宿主。',
    detached: '分离 HEAD', noRepo: '非 Git 仓库', unavailable: '暂不可用', retry: '重试', loading: '读取中…',
    estimate: '分类与明细为估算值；总占用与输入框圆环一致',
    reorder: '拖动排序，或使用上下方向键移动卡片',
    rows: { mcp: 'MCP 工具', tools: '系统工具', system: '系统提示词', skills: '技能', memory: '指令文件', messages: '对话消息', autocompact: '自动压缩余量', free: '空闲空间' },
  },
  en: {
    context: 'Context', environment: 'Environment', usage: 'Session usage', waiting: 'Awaiting data', used: (percent: number) => `${percent}% used`,
    input: 'Input tokens', output: 'Output tokens', cache: 'Cache hit rate', prompts: 'Prompts', tps: 'Output TPS',
    local: 'Workspace', path: 'Working directory', branch: 'Git branch', worktreeLabel: 'Worktree', worktree: 'Linked worktree', checkout: 'Main worktree',
    restart: 'Restart DSH', restartHint: 'Quit and reopen DSH to load the environment endpoint; reloading the window does not update the host.',
    detached: 'Detached HEAD', noRepo: 'Not a Git repository', unavailable: 'Unavailable', retry: 'Retry', loading: 'Loading…',
    estimate: 'Categories and details are estimates; total occupancy matches the composer ring',
    reorder: 'Drag to reorder, or use the up and down arrow keys',
    rows: { mcp: 'MCP tools', tools: 'System tools', system: 'System prompt', skills: 'Skills', memory: 'Instruction files', messages: 'Messages', autocompact: 'Autocompact buffer', free: 'Free space' },
  },
} as const;

function readPreferences(): SessionCardPreferences {
  try { return readCardPreferences(JSON.parse(localStorage.getItem(STORAGE) ?? 'null')); }
  catch { return readCardPreferences(null); }
}

function ValueRow({ label, value, hint, tooltip = true, onOpen }: { label: string; value: ReactNode; hint?: string; tooltip?: boolean; onOpen?: () => void }) {
  return <div className="ccd-info-value"><span>{label}</span>{typeof value === 'string' || typeof value === 'number'
    ? tooltip ? <InfoText text={String(value)} {...(hint === undefined ? {} : { hint })} {...(onOpen === undefined ? {} : { onOpen })} /> : <span className="ccd-info-text">{value}</span> : <span>{value}</span>}</div>;
}

const CHEVRON = <svg className="ccd-info-chevron" viewBox="0 0 12 12" aria-hidden="true">
  <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
</svg>;

const ENVIRONMENT_ICONS = {
  local: <><rect x="2" y="2.5" width="12" height="8.5" rx="1.5" /><path d="M8 11v2.5M5.5 13.5h5" /></>,
  path: <path d="M2 4.5c0-.8.7-1.5 1.5-1.5h2.6c.4 0 .8.2 1 .5l.8 1h4.6c.8 0 1.5.7 1.5 1.5v5.5c0 .8-.7 1.5-1.5 1.5h-9C2.7 13 2 12.3 2 11.500Z" />,
  branch: <><circle cx="4.5" cy="3.5" r="1.5" /><circle cx="4.5" cy="12.5" r="1.5" /><circle cx="11.5" cy="5" r="1.5" /><path d="M4.5 5v6M11.5 6.500c0 2.5-7 1.5-7 4" /></>,
  worktree: <><path d="M8 2.5 14 5.5 8 8.5 2 5.500Z" /><path d="m2 8.5 6 3 6-3M2 11 8 14l6-3" /></>,
};

function EnvironmentRow({ icon, label, value, hint = `${label}：${value}`, onOpen }: { icon: keyof typeof ENVIRONMENT_ICONS; label: string; value: string; hint?: string; onOpen?: () => void }) {
  return <div className="ccd-info-environment">
    <svg viewBox="0 0 16 16" role="img" aria-label={label} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">{ENVIRONMENT_ICONS[icon]}</svg>
    <InfoText text={value} hint={hint} {...(onOpen === undefined ? {} : { onOpen })} />
  </div>;
}

/** Largest share first, as the reference lists them; the reserved rows stay last. */
function byShare(slices: readonly ContextSlice[]): readonly ContextSlice[] {
  const reserved = (slice: ContextSlice) => slice.key === 'autocompact' || slice.key === 'free';
  return [...slices.filter(slice => !reserved(slice)).sort((a, b) => b.tokens - a.tokens), ...slices.filter(reserved)];
}

/** Shares the popup's pure pricing and bar functions, with a narrow persistent layout. */
function ContextReading({ source, zh, opener }: { source: ContextProjectionRead | null; zh: boolean; opener: (group: string, name: string) => (() => void) | null }) {
  const copy = zh ? COPY.zh : COPY.en;
  if (source === null) return <p className="ccd-info-empty">{copy.waiting}</p>;
  const extra = source.breakdown;
  const breakdown = contextBreakdown({
    ...source, tools: extra?.tools ?? [], skillTokens: extra?.skillTokens ?? 0,
    fileTokens: extra?.fileTokens ?? 0, compaction: extra?.compaction ?? null,
  });
  const bar = barSegments(breakdown, 264);
  const groups = [
    { key: 'mcp', rows: extra?.tools.filter(([name]) => name.startsWith('mcp__')) ?? [] },
    { key: 'tools', rows: extra?.tools.filter(([name]) => !name.startsWith('mcp__')) ?? [] },
    { key: 'skills', rows: extra?.skills ?? [] },
    { key: 'memory', rows: extra?.files ?? [] },
  ] as const;
  return <>
    <div className="ccd-info-headline"><span>{copy.used(breakdown.percent)}</span><span>{formatTokens(breakdown.used)} / {formatTokens(breakdown.window)}</span></div>
    <div className="ccd-info-bar" aria-hidden="true">
      {byShare(bar.drawn).map(slice => <i key={slice.key} data-slice={slice.key} style={{ flexGrow: slice.tokens }} />)}
      <i data-slice="free" style={{ flexGrow: bar.free }} />
    </div>
    <div title={copy.estimate}>
      {byShare(breakdown.slices).map(slice => <div className="ccd-info-context-row" key={slice.key}>
        <span><i data-slice={slice.key} />{copy.rows[slice.key]}</span>
        <span>{formatTokens(slice.tokens)}</span><span>{formatPercent(slice.tokens, breakdown.window)}</span>
      </div>)}
    </div>
    {groups.filter(group => group.rows.length > 0).map(group => <details className="ccd-info-group" key={group.key}>
      <summary>{CHEVRON}<span>{copy.rows[group.key]}</span><span>{group.rows.length}</span></summary>
      <div className="ccd-info-details">
        {group.rows.map(([name, tokens]) => {
          const label = shortenPath(toolLabel(name), 30);
          const open = opener(group.key, name);
          return <div className="ccd-info-value" key={name} title={name}>
            <span>{open === null ? label : <button type="button" className="ccd-info-link" onClick={open}>{label}</button>}</span><span>{formatTokens(tokens)}</span>
          </div>;
        })}
      </div>
    </details>)}
  </>;
}

export function SessionCards({ port, contextEnabled }: { port: SessionInfoPort; contextEnabled: boolean }) {
  const state = useSyncExternalStore(port.subscribe, port.getSnapshot, port.getSnapshot);
  const [preferences, setPreferences] = useState(readPreferences);
  const copy = state.zh ? COPY.zh : COPY.en;
  const update = (next: SessionCardPreferences) => {
    setPreferences(next);
    try { localStorage.setItem(STORAGE, JSON.stringify(next)); } catch { /* Read-only storage keeps in-memory preferences. */ }
  };
  const move = (id: SessionCardId, target: SessionCardId) => {
    if (id === target) return;
    const order = preferences.order.filter(item => item !== id);
    order.splice(preferences.order.indexOf(target), 0, id);
    update({ ...preferences, order });
  };
  const drag = useCardDrag(state.session, state.visible, ids => update({
    ...preferences, order: [...ids, ...preferences.order.filter(id => !ids.includes(id))],
  }));
  if (!state.visible) return null;
  const metric = (value: number | null) => value === null ? '—' : formatTokens(value);
  const environment = state.environment;
  const cwd = environment?.cwd ?? state.cwd;
  const branch = state.environmentState === 'restart' ? copy.restart : state.environmentState === 'loading' ? copy.loading : environment?.git === 'not-repo' ? copy.noRepo
    : environment?.git === 'ready' ? `${environment.branch ?? '—'}${environment.detached ? ` (${copy.detached})` : ''}` : copy.unavailable;
  const summaries: Record<SessionCardId, string> = {
    context: state.context === null ? '—' : `${Math.min(100, Math.round(state.context.used / state.context.window * 100))}%`,
    environment: state.workspace || cwd.split(/[\\/]/u).filter(Boolean).at(-1) || '—',
    usage: state.metrics.tps === null ? '—' : `${state.metrics.tps.toFixed(1)} tok/s`,
  };
  const opener = (group: string, name: string) => {
    if (group === 'skills') return () => port.openSkill(name);
    if (group !== 'memory') return null;
    const path = instructionFilePath(name, cwd, environment?.homes ?? {});
    return path === null ? null : () => port.openFile(path);
  };
  const contents: Record<SessionCardId, ReactNode> = {
    context: <ContextReading key={state.session} source={state.context} zh={state.zh} opener={opener} />,
    environment: <>
      <EnvironmentRow icon="local" label={copy.local} value={state.workspace || '—'} />
      <EnvironmentRow icon="path" label={copy.path} value={cwd || '—'} {...(cwd === '' ? {} : { onOpen: port.openFilesView })} />
      <EnvironmentRow icon="branch" label={copy.branch} value={branch} {...(state.environmentState === 'restart' ? { hint: copy.restartHint } : {})} />
      {environment?.worktree !== null && environment?.worktree !== undefined
        && <EnvironmentRow icon="worktree" label={copy.worktreeLabel} value={environment.worktree ? copy.worktree : copy.checkout} hint={`${environment.worktree ? copy.worktree : copy.checkout}：${cwd}`} />}
      {(state.environmentState === 'error' || environment?.git === 'error')
        && <button type="button" className="ccd-info-retry" onClick={() => port.retry()}>{copy.retry}</button>}
    </>,
    usage: <>
      <ValueRow label={copy.input} value={metric(state.metrics.input)} tooltip={false} />
      <ValueRow label={copy.output} value={metric(state.metrics.output)} tooltip={false} />
      <ValueRow label={copy.cache} value={state.metrics.cacheHit === null ? '—' : `${(state.metrics.cacheHit * 100).toFixed(1)}%`} tooltip={false} />
      <ValueRow label={copy.prompts} value={state.metrics.prompts === null ? '—' : state.metrics.prompts.toLocaleString(state.zh ? 'zh-CN' : 'en-US')} tooltip={false} />
      <ValueRow label={copy.tps} value={summaries.usage} tooltip={false} />
    </>,
  };
  return <aside className="ccd-session-cards" data-ccd-session-cards="" aria-label={state.zh ? '会话信息' : 'Session information'}
    style={{ left: state.left, top: state.top, maxHeight: state.height }} onClickCapture={drag.onClickCapture} onDragStart={event => event.preventDefault()}>
    {preferences.order.filter(id => contextEnabled || id !== 'context').map(id => {
      const collapsed = preferences.collapsed.includes(id);
      return <section className="ccd-info-card" key={id} data-ccd-info-card={id} onPointerDown={event => drag.onPointerDown(event, id)}>
        <div className="ccd-info-header">
          <button type="button" className="ccd-info-toggle" aria-expanded={!collapsed} aria-controls={`ccd-info-${id}`}
            onClick={() => update({ ...preferences, collapsed: collapsed ? preferences.collapsed.filter(item => item !== id) : [...preferences.collapsed, id] })}>
            <span data-open={!collapsed}>{copy[id]}{CHEVRON}</span>
            {collapsed && <span className="ccd-info-summary" title={id === 'usage' ? undefined : summaries[id]}>{summaries[id]}</span>}
          </button>
          <button type="button" className="ccd-info-grip" aria-label={`${copy[id]}: ${copy.reorder}`} onKeyDown={event => {
              if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
              event.preventDefault();
              const visible = preferences.order.filter(item => contextEnabled || item !== 'context');
              const target = visible[visible.indexOf(id) + (event.key === 'ArrowUp' ? -1 : 1)];
              if (target !== undefined) move(id, target);
            }}>⠿</button>
        </div>
        {!collapsed && <div className="ccd-info-content" id={`ccd-info-${id}`}>{contents[id]}</div>}
      </section>;
    })}
  </aside>;
}
