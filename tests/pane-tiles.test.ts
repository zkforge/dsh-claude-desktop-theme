import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EMPTY_LAYOUT, MIN_SHARE, reconcilePanes, resizePanes, tilePanes, type PaneRect } from '../src/client/compat/pane-tiles.ts';
const area: PaneRect = { x: 600, y: 8, width: 592, height: 804 };
const GAP = 12;
const four = () => reconcilePanes(EMPTY_LAYOUT, ['terminal', 'diff', 'browser', 'files']);

test('opening one, two, three, four views follows the recording', () => {
  let layout = reconcilePanes(EMPTY_LAYOUT, ['terminal']);
  assert.deepEqual(tilePanes(area, layout, GAP).rects.get('terminal'), area);
  layout = reconcilePanes(layout, ['terminal', 'diff']);
  assert.deepEqual(layout.columns.map(column => column.ids), [['terminal', 'diff']]);
  layout = reconcilePanes(layout, ['terminal', 'diff', 'browser']);
  assert.deepEqual(layout.columns.map(column => column.ids), [['terminal', 'diff'], ['browser']]);
  assert.equal(tilePanes(area, layout, GAP).rects.get('browser')!.height, area.height);
  layout = reconcilePanes(layout, ['terminal', 'diff', 'browser', 'files']);
  assert.deepEqual(layout.columns.map(column => column.ids), [['terminal', 'diff'], ['browser', 'files']]);
  assert.equal(tilePanes(area, layout, GAP).seams.filter(seam => seam.axis === 'row').length, 2);
});

test('left and right row boundaries move independently', () => {
  const layout = four();
  const before = tilePanes(area, layout, GAP);
  const seam = before.seams.find(seam => seam.axis === 'row' && seam.column === 0)!;
  const after = tilePanes(area, resizePanes(layout, seam, 0.1), GAP);
  assert.deepEqual(after.rects.get('browser'), before.rects.get('browser'));
  assert.deepEqual(after.rects.get('files'), before.rects.get('files'));
  assert.ok(after.rects.get('terminal')!.height > before.rects.get('terminal')!.height);
  const right = before.seams.find(seam => seam.axis === 'row' && seam.column === 1)!;
  assert.deepEqual(resizePanes(layout, right, 0.1).columns[0], layout.columns[0]);
});

test('closing fills only the vacated column and preserves the other proportions', () => {
  const layout = four();
  const seam = tilePanes(area, layout, GAP).seams.find(seam => seam.axis === 'row' && seam.column === 1)!;
  const dragged = resizePanes(layout, seam, 0.12);
  const before = tilePanes(area, dragged, GAP);
  const closed = reconcilePanes(dragged, ['diff', 'browser', 'files']);
  const after = tilePanes(area, closed, GAP);
  assert.equal(after.rects.get('diff')!.height, area.height);
  assert.deepEqual(after.rects.get('browser'), before.rects.get('browser'));
  assert.deepEqual(after.rects.get('files'), before.rects.get('files'));
  const lastColumn = reconcilePanes(closed, ['browser', 'files']);
  assert.deepEqual(lastColumn.columns[0]!.sizes, dragged.columns[1]!.sizes);
  assert.equal(tilePanes(area, lastColumn, GAP).rects.get('browser')!.width, area.width);
});

test('a width drag keeps both columns inside the card and preserves row sizes', () => {
  const layout = four();
  const seam = tilePanes(area, layout, GAP).seams.find(seam => seam.axis === 'column')!;
  const next = resizePanes(layout, seam, 0.2);
  assert.deepEqual(next.columns, layout.columns);
  const tiles = tilePanes(area, next, GAP);
  assert.ok(tiles.rects.get('terminal')!.width > tiles.rects.get('browser')!.width);
  for (const box of tiles.rects.values()) {
    assert.ok(box.x >= area.x && box.y >= area.y);
    assert.ok(box.x + box.width <= area.x + area.width + 0.001);
    assert.ok(box.y + box.height <= area.y + area.height + 0.001);
  }
  assert.equal(resizePanes(layout, seam, 99).column, 1 - MIN_SHARE);
  assert.equal(resizePanes(layout, seam, -99).column, MIN_SHARE);
});

test('many panes and extreme drags keep positive, non-overlapping shares', () => {
  let layout = reconcilePanes(EMPTY_LAYOUT, Array.from({ length: 12 }, (_, index) => `view${index}`));
  for (const seam of tilePanes(area, layout, GAP).seams) layout = resizePanes(layout, seam, 100);
  for (const column of layout.columns) {
    assert.ok(Math.abs(column.sizes.reduce((sum, size) => sum + size, 0) - 1) < 0.00001);
    assert.ok(column.sizes.every(size => size > 0));
  }
  assert.deepEqual(tilePanes(area, EMPTY_LAYOUT, GAP).seams, []);
  assert.equal(tilePanes(area, EMPTY_LAYOUT, GAP).rects.size, 0);
});
