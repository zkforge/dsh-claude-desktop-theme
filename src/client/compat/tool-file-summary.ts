/** Read only the native row header; expanded diffs and nested calls are not metadata. */
export interface ToolFileSummary {
  readonly action: 'write' | 'edit';
  readonly name: string;
  readonly added?: number | undefined;
  readonly removed?: number | undefined;
}

export interface FileSummaryPart {
  readonly text: string;
  readonly tone: 'plain' | 'file' | 'added' | 'removed';
}

export function toolFileSummary(row: Element): ToolFileSummary | null {
  const action = row.getAttribute('data-tool');
  if ((action !== 'write' && action !== 'edit') || row.getAttribute('data-state') !== 'ok') return null;
  const header = row.querySelector('[data-disclosure-row]');
  const name = (header?.querySelector('[class*="_fileLink"]')
    ?? header?.querySelector('[class*="_summary"]'))?.textContent?.trim();
  if (!name) return null;
  const count = (local: string, sign: string) => {
    const text = header?.querySelector(`[class*="_${local}"]`)?.textContent?.trim();
    if (!text || !new RegExp(`^${sign}[0-9]+$`, 'u').test(text)) return undefined;
    const value = Number(text.slice(1));
    return Number.isSafeInteger(value) ? value : undefined;
  };
  // A write can overwrite an existing file. Neither +N/-0 nor the tool name
  // proves creation: the host also falls back to an intended whole-file diff.
  return { action, name, added: count('diffAdded', '\\+'), removed: count('diffRemoved', '[-−]') };
}

export function fileSummaryParts(files: readonly ToolFileSummary[], others: readonly string[]): FileSummaryPart[] {
  const parts: FileSummaryPart[] = [];
  for (const file of files.slice(0, 2)) {
    if (parts.length) parts.push({ text: ', ', tone: 'plain' });
    parts.push({ text: file.action === 'edit' ? 'Edited ' : 'Wrote ', tone: 'plain' },
      { text: file.name, tone: 'file' });
  }
  if (files.length > 2) parts.push({ text: ` (${files.length} file operations)`, tone: 'plain' });
  if (others.length) parts.push({ text: `, ${others.join(', ')}`, tone: 'plain' });
  // Missing statistics are unknown, never zero. Avoid presenting a partial sum.
  if (files.length && files.every(file => file.added !== undefined && file.removed !== undefined)) {
    parts.push({ text: `+${files.reduce((sum, file) => sum + file.added!, 0)}`, tone: 'added' },
      { text: `−${files.reduce((sum, file) => sum + file.removed!, 0)}`, tone: 'removed' });
  }
  return parts;
}
