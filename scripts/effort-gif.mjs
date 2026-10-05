#!/usr/bin/env node
/**
 * Renders the Effort card's strongest tier to GIFs for the README.
 *
 * On every stop but the last the card draws a filled track. On the last one it
 * swaps that fill for a canvas "pixel field" (`model-controls/pixels.ts`): the
 * field sweeps in from the right end and then keeps flowing. There is no
 * artwork to export — every frame is computed — so this script drives the real
 * `drawPixelField` in headless Chrome, steps its clock to produce stills, and
 * encodes them with ffmpeg. The browser plumbing lives in
 * `lib/headless-chrome.mjs`.
 *
 * Two things make the stills, rather than the browser, the source of truth:
 *
 * - The field is a pure function of one millisecond count, so a frame is
 *   reproducible and the loop can be cut anywhere.
 * - It is *not* periodic — the per-cell pulses and the tone drift have no
 *   common period — so the loop is closed by hand. The stills run for `period`
 *   and the last `dissolve` of them are crossfaded onto frame 0, the sweep's
 *   empty start, with an overlay image. That is what lets the GIF wrap back to
 *   the beginning without a visible cut.
 *
 * Usage:
 *   node scripts/effort-gif.mjs            # both themes
 *   node scripts/effort-gif.mjs light      # a subset, by theme name
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { build } from 'esbuild';
import { run, withPage } from './lib/headless-chrome.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const work = join(root, '.cache/effort-gif');
const output = join(root, 'assets/effort');

/** Every still is captured at @2x, so the card stays sharp on a retina README. */
const scale = 2;
/** Breathing room around the card, in card pixels, for the panel's own shadow. */
const margin = 20;
/** 20fps: the field's fastest feature is a 500ms pulse, and a 50ms frame is a
 *  round number of GIF centiseconds, which keeps the loop's timing even. */
const fps = 20;
/** One loop: the 1000ms sweep, then the flow that follows it. */
const period = 3000;
/** Tail crossfaded onto frame 0. Long enough to hide the wrap, short enough to read as one motion. */
const dissolve = 400;

/* The stops are advertised by the model catalog at runtime, so the card has no
 * list of its own to read here. The README stills only ever show the top one,
 * and the strongest tier is exactly the tier that hides its ticks — so all the
 * harness needs from the list is the longest name, which the header reserves
 * room for, and the top name, which it prints. */
const levels = ['Low', 'Medium', 'High', 'Max'];
const longest = levels.reduce((widest, level) => level.length > widest.length ? level : widest, '');
const top = levels.length - 1;

const themes = [
  { name: 'light', dark: false },
  { name: 'dark', dark: true },
];

const requested = process.argv.slice(2);
const selected = requested.length > 0 ? themes.filter(theme => requested.includes(theme.name)) : themes;
if (selected.length !== (requested.length || themes.length)) {
  throw new Error(`Unknown theme; expected ${themes.map(theme => theme.name).join(' or ')}`);
}

/* ---------------------------------------------------------------- the page */

const source = path => readFile(join(root, path), 'utf8');

/* The card is laid out by `usePopup` in the app — a manual popover pinned above
 * the Composer — and the harness has no Composer and nothing to close on. What
 * it mirrors is the panel's own markup, one `data-ultra` render of
 * `EffortPanel.tsx` with the thumb parked on the last stop; the swap into the
 * pixel field is a CSS transition the stills start out already settled in, so
 * only the field's clock has to be driven. */
const card = `<div class="ccd-effort" id="card" role="dialog" aria-label="Effort" data-ultra style="--effort-progress: 1">
<section class="panel">
  <div class="header">
    <div class="title"><span>Effort</span>
      <span class="level-stage" data-longest="${longest}" aria-live="polite" aria-atomic="true"><span class="level-outgoing" aria-hidden="true"></span><span class="level-current">${levels[top]}</span></span>
    </div>
    <div class="help-wrap"><button type="button" class="help-button" aria-label="About effort levels" aria-describedby="effort-help">
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" /><path d="M9.8 9.2a2.35 2.35 0 0 1 4.55.82c0 1.8-2.35 2.05-2.35 3.7M12 17.2h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
    </button><div class="tooltip" id="effort-help" role="tooltip">Higher effort means more thorough responses, but takes longer and uses your limits faster.</div></div>
  </div>
  <div class="axis" aria-hidden="true"><span>Faster</span><span>Smarter</span></div>
  <div class="track-shell"><div class="track" aria-hidden="true"><div class="track-fill"></div><div class="ultra-fallback"></div><canvas class="pixel-field"></canvas><div class="ticks">${levels.map(() => '<span class="tick" style="opacity: 0"></span>').join('')}</div></div>
    <input class="range" type="range" min="0" max="${top}" step="0.001" value="${top}" aria-label="Effort level" aria-valuetext="${levels[top]}">
  </div>
</section>
</div>`;

const tokensCss = await source('src/client/theme/tokens.css');
const effortCss = await source('src/client/features/model-controls/effort.css');

const page = `<!doctype html>
<html data-dsh-ccd-style="true">
<head>
<meta charset="utf-8">
<style>
${tokensCss}
${effortCss}
/* Harness overrides: the card sits in the page instead of being pinned over the
   Composer, so the script can measure it and capture it where it lands. */
html, body { background: var(--ccd-canvas); }
body { margin: 0; padding: ${margin}px; }
html[data-dsh-ccd-style="true"] .ccd-effort { position: relative; z-index: 0; }
</style>
</head>
<body>
${card}
<script src="./harness.js"></script>
<script>
const { drawPixelField } = effortHarness;
const card = document.querySelector('#card');
const canvas = document.querySelector('.pixel-field');
const ratio = Math.min(devicePixelRatio || 1, 2);
let hold = null;

/* The component sizes the canvas from its own box before each draw. The harness
   draws outside that loop, so it does the same whenever the layout is redone,
   and hands back the box the capture has to cover. */
window.effortLayout = () => {
  const track = canvas.getBoundingClientRect();
  const width = Math.round(track.width * ratio), height = Math.round(track.height * ratio);
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  const box = card.getBoundingClientRect();
  return { cardWidth: box.width, cardHeight: box.height };
};

window.effortSeek = time => { drawPixelField(canvas, time, false); };

/* Frame 0, held as an image covering the capture. Fading it up over the live
   card blends the two renders; at full opacity the still is frame 0 again.
   An img is a replaced element, so it keeps its own size unless the box is
   stated outright — inset alone would park a 2x-sized render in the corner. */
window.effortHold = async dataUrl => {
  if (!hold) {
    hold = document.createElement('img');
    hold.className = 'harness-hold';
    hold.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:10;pointer-events:none;opacity:0';
    card.append(hold);
  }
  hold.src = dataUrl;
  await hold.decode();
};

window.effortFade = alpha => { if (hold) hold.style.opacity = String(alpha); };
</script>
</body>
</html>`;

/* ---------------------------------------------------------------- capture */

const step = 1000 / fps;
const frames = Math.round(period / step);

/** How much of frame 0 a still at `time` has been crossfaded onto. */
const fadeAt = time => Math.max(0, Math.min(1, (time - (period - dissolve)) / dissolve));

const nextPaint = 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))';

async function renderTheme(devtools, theme, directory) {
  await devtools.evaluate(`document.body.toggleAttribute('data-ds-dark-theme', ${theme.dark})`);
  /* One overlay serves every theme, and the previous theme left it faded most of
     the way up. Frame 0 has to be shot with it out of the way, or the theme
     would carry the last theme's card into its first still — and, from there,
     into the loop's closing dissolve. */
  await devtools.evaluate('window.effortFade(0)');
  await devtools.evaluate(nextPaint);

  /* The card is the capture, so the viewport is measured around it: the harness
     lays the card out at `margin` from each edge and the clip is the page. */
  const box = await devtools.evaluate('window.effortLayout()');
  const width = Math.round(box.cardWidth + margin * 2);
  const height = Math.round(box.cardHeight + margin * 2);
  await devtools.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
  await devtools.evaluate(`(async () => { await ${nextPaint}; return window.effortLayout(); })()`);

  /* The metrics override above already puts the page at `scale` device pixels
     per CSS pixel, and a clip's own `scale` multiplies that: asking for both
     would rasterise the card at 4x and enlarge the pixel field's own 2x canvas
     with it. The clip is therefore the plain page box. */
  const clip = { x: 0, y: 0, width, height, scale: 1 };
  const capture = async index => {
    const shot = await devtools.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip });
    await writeFile(join(directory, `frame-${String(index).padStart(3, '0')}.png`), Buffer.from(shot.data, 'base64'));
    return shot.data;
  };

  await devtools.evaluate('window.effortSeek(0)');
  const first = await capture(0);
  await devtools.evaluate(`window.effortHold(${JSON.stringify(`data:image/png;base64,${first}`)})`);

  for (let index = 1; index < frames; index += 1) {
    const time = index * step;
    await devtools.evaluate(`window.effortSeek(${time})`);
    await devtools.evaluate(`window.effortFade(${fadeAt(time)})`);
    await capture(index);
  }

  return { width, height };
}

/**
 * GIF encoding. The stills are a flat card with one busy strip, so the palette
 * is gathered from every frame at once and used without dithering: the track's
 * ramp is the only smooth gradient here, and below about 90 slots the card's
 * greys start eating into it and it bands into a cross-hatch.
 */
async function encode(directory, file) {
  await run('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-framerate', String(fps),
    '-i', join(directory, 'frame-%03d.png'),
    '-filter_complex',
    '[0:v]split[palette][frames];'
    + '[palette]palettegen=stats_mode=full:max_colors=96[colors];'
    + '[frames][colors]paletteuse=dither=none',
    '-loop', '0',
    file,
  ]);
}

/* ------------------------------------------------------------------ main */

await mkdir(work, { recursive: true });
await mkdir(output, { recursive: true });

const entry = join(work, 'harness.js');
await build({
  stdin: {
    contents: `export { drawPixelField } from './src/client/features/model-controls/pixels.ts';`,
    resolveDir: root,
    sourcefile: 'effort-harness.ts',
    loader: 'ts',
  },
  bundle: true,
  format: 'iife',
  globalName: 'effortHarness',
  outfile: entry,
  logLevel: 'warning',
});

await writeFile(join(work, 'harness.html'), page);

await withPage({
  url: `file://${join(work, 'harness.html')}`,
  /* Provisional: the page needs a viewport to measure the card in, and the real
     metrics are set from that measurement before anything is captured. */
  width: 600, height: 400, scale, profile: join(work, 'profile'),
}, async devtools => {
  for (const theme of selected) {
    const directory = join(work, theme.name);
    await rm(directory, { recursive: true, force: true });
    await mkdir(directory, { recursive: true });
    const { width, height } = await renderTheme(devtools, theme, directory);
    const file = join(output, `effort-${theme.name}.gif`);
    await encode(directory, file);
    const bytes = (await readFile(file)).length;
    console.log(`${theme.name.padEnd(5)} ${String(period).padStart(4)}ms  ${String(frames).padStart(2)} frames  `
      + `${width}×${height} @${scale}x  ${(bytes / 1024).toFixed(1)} KB  assets/effort/effort-${theme.name}.gif`);
  }
});
