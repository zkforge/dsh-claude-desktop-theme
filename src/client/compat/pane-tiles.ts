/** Stateful two-column tiling. Closing a view keeps its neighbours in place;
 * each column has its own row sizes, as in the Claude sidebar recording. */
export interface PaneRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PaneColumn {
  readonly ids: readonly string[];
  readonly sizes: readonly number[];
}

/** Session-owned membership and proportions, independent of DOM mount order. */
export interface PaneLayout {
  readonly columns: readonly PaneColumn[];
  readonly column: number;
}

export interface PaneSeam {
  readonly axis: 'row' | 'column';
  readonly column: number;
  readonly index: number;
  readonly rect: PaneRect;
}

export interface PaneTiles {
  readonly rects: ReadonlyMap<string, PaneRect>;
  readonly seams: readonly PaneSeam[];
}

export const MIN_SHARE = 0.15;
export const EMPTY_LAYOUT: PaneLayout = { columns: [], column: 0.5 };

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

/** Remove only the departed leaves, giving their space to the next neighbour. */
function keepColumn(column: PaneColumn, live: ReadonlySet<string>): PaneColumn {
  const ids = [...column.ids];
  const sizes = [...column.sizes];
  for (let index = ids.length - 1; index >= 0; index--) {
    if (live.has(ids[index]!)) continue;
    const removed = sizes.splice(index, 1)[0] ?? 0;
    ids.splice(index, 1);
    if (sizes.length > 0) {
      const next = Math.min(index, sizes.length - 1);
      sizes[next] = (sizes[next] ?? 0) + removed;
    }
  }
  return { ids, sizes };
}

/** First two views stack; the third starts a second column. Further views split
 * the roomiest cell in the less populated column. Existing cells stay put. */
export function reconcilePanes(layout: PaneLayout, liveIds: readonly string[]): PaneLayout {
  const live = new Set(liveIds);
  const columns = layout.columns.map(column => keepColumn(column, live)).filter(column => column.ids.length > 0);
  const held = new Set(columns.flatMap(column => column.ids));
  for (const id of liveIds) {
    if (held.has(id)) continue;
    held.add(id);
    if (columns.length === 0 || (columns.length === 1 && columns[0]!.ids.length >= 2)) {
      columns.push({ ids: [id], sizes: [1] });
      continue;
    }
    const index = columns.length === 1 || columns[0]!.ids.length <= columns[1]!.ids.length ? 0 : 1;
    const column = columns[index]!;
    const largest = column.sizes.indexOf(Math.max(...column.sizes));
    const ids = [...column.ids];
    const sizes = [...column.sizes];
    const share = (sizes[largest] ?? 1) / 2;
    ids.splice(largest + 1, 0, id);
    sizes.splice(largest, 1, share, share);
    columns[index] = { ids, sizes };
  }
  return { columns, column: layout.column };
}

/** Rectangles fill the card edge to edge, with gaps only between neighbours. */
export function tilePanes(area: PaneRect, layout: PaneLayout, gap: number): PaneTiles {
  const rects = new Map<string, PaneRect>();
  const seams: PaneSeam[] = [];
  const count = layout.columns.length;
  const usableWidth = Math.max(0, area.width - gap * (count - 1));
  const share = clamp(layout.column, MIN_SHARE, 1 - MIN_SHARE);
  let left = area.x;
  layout.columns.forEach((column, columnIndex) => {
    const width = count === 1 ? area.width : usableWidth * (columnIndex === 0 ? share : 1 - share);
    const usableHeight = Math.max(0, area.height - gap * (column.ids.length - 1));
    let top = area.y;
    column.ids.forEach((id, index) => {
      const height = usableHeight * (column.sizes[index] ?? 0);
      rects.set(id, { x: left, y: top, width, height });
      top += height;
      if (index < column.ids.length - 1) {
        seams.push({ axis: 'row', column: columnIndex, index, rect: { x: left, y: top, width, height: gap } });
        top += gap;
      }
    });
    left += width;
    if (columnIndex < count - 1) {
      seams.push({ axis: 'column', column: 0, index: 0, rect: { x: left, y: area.y, width: gap, height: area.height } });
      left += gap;
    }
  });
  return { rects, seams };
}

/** Resize just the pair beside this seam, keeping both usable. The caller
 * supplies a minimum in viewport pixels converted to an axis fraction. */
export function resizePanes(layout: PaneLayout, seam: PaneSeam, fraction: number, minimum = MIN_SHARE): PaneLayout {
  if (!Number.isFinite(fraction)) return layout;
  if (seam.axis === 'column') {
    const limit = Math.min(0.5, minimum);
    return { ...layout, column: clamp(layout.column + fraction, limit, 1 - limit) };
  }
  const column = layout.columns[seam.column];
  const above = column?.sizes[seam.index];
  const below = column?.sizes[seam.index + 1];
  if (column === undefined || above === undefined || below === undefined) return layout;
  const shared = above + below;
  const limit = Math.min(shared / 2, minimum);
  const sizes = [...column.sizes];
  sizes[seam.index] = clamp(above + fraction, limit, shared - limit);
  sizes[seam.index + 1] = shared - sizes[seam.index]!;
  const columns = [...layout.columns];
  columns[seam.column] = { ...column, sizes };
  return { ...layout, columns };
}
