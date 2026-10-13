/**
 * New-session statistics card, rebuilt as plain DOM.
 *
 * The reference panel (Claude Desktop's Code tab) is a 480px card: a header
 * with two segmented controls (`Overview`/`Models`, `All`/`30d`/`7d`), then
 * either a 3×2 grid of stat tiles with a 26×7 contribution heatmap and one
 * footer sentence, or the `Models` view's stacked daily bar chart and its
 * legend. It is drawn imperatively because the card lives in its own container
 * next to the host's greeting, not in a slot the host renders — so there is no
 * React root to render into and no shared-library dependency to declare.
 *
 * Geometry and colour come from the reference, measured against its own
 * Tailwind classes and the @2x screenshots (see theme/tokens.css): a
 * 20px segmented control with 6px padding, a 160px chart whose bars are 72% of
 * their day column, an 8px legend swatch, and a dark tooltip placed 4px above
 * its anchor. Everything visible is a theme variable (see
 * `theme/tokens.css`).
 */
import type { StatsRangeId } from '../../../shared/stats.ts';
import { formatCount, formatDayLabel, formatTokens } from './format.ts';

/** Marks the card container; the compatibility layer positions it. */
export const CARD_ATTRIBUTE = 'data-ccd-stats-card';

/** Heatmap columns and rows. 26×7 = 182 days, as the reference draws it. */
export const HEAT_COLUMNS = 26;
export const HEAT_ROWS = 7;

/** Legend rows the reference shows before it offers "Show N more". */
export const LEGEND_LIMIT = 6;

/** Distance the reference leaves between an anchor and its tooltip. */
export const TIP_OFFSET_PX = 4;

/** Gap the chart's x-axis labels keep from each other when they are thinned. */
export const CHART_LABEL_GAP_PX = 8;

/** The card's two views. */
export type StatsTabId = 'overview' | 'models';

/** One segmented-control choice. */
export interface StatsOption<T extends string> {
  readonly id: T;
  readonly label: string;
}

/** One stat tile: a footnote label above a semibold value. */
export interface StatsTile {
  readonly label: string;
  readonly value: string;
  /** The reference prints `Favorite model` one size down; long ids need it. */
  readonly small?: boolean;
}

/** One heatmap cell: a day with its count, or a future cell left blank. */
export interface HeatCell {
  readonly date: string;
  readonly count: number;
  /** 0 = no activity, 1-4 = the reference's four steps, null = after today. */
  readonly level: number | null;
}

/** One model's slice of one chart bar. */
export interface ChartSegment {
  readonly model: string;
  readonly tokens: number;
  /** Theme variable holding this model's colour. */
  readonly color: string;
}

/** One bar: a day with tokens, its slices, and the tooltip it opens. */
export interface ChartDay {
  readonly date: string;
  readonly label: string;
  readonly tokens: number;
  readonly segments: readonly ChartSegment[];
}

/** One legend row, exactly as the reference composes it. */
export interface LegendRow {
  readonly model: string;
  readonly color: string;
  /** `40.4M in · 3.6M out`, from the lifetime counters. */
  readonly usage: string;
  /** Share of the range's tokens, one decimal place. */
  readonly percent: string;
}

/** Everything the `Overview` view draws. */
export interface StatsOverviewData {
  readonly tiles: readonly StatsTile[];
  /** One level per cell, column-major: `column * 7 + row`, Sunday first. */
  readonly heat: readonly HeatCell[];
  /** First index drawn after today; those cells stay transparent. */
  readonly futureFrom: number;
  /** Footer sentence, or null when the reference would draw none. */
  readonly note: string | null;
}

/** Everything the `Models` view draws. */
export interface StatsModelsData {
  /** Axis labels, lowest first; empty when the range saw no tokens. */
  readonly ticks: readonly string[];
  /** Top of the axis; bar heights are a share of it. */
  readonly top: number;
  /** One bar per day with usage in the range, oldest first. */
  readonly days: readonly ChartDay[];
  readonly legend: readonly LegendRow[];
  /** Legend rows past {@link LEGEND_LIMIT}, behind "Show N more". */
  readonly moreCount: number;
}

/** Everything the card needs to draw itself. */
export interface StatsCardData {
  readonly tab: StatsTabId;
  readonly tabs: readonly StatsOption<StatsTabId>[];
  readonly ranges: readonly StatsOption<StatsRangeId>[];
  readonly range: StatsRangeId;
  /** Present when {@link tab} is `overview`. */
  readonly overview: StatsOverviewData | null;
  /** Present when {@link tab} is `models`. */
  readonly models: StatsModelsData | null;
}

/** What the card reports back to its owner. */
export interface StatsCardHandlers {
  readonly onTab: (id: StatsTabId) => void;
  readonly onRange: (id: StatsRangeId) => void;
}

/** The mounted card. */
export interface StatsCard {
  readonly element: HTMLElement;
  /** Fit the chart's x-axis labels to the card's current width. */
  layout(): void;
}

/** Tooltip content: one title line and optional coloured rows. */
interface Tip {
  readonly title: string;
  readonly rows: readonly { readonly color: string; readonly text: string }[];
}

/**
 * Level for one day: `ceil(day / busiest day * 4)` clamped to 0-4, which is the
 * reference's own rule (`L = 80 - ceil(ratio * 4) * 8`).
 *
 * @param value - that day's count.
 * @param peak - the busiest day in the window.
 */
export function heatLevel(value: number, peak: number): number {
  if (value <= 0 || peak <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((value / peak) * 4)));
}

/**
 * The heatmap's tooltip line, exactly the reference's copy: `Sep 30 — 1,387`.
 *
 * @param date - local day key.
 * @param count - that day's count.
 * @returns the line the tooltip shows.
 */
export function heatTip(date: string, count: number): string {
  return `${formatDayLabel(date)} \u2014 ${formatCount(count)}`;
}

/** One segmented control: buttons in a labelled group, the active one pilled. */
function createSegments<T extends string>(
  document: Document,
  label: string,
  options: readonly StatsOption<T>[],
  active: T,
  onSelect: (id: T) => void,
): HTMLElement {
  const group = document.createElement('div');
  group.className = 'ccd-stats-seg';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', label);
  for (const option of options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ccd-stats-seg-btn';
    button.textContent = option.label;
    button.dataset['option'] = option.id;
    if (option.id === active) button.dataset['active'] = 'true';
    button.setAttribute('aria-pressed', String(option.id === active));
    button.addEventListener('click', () => onSelect(option.id));
    group.append(button);
  }
  return group;
}

/** The `Overview` body: tiles, heatmap and the footer sentence. */
function createOverview(document: Document, data: StatsOverviewData, tips: Map<HTMLElement, Tip>): HTMLElement {
  const body = document.createElement('div');
  body.className = 'ccd-stats-overview';

  const tiles = document.createElement('div');
  tiles.className = 'ccd-stats-tiles';
  for (const tile of data.tiles) {
    const cell = document.createElement('div');
    cell.className = 'ccd-stats-tile';
    const label = document.createElement('span');
    label.className = 'ccd-stats-label';
    label.textContent = tile.label;
    label.title = tile.label;
    const value = document.createElement('span');
    value.className = tile.small === true ? 'ccd-stats-value ccd-stats-value-small' : 'ccd-stats-value';
    value.textContent = tile.value;
    value.title = tile.value;
    cell.append(label, value);
    tiles.append(cell);
  }

  const heat = document.createElement('div');
  heat.className = 'ccd-stats-heat';
  heat.setAttribute('role', 'img');
  heat.setAttribute('aria-label', '每日活跃热力图');
  for (let column = 0; column < HEAT_COLUMNS; column += 1) {
    const col = document.createElement('div');
    col.className = 'ccd-stats-heat-col';
    for (let row = 0; row < HEAT_ROWS; row += 1) {
      const index = column * HEAT_ROWS + row;
      const cell = document.createElement('span');
      cell.className = 'ccd-stats-heat-cell';
      const entry = data.heat[index];
      cell.dataset.level = entry === undefined || entry.level === null ? 'future' : String(entry.level);
      if (entry !== undefined && entry.level !== null) {
        tips.set(cell, { title: heatTip(entry.date, entry.count), rows: [] });
      }
      col.append(cell);
    }
    heat.append(col);
  }

  body.append(tiles, heat);
  if (data.note !== null) {
    const note = document.createElement('p');
    note.className = 'ccd-stats-note';
    note.textContent = data.note;
    body.append(note);
  }
  return body;
}

/** The `Models` body: the stacked bar chart and its legend. */
function createModels(document: Document, data: StatsModelsData, tips: Map<HTMLElement, Tip>): HTMLElement {
  const body = document.createElement('div');
  body.className = 'ccd-stats-models';

  const chart = document.createElement('div');
  chart.className = 'ccd-stats-chart';
  chart.setAttribute('role', 'img');
  chart.setAttribute('aria-label', '各模型每日 Token 用量');

  const axis = document.createElement('div');
  axis.className = 'ccd-stats-chart-y';
  axis.setAttribute('aria-hidden', 'true');
  for (const tick of data.ticks) {
    const label = document.createElement('span');
    label.className = 'ccd-stats-tick';
    label.textContent = tick;
    axis.append(label);
  }

  const plot = document.createElement('div');
  plot.className = 'ccd-stats-chart-plot';
  for (const day of data.days) {
    const column = document.createElement('div');
    column.className = 'ccd-stats-chart-day';
    for (const segment of day.segments) {
      const bar = document.createElement('div');
      bar.className = 'ccd-stats-bar';
      bar.style.height = `${data.top > 0 ? (segment.tokens / data.top) * 100 : 0}%`;
      bar.style.background = segment.color;
      column.append(bar);
    }
    tips.set(column, {
      title: formatDayLabel(day.date),
      rows: day.segments.map(segment => ({
        color: segment.color,
        text: `${segment.model}: ${formatTokens(segment.tokens)}`,
      })),
    });
    plot.append(column);
  }

  const labels = document.createElement('div');
  labels.className = 'ccd-stats-chart-x';
  labels.setAttribute('aria-hidden', 'true');
  /* A zero-width copy of one label: the reference measures it to decide how
     many labels fit, instead of guessing at a width. */
  const sample = document.createElement('span');
  sample.className = 'ccd-stats-sample';
  const sampleText = document.createElement('span');
  sampleText.className = 'ccd-stats-sample-text';
  sampleText.textContent = data.days[0]?.label ?? '';
  sample.append(sampleText);
  labels.append(sample);
  data.days.forEach((day, index) => {
    const label = document.createElement('span');
    label.className = 'ccd-stats-chart-label';
    label.dataset['index'] = String(index);
    label.textContent = day.label;
    labels.append(label);
  });

  chart.append(axis, plot, labels);

  const legend = document.createElement('div');
  legend.className = 'ccd-stats-legend';
  if (data.legend.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'ccd-stats-empty';
    empty.textContent = '此时间范围内暂无模型用量';
    legend.append(empty);
  }
  data.legend.forEach((row, index) => {
    const line = document.createElement('div');
    line.className = 'ccd-stats-legend-row';
    if (index >= LEGEND_LIMIT) line.hidden = true;
    const swatch = document.createElement('span');
    swatch.className = 'ccd-stats-swatch';
    swatch.style.background = row.color;
    swatch.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span');
    name.className = 'ccd-stats-legend-name';
    name.textContent = row.model;
    name.title = row.model;
    const usage = document.createElement('span');
    usage.className = 'ccd-stats-legend-usage';
    usage.textContent = row.usage;
    const percent = document.createElement('span');
    percent.className = 'ccd-stats-legend-percent';
    percent.textContent = row.percent;
    line.append(swatch, name, usage, percent);
    legend.append(line);
  });
  if (data.moreCount > 0) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'ccd-stats-more';
    more.textContent = `展开其余 ${String(data.moreCount)} 个模型`;
    more.setAttribute('aria-expanded', 'false');
    more.addEventListener('click', () => {
      const expanded = more.getAttribute('aria-expanded') === 'true';
      const next = !expanded;
      more.setAttribute('aria-expanded', String(next));
      more.textContent = next ? '收起' : `展开其余 ${String(data.moreCount)} 个模型`;
      for (const [index, row] of [...legend.querySelectorAll<HTMLElement>('.ccd-stats-legend-row')].entries()) {
        row.hidden = !next && index >= LEGEND_LIMIT;
      }
    });
    legend.append(more);
  }

  body.append(chart, legend);
  return body;
}

/**
 * Build the card.
 *
 * @param document - renderer document the card belongs to.
 * @param data - header state plus the active view's content.
 * @param handlers - tab and range selections.
 * @returns the detached card and its layout hook.
 */
export function createStatsCard(
  document: Document,
  data: StatsCardData,
  handlers: StatsCardHandlers,
): StatsCard {
  const card = document.createElement('div');
  card.setAttribute(CARD_ATTRIBUTE, 'true');

  const header = document.createElement('div');
  header.className = 'ccd-stats-header';
  const tabs = createSegments(document, '统计视图', data.tabs, data.tab, handlers.onTab);
  const spacer = document.createElement('span');
  spacer.className = 'ccd-stats-spacer';
  const ranges = createSegments(document, '时间范围', data.ranges, data.range, handlers.onRange);
  header.append(tabs, spacer, ranges);

  const body = document.createElement('div');
  body.className = 'ccd-stats-body';
  const tips = new Map<HTMLElement, Tip>();
  if (data.tab === 'models' && data.models !== null) body.append(createModels(document, data.models, tips));
  else if (data.overview !== null) body.append(createOverview(document, data.overview, tips));

  const tooltip = document.createElement('div');
  tooltip.className = 'ccd-stats-tooltip';
  tooltip.dataset['open'] = 'false';
  tooltip.setAttribute('role', 'tooltip');

  card.append(header, body, tooltip);

  /** Show the tooltip for one anchor. */
  const show = (anchor: HTMLElement, tip: Tip): void => {
    tooltip.replaceChildren();
    const title = document.createElement('span');
    title.className = 'ccd-stats-tip-title';
    title.textContent = tip.title;
    tooltip.append(title);
    for (const row of tip.rows) {
      const line = document.createElement('span');
      line.className = 'ccd-stats-tip-row';
      const dot = document.createElement('span');
      dot.className = 'ccd-stats-tip-dot';
      dot.style.background = row.color;
      const text = document.createElement('span');
      text.textContent = row.text;
      line.append(dot, text);
      tooltip.append(line);
    }
    tooltip.dataset['open'] = 'true';
    const cardRect = card.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    const width = tooltip.offsetWidth;
    const height = tooltip.offsetHeight;
    const center = anchorRect.left - cardRect.left + anchorRect.width / 2;
    const left = Math.min(
      Math.max(center - width / 2, TIP_OFFSET_PX - cardRect.left),
      window.innerWidth - width - TIP_OFFSET_PX - cardRect.left,
    );
    /* The reference's popup avoids collisions with the window, not with the
       card, so it hangs above its anchor whenever the window has room — even
       when that leaves the card's own bounds. */
    const above = anchorRect.top - height - TIP_OFFSET_PX;
    const top = above >= TIP_OFFSET_PX
      ? anchorRect.top - cardRect.top - height - TIP_OFFSET_PX
      : anchorRect.bottom - cardRect.top + TIP_OFFSET_PX;
    tooltip.style.left = `${String(Math.round(left))}px`;
    tooltip.style.top = `${String(Math.round(top))}px`;
  };

  const hide = (): void => {
    tooltip.dataset['open'] = 'false';
  };

  card.addEventListener('pointerover', event => {
    if (event.pointerType === 'touch') return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    let node: Element | null = target;
    while (node !== null && node !== card) {
      if (node instanceof HTMLElement) {
        const tip = tips.get(node);
        if (tip !== undefined) {
          show(node, tip);
          return;
        }
      }
      node = node.parentElement;
    }
    hide();
  });
  card.addEventListener('pointerleave', hide);
  card.addEventListener('pointerdown', hide);

  /** Thin the x-axis labels so they never collide. */
  const layout = (): void => {
    const chart = card.querySelector<HTMLElement>('.ccd-stats-chart');
    const plot = card.querySelector<HTMLElement>('.ccd-stats-chart-plot');
    const sample = card.querySelector<HTMLElement>('.ccd-stats-sample-text');
    if (chart === null || plot === null || sample === null) return;
    const labels = [...card.querySelectorAll<HTMLElement>('.ccd-stats-chart-label')];
    if (labels.length === 0) return;
    const room = plot.getBoundingClientRect().width;
    const step = sample.getBoundingClientRect().width + CHART_LABEL_GAP_PX;
    const fits = step > 0 ? Math.floor(room / step) : labels.length;
    const every = Math.max(1, Math.ceil(labels.length / Math.max(2, fits)));
    labels.forEach((label, index) => {
      label.hidden = index % every !== 0;
    });
  };

  return { element: card, layout };
}
