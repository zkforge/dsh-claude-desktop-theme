import { parse } from '@babel/parser';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASELINE_MODULES } from './lib/platform.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const problems = [];
const normalize = path => path.split(sep).join('/');

async function list(path) {
  const items = await readdir(path, { withFileTypes: true });
  return (await Promise.all(items.map(item => {
    const child = resolve(path, item.name);
    return item.isDirectory() ? list(child) : [child];
  }))).flat();
}

function imports(ast) {
  const entries = [];
  function walk(node) {
    if (node === null || typeof node !== 'object') return;
    if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) && node.source) {
      const typeOnly = node.importKind === 'type' || node.exportKind === 'type'
        || (node.specifiers?.length > 0 && node.specifiers.every(specifier => specifier.importKind === 'type'));
      entries.push({ source: node.source.value, typeOnly });
    }
    if (node.type === 'ImportExpression' && node.source?.type === 'StringLiteral') {
      entries.push({ source: node.source.value, typeOnly: false });
    }
    if (node.type === 'CallExpression'
      && (node.callee?.type === 'Import' || node.callee?.name === 'require')
      && node.arguments?.[0]?.type === 'StringLiteral') {
      entries.push({ source: node.arguments[0].value, typeOnly: false });
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(walk);
      else if (typeof value === 'object') walk(value);
    }
  }
  walk(ast);
  return entries;
}

function hasIdentifier(node, name) {
  if (node === null || typeof node !== 'object') return false;
  if (node.type === 'Identifier' && node.name === name) return true;
  return Object.values(node).some(value => Array.isArray(value)
    ? value.some(child => hasIdentifier(child, name)) : hasIdentifier(value, name));
}

function layer(path) {
  const feature = path.match(/^src\/client\/features\/([^/]+)/)?.[1];
  if (feature) return `feature:${feature}`;
  if (path.startsWith('src/shared/')) return 'shared';
  if (path.startsWith('src/host/')) return 'host';
  if (path.startsWith('src/client/contracts/')) return 'contracts';
  if (path.startsWith('src/client/core/')) return 'core';
  if (path.startsWith('src/client/compat/')) return 'compat';
  if (path.startsWith('src/client/theme/')) return 'theme';
  return 'assembly';
}

for (const file of await list(resolve(root, 'src'))) {
  const path = normalize(relative(root, file));
  const source = await readFile(file, 'utf8');
  if (/[ \t]+$/m.test(source)) problems.push(`${path}: trailing whitespace`);
  if (file.endsWith('.css')) {
    if (path !== 'src/client/theme/tokens.css' && /#[\da-f]{3,8}\b|\b(?:rgba?|hsla?)\(/i.test(source)) {
      problems.push(`${path}: use design variables instead of literal colours`);
    }
    continue;
  }
  if (!/\.tsx?$/.test(file)) continue;
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  for (const edge of imports(ast)) {
    const from = layer(path);
    if (edge.source.startsWith('.')) {
      const target = normalize(relative(root, resolve(dirname(file), edge.source)));
      const to = layer(target);
      if (!target.startsWith('src/')) problems.push(`${path}: source import leaves src (${edge.source})`);
      if (from === 'shared' && to !== 'shared') problems.push(`${path}: shared cannot depend on ${to}`);
      if (from === 'host' && !['host', 'shared'].includes(to)) problems.push(`${path}: Host cannot import Client code`);
      if (from !== 'host' && from !== 'shared' && to === 'host') problems.push(`${path}: Client cannot import Host code`);
      if (from === 'contracts' && !['contracts', 'shared'].includes(to)
        && !(to === 'core' && edge.typeOnly)) problems.push(`${path}: contracts cannot depend on ${to}`);
      if (from === 'core' && !['core', 'contracts', 'shared'].includes(to)) problems.push(`${path}: core cannot depend on ${to}`);
      if (from === 'compat' && !['compat', 'contracts', 'shared'].includes(to)) problems.push(`${path}: compat cannot depend on ${to}`);
      if (from === 'theme' && !['theme', 'contracts', 'shared', 'core'].includes(to)) problems.push(`${path}: theme cannot depend on ${to}`);
      if (from.startsWith('feature:') && to.startsWith('feature:') && from !== to) {
        problems.push(`${path}: sibling feature import (${edge.source})`);
      }
      if (from.startsWith('feature:') && ['assembly', 'host'].includes(to)) {
        problems.push(`${path}: feature cannot depend on ${to}`);
      }
    } else {
      if (path.startsWith('src/client/') && /^(node:|fs$|path$|child_process$)/.test(edge.source)) {
        problems.push(`${path}: browser code cannot import Node modules`);
      }
      if (path.startsWith('src/client/') && edge.source.startsWith('@deepseek-ai/dsh-')
        && !edge.typeOnly && !BASELINE_MODULES.includes(edge.source)) {
        problems.push(`${path}: dynamic feature SDK imports must be type-only (${edge.source})`);
      }
    }
  }
  if (path.startsWith('src/client/features/') && file.endsWith('.tsx') && hasIdentifier(ast, 'ctx')) {
    problems.push(`${path}: components receive derived props, not ctx`);
  }
}

/* README is rendered on npm as well as GitHub, where a relative link to a repo
   file only resolves on GitHub; those stay absolute. The absolute form can still
   rot when an asset is renamed or removed, so its path is checked here. */
const RAW_PREFIX = 'https://raw.githubusercontent.com/zkforge/dsh-claude-desktop-theme/main/';

const rootEntries = await readdir(root, { withFileTypes: true });
const rootDocs = rootEntries
  .filter(item => item.isFile() && item.name.endsWith('.md'))
  .map(item => item.name);
const docFiles = rootEntries.some(item => item.isDirectory() && item.name === 'docs')
  ? await list(resolve(root, 'docs')) : [];
const nestedDocs = docFiles
  .filter(file => file.endsWith('.md')).map(file => normalize(relative(root, file)));
for (const doc of [...rootDocs, ...nestedDocs]) {
  const source = await readFile(resolve(root, doc), 'utf8');
  if (/[ \t]+$/m.test(source)) problems.push(`${doc}: trailing whitespace`);
  const targets = [...source.matchAll(/\]\(([^)]+)\)/g)].map(match => match[1]);
  for (const [, raw] of source.matchAll(/\bsrc="([^"]+)"/g)) targets.push(raw);
  for (const target of targets) {
    const path = target.split('#')[0];
    if (!path) continue;
    if (path.startsWith(RAW_PREFIX)) {
      try { await readFile(resolve(root, path.slice(RAW_PREFIX.length))); }
      catch { problems.push(`${doc}: missing repository file ${path.slice(RAW_PREFIX.length)}`); }
      continue;
    }
    if (/^(https?:|codex:)/.test(path)) continue;
    try { await readFile(resolve(dirname(resolve(root, doc)), path)); }
    catch { problems.push(`${doc}: missing local link ${path}`); }
  }
}
if (problems.length) throw new Error(problems.join('\n'));
console.log('Architecture boundaries, colour ownership, and local doc links passed.');
