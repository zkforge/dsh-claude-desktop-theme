#!/usr/bin/env node
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('本地预览安装：npm run preview:install\n仅检查安装路径：npm run preview:install -- --dry-run\n可通过 DSH_CCD_APP 指定 macOS 应用路径，沿用 DSH_HOME，安装到 desktop profile。');
  process.exit(0);
}
if (args.some(arg => arg !== '--dry-run')) throw new Error('未知参数；请使用 --help 查看用法。');
if (process.platform !== 'darwin') throw new Error('此预览入口适用于 macOS；其他平台请参照 install.md。');
const app = process.env.DSH_CCD_APP || '/Applications/DeepSeek Harness.app';
const cli = join(app, 'Contents/Resources/runtime/cli/bin/dsh');
if (!existsSync(cli)) throw new Error(`找不到 DSH CLI：${cli}\n请先安装并启动 DSH，或设置 DSH_CCD_APP。`);
const { name, version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
console.log(`将构建当前工作区的 ${name}@${version} 并安装到 DSH desktop profile。`);
console.log(`DSH：${app}`);
console.log('本次包含当前工作区的所有改动。安装后保留已有插件设置。');
if (args.includes('--dry-run')) {
  console.log('路径检查通过；未构建、打包或安装。');
  process.exit(0);
}
const npm = process.env.npm_execpath;
function run(command, arguments_) {
  const result = spawnSync(command, arguments_, { cwd: root, stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`命令失败：${command}（退出码 ${result.status ?? result.signal}）`);
}
function runNpm(arguments_) {
  if (npm) run(process.execPath, [npm, ...arguments_]);
  else run('npm', arguments_);
}
if (!existsSync(join(root, 'node_modules/.bin/esbuild'))) runNpm(['ci', '--cache', '.cache/npm']);
runNpm(['run', 'build']);
// A unique, retained path prevents same-version local dependency caching.
// This preview intentionally skips prepack's full test suite; release packing
// continues to use pack:local and its existing checks.
mkdirSync(join(root, 'artifacts'), { recursive: true });
const installDir = mkdtempSync(join(root, 'artifacts/install-preview.'));
runNpm(['pack', '--ignore-scripts', '--pack-destination', installDir]);
const tarball = join(installDir, `${name.replace(/^@/, '').replaceAll('/', '-')}-${version}.tgz`);
if (!existsSync(tarball)) throw new Error(`未生成预期安装包：${tarball}`);
run(cli, ['plugin', '--profile', 'desktop', 'add', tarball]);
console.log(`\n安装完成。请切回 DSH 按 ⌘R，再打开会话的三点菜单查看。\n安装包：${tarball}\n请保留该目录，DSH 的本地依赖会引用它。`);
