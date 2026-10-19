import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * The source SVGs are kept verbatim under
 * `src/client/features/model-controls/lobe-icons/svg/`, so a later maintainer
 * can inspect or regenerate the index without downloading the package again.
 * Each family keeps its monochrome base mark as a fallback and, when upstream
 * supplies `<slug>-color.svg`, the matching color artwork. `-text` and
 * `-brand` files without a base counterpart are wordmarks, not the square row
 * marks this index is for, so they stay out of the runtime index.
 */
const root = fileURLToPath(new URL('../', import.meta.url));
const source = join(root, 'src/client/features/model-controls/lobe-icons/svg');
const output = join(root, 'src/client/features/model-controls/model-icon-data.ts');

const ATTRIBUTES = new Set([
  'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'width', 'height',
  'fill-opacity', 'fill-rule', 'clip-rule', 'opacity', 'transform',
]);

const COLOR_TAGS = new Set([
  'path', 'circle', 'ellipse', 'rect', 'g', 'defs',
  'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'filter',
  'feBlend', 'feColorMatrix', 'feComposite', 'feFlood', 'feGaussianBlur',
  'feOffset',
]);

function decode(value) {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'");
}

function attributes(source) {
  const result = new Map();
  for (const match of source.matchAll(/([\w:-]+)="([^"]*)"/gu)) {
    const [, name, value] = match;
    if (name !== undefined && value !== undefined) result.set(name, value);
  }
  return result;
}

function number(value) {
  return Number.parseFloat(value ?? '');
}

function mergedOpacity(groupOpacity, shapeOpacity) {
  if (groupOpacity === undefined) return shapeOpacity;
  if (shapeOpacity === undefined) return groupOpacity;
  const value = number(groupOpacity) * number(shapeOpacity);
  return Number.isFinite(value) ? String(value) : shapeOpacity;
}

function shape(tag, source, group) {
  const attrs = attributes(source);
  const result = { kind: tag };
  for (const name of ATTRIBUTES) {
    if (!attrs.has(name)) continue;
    const value = attrs.get(name);
    if (value === undefined) continue;
    const key = name === 'fill-opacity' ? 'fillOpacity'
      : name === 'fill-rule' ? 'fillRule'
        : name === 'clip-rule' ? 'clipRule'
          : name;
    result[key] = value;
  }
  if (group.transform !== undefined) result.transform = group.transform;
  const opacity = mergedOpacity(group.opacity, attrs.get('opacity'));
  if (opacity !== undefined) result.opacity = opacity;
  return result;
}

function parse(source) {
  const title = decode(source.match(/<title>(.*?)<\/title>/u)?.[1] ?? '');
  const viewBox = source.match(/\bviewBox="([^"]+)"/u)?.[1] ?? '0 0 24 24';
  const body = source.replace(/<defs>[\s\S]*?<\/defs>/gu, '');
  const shapes = [];
  const groups = [];
  const tokens = /<g\b([^>]*)>|<\/g>|<(path|circle|ellipse|rect)\b([^>]*)>/gu;
  for (const match of body.matchAll(tokens)) {
    const [whole, opening, tag, shapeSource] = match;
    if (whole.startsWith('</g>')) {
      groups.pop();
      continue;
    }
    if (opening !== undefined) {
      const attrs = attributes(opening);
      groups.push({
        opacity: attrs.get('opacity'),
        transform: attrs.get('transform'),
      });
      continue;
    }
    if (tag === undefined || shapeSource === undefined) continue;
    const group = groups.reduce((result, entry) => ({
      opacity: mergedOpacity(result.opacity, entry.opacity),
      transform: [result.transform, entry.transform].filter(Boolean).join(' ') || undefined,
    }), { opacity: undefined, transform: undefined });
    shapes.push(shape(tag, shapeSource, group));
  }
  return { title, viewBox, shapes };
}

function colorMarkup(file, slug) {
  const source = file;
  const rootMatch = source.match(/^<svg\b([^>]*)>([\s\S]*)<\/svg>\s*$/u);
  if (rootMatch === null) throw new Error(`${slug}-color.svg has no SVG root`);

  const [, rootAttributes, rootBody] = rootMatch;
  const rootAttrs = attributes(rootAttributes);
  let body = rootBody.replace(/<title>[\s\S]*?<\/title>/u, '');

  for (const match of body.matchAll(/<\/?([\w:-]+)\b/gu)) {
    const tag = match[1];
    if (tag !== undefined && !COLOR_TAGS.has(tag)) {
      throw new Error(`${slug}-color.svg contains unsupported <${tag}>`);
    }
  }
  if (/\son[\w:-]+\s*=/iu.test(body)) {
    throw new Error(`${slug}-color.svg contains an event handler`);
  }
  if (/\sstyle="[^"]*(?:expression|javascript:|@import|url\s*\()/iu.test(body)) {
    throw new Error(`${slug}-color.svg contains an unsafe inline style`);
  }

  /*
   * White knockouts should follow the card in both palettes. Masks and clip
   * paths are not knockouts: their white is the mask strength, so leave those
   * subtrees untouched or a dark card would also darken the icon.
   */
  let protectedDepth = 0;
  body = body.replace(/<(\/?)([\w:-]+)\b([^>]*)>/gu, (tag, closing, name, rest) => {
    if (name === 'mask' || name === 'clipPath') {
      if (closing === '/') protectedDepth = Math.max(0, protectedDepth - 1);
      else if (!rest.trimEnd().endsWith('/')) protectedDepth += 1;
      return tag;
    }
    if (closing === '/' || protectedDepth > 0) return tag;
    return tag.replace(
      /\bfill="(?:#fff(?:fff)?|white)"/giu,
      'fill="var(--ccd-card)"',
    );
  });

  // React mounts several marks in one document; scope every SVG id.
  const prefix = `ccd-model-icon-${slug}-`;
  body = body.replace(/\bid="([^"]+)"/gu, (_, id) => `id="${prefix}${id}"`);
  body = body.replace(/url\(#([^)]+)\)/gu, (_, id) => `url(#${prefix}${id})`);

  return {
    viewBox: rootAttrs.get('viewBox') ?? '0 0 24 24',
    fill: rootAttrs.get('fill'),
    fillRule: rootAttrs.get('fill-rule'),
    markup: body.trim(),
  };
}

const files = (await readdir(source))
  .filter(file => file.endsWith('.svg') && !file.includes('-'))
  .sort();
const icons = {};
for (const file of files) {
  const slug = file.slice(0, -4);
  const mark = parse(await readFile(join(source, file), 'utf8'));
  const colorFile = `${slug}-color.svg`;
  try {
    const color = await readFile(join(source, colorFile), 'utf8');
    mark.color = colorMarkup(color, slug);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  icons[slug] = mark;
}

const generated = `/*
 * Generated by scripts/generate-model-icons.mjs. Do not edit by hand.
 *
 * Source: @lobehub/icons-static-svg@1.95.1
 * Repository: https://github.com/lobehub/lobe-icons
 * License: MIT (see ../../../../LICENSE and lobe-icons/LICENSE)
 *
 * Every family keeps a monochrome fallback with its presentation fills removed
 * so the row can paint it with \`currentColor\`. Families with an upstream
 * \`-color\` variant also carry that artwork inline, including gradients,
 * masks and filters. Its ids are scoped to the family and white knockouts use
 * \`var(--ccd-card)\` so they follow the card in both palettes.
 */

export interface ModelIconShape {
  readonly kind: 'path' | 'circle' | 'ellipse' | 'rect';
  readonly d?: string;
  readonly cx?: string;
  readonly cy?: string;
  readonly r?: string;
  readonly rx?: string;
  readonly ry?: string;
  readonly x?: string;
  readonly y?: string;
  readonly width?: string;
  readonly height?: string;
  readonly fillOpacity?: string;
  readonly fillRule?: string;
  readonly clipRule?: string;
  readonly opacity?: string;
  readonly transform?: string;
}

export interface ModelIconMark {
  readonly title: string;
  readonly viewBox: string;
  readonly shapes: readonly ModelIconShape[];
  readonly color?: ModelIconColor;
}

export interface ModelIconColor {
  readonly viewBox: string;
  readonly fill?: string;
  readonly fillRule?: string;
  readonly markup: string;
}

export const MODEL_ICONS: Readonly<Record<string, ModelIconMark>> = ${JSON.stringify(icons, null, 2)};
`;

await mkdir(dirname(output), { recursive: true });
await writeFile(output, generated);
console.log(`Generated ${files.length} model icons in ${output}`);
