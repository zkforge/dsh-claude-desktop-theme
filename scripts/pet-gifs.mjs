#!/usr/bin/env node
/**
 * Renders the whale and Claude pet's click reactions to transparent README GIFs.
 *
 * The pet is SVG plus Web Animations (`composer-pet/reactions.ts`), so there is
 * no frame artwork to export. This script drives the real component in headless
 * Chrome: it bundles `Whale.tsx` and `playPetReaction` with esbuild, freezes the
 * animations at a fixed time step, and encodes the stills with ffmpeg. The
 * browser plumbing lives in `lib/headless-chrome.mjs`.
 *
 * Usage:
 *   node scripts/pet-gifs.mjs               # all four reactions
 *   node scripts/pet-gifs.mjs spout wag     # a subset, by reaction name
 *   node scripts/pet-gifs.mjs claude        # Claude's laptop reaction only
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { build } from 'esbuild';
import { run, withPage } from './lib/headless-chrome.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const work = join(root, '.cache/pet-gifs');
const output = join(root, 'assets/pet');

/* The artwork is a 32 × 24 mark, but a reaction draws outside it: the spout
 * climbs ~16 units above the head, the tail sweeps and the body squashes and
 * lifts. The frame is the union of every pose, in artwork units, so all three
 * GIFs share one framing and the whale keeps a fixed position between them.
 * Measured from the rendered stills: x −0.6…34.6, y −15.4…24.3. */
const frameLeft = -2;
const frameTop = -17;
const frameRight = 36;
const frameBottom = 26;

/** One artwork unit per 8 device pixels: 32 × 24 → 256 × 192, edges still hard. */
const scale = 8;
const width = (frameRight - frameLeft) * scale;
const height = (frameBottom - frameTop) * scale;
/* ClaudeArt's own viewBox includes the laptop's complete movement. */
const claudeWidth = 52 * scale;
const claudeHeight = 37 * scale;

/** 25 fps. The reaction easing is stepped, so a finer grid would only add bytes. */
const fps = 25;
/** Resting frames before and after the action, so the loop reads idle → action → idle. */
const holdStart = 5;
const holdEnd = 8;

const reactions = process.argv.slice(2).length > 0
  ? process.argv.slice(2)
  : ['spout', 'hop', 'wag', 'claude'];

if (!reactions.every(reaction => ['spout', 'hop', 'wag', 'claude'].includes(reaction))) {
  throw new Error(`Unknown reaction; expected spout, hop, wag or claude`);
}

/* ---------------------------------------------------------------- the page */

const source = async path => readFile(join(root, path), 'utf8');

/** Reads a brand colour out of the light-scheme block of the token sheet. */
function token(css, name) {
  const match = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`Missing token --${name} in theme/tokens.css`);
  return match[1].trim();
}

const petCss = await source('src/client/features/composer-pet/pet.css');
const tokensCss = await source('src/client/theme/tokens.css');

const page = `<!doctype html>
<html data-dsh-ccd-style="true">
<head>
<meta charset="utf-8">
<style>
:root {
  --ccd-pet-blue: ${token(tokensCss, 'ccd-pet-blue')};
  --ccd-pet-light: ${token(tokensCss, 'ccd-pet-light')};
  --ccd-claude-coral: ${token(tokensCss, 'ccd-claude-coral')};
  --ccd-claude-shade: ${token(tokensCss, 'ccd-claude-shade')};
  --ccd-claude-eye: ${token(tokensCss, 'ccd-claude-eye')};
  --ccd-claude-laptop: ${token(tokensCss, 'ccd-claude-laptop')};
}
html, body { background: transparent; }
body { margin: 0; }
${petCss}
/* Harness overrides: the mark is drawn ${scale}× larger and parked inside the
   reaction frame, so one capture is one finished GIF frame. */
html[data-dsh-ccd-style="true"] .ccd-pet-stage {
  position: relative;
  width: ${width}px;
  height: ${height}px;
}
html[data-dsh-ccd-style="true"] .ccd-pet-stage .ccd-composer-pet {
  position: absolute;
  left: ${-frameLeft * scale}px;
  top: ${-frameTop * scale}px;
  width: ${32 * scale}px;
  height: ${24 * scale}px;
}
html[data-dsh-ccd-style="true"] .ccd-pet-stage .ccd-pet-art {
  width: ${32 * scale}px;
  height: ${24 * scale}px;
}
html[data-dsh-ccd-style="true"] .ccd-pet-stage[data-pet-style="claude"] .ccd-composer-pet {
  left: 0;
  top: 0;
  width: ${claudeWidth}px;
  height: ${claudeHeight}px;
}
html[data-dsh-ccd-style="true"] .ccd-pet-stage .ccd-claude-art {
  left: 0;
  top: 0;
  width: ${claudeWidth}px;
  height: ${claudeHeight}px;
}
</style>
</head>
<body>
<div class="ccd-pet-stage"></div>
<script src="./harness.js"></script>
<script>
const { Whale, playPetReaction, ClaudeArt, CLAUDE_REACTION_MS } = petHarness;
const stage = document.querySelector('.ccd-pet-stage');
let built = null;

/* Mirrors ComposerPet's markup for one reaction, then pauses every animation it
   created so the timeline can be scrubbed by hand. The data-reaction attribute
   is what the stylesheet uses to suspend the idle blink and tail. */
function rebuild(reaction) {
  stage.replaceChildren();
  stage.dataset.petStyle = reaction === 'claude' ? 'claude' : 'whale';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ccd-composer-pet';
  button.dataset.reaction = reaction;
  if (reaction === 'claude') {
    button.classList.add('ccd-claude-pet');
    button.append(ClaudeArt({ elapsed: null }));
    stage.append(button);
    built = { reaction, animations: [] };
    return built;
  }
  button.append(Whale());
  stage.append(button);
  const before = new Set(document.getAnimations());
  playPetReaction(button.querySelector('.ccd-pet-art'), reaction, false);
  const animations = document.getAnimations().filter(animation => !before.has(animation));
  for (const animation of animations) animation.pause();
  if (animations.length === 0) throw new Error('playPetReaction created no animations');
  built = { reaction, animations };
  return built;
}

window.petDuration = reaction => {
  const state = built?.reaction === reaction ? built : rebuild(reaction);
  if (reaction === 'claude') return CLAUDE_REACTION_MS;
  return state.animations[0].effect.getTiming().duration;
};

window.petSeek = (reaction, time) => {
  const state = built?.reaction === reaction ? built : rebuild(reaction);
  if (reaction === 'claude') {
    stage.querySelector('button').replaceChildren(ClaudeArt({ elapsed: time === 0 ? null : time }));
    return 1;
  }
  for (const animation of state.animations) animation.currentTime = time;
  return state.animations.length;
};
</script>
</body>
</html>`;

/* ------------------------------------------------------------- the frames */

const step = 1000 / fps;

async function renderReaction(devtools, reaction, directory) {
  await devtools.evaluate(`window.petSeek(${JSON.stringify(reaction)}, 0)`);
  const duration = await devtools.evaluate(`window.petDuration(${JSON.stringify(reaction)})`);
  const frames = Math.max(1, Math.round(duration / step));
  const numbers = [];
  let index = 0;

  const capture = async () => {
    const shot = await devtools.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: reaction === 'claude' ? claudeWidth : width,
        height: reaction === 'claude' ? claudeHeight : height, scale: 1 },
    });
    const name = `frame-${String(index).padStart(3, '0')}.png`;
    await writeFile(join(directory, name), Buffer.from(shot.data, 'base64'));
    numbers.push(name);
    index += 1;
  };

  /* Frame 0 is the resting pose (every keyframe starts at identity), so the
     same still can hold the loop open at both ends. */
  for (let held = 0; held <= holdStart; held += 1) await capture();
  for (let frame = 1; frame < frames; frame += 1) {
    await devtools.evaluate(`window.petSeek(${JSON.stringify(reaction)}, ${frame * step})`);
    await capture();
  }
  await devtools.evaluate(`window.petSeek(${JSON.stringify(reaction)}, 0)`);
  for (let held = 0; held < holdEnd; held += 1) await capture();

  return { duration, frames, count: numbers.length };
}

async function encode(directory, file) {
  await run('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-framerate', String(fps),
    '-i', join(directory, 'frame-%03d.png'),
    /* The mark is two flat colours plus the soft edge pixels a rotated shape
       leaves behind; eight slots hold all of it without banding the edges. */
    '-filter_complex',
    '[0:v]split[palette][frames];'
    + '[palette]palettegen=reserve_transparent=1:stats_mode=full:max_colors=8[colors];'
    + '[frames][colors]paletteuse=alpha_threshold=128:dither=none',
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
    contents: [
      `export { Whale } from './src/client/features/composer-pet/Whale.tsx';`,
      `export { playPetReaction } from './src/client/features/composer-pet/reactions.ts';`,
      `export { ClaudeArt } from './src/client/features/composer-pet/ClaudePet.tsx';`,
      `export { CLAUDE_REACTION_MS } from './src/client/features/composer-pet/claude-motion.ts';`,
    ].join('\n'),
    resolveDir: root,
    sourcefile: 'pet-harness.ts',
    loader: 'ts',
  },
  /* The project's tsconfig asks for the automatic React runtime; the harness
     has no React, so the classic factory is forced for this bundle only. */
  tsconfigRaw: { compilerOptions: { jsx: 'react', jsxFactory: 'h', jsxFragment: 'Fragment' } },
  bundle: true,
  format: 'iife',
  globalName: 'petHarness',
  inject: [join(root, 'scripts/pet-gifs/jsx-dom.ts')],
  outfile: entry,
  logLevel: 'warning',
});

await writeFile(join(work, 'harness.html'), page);

await withPage({
  url: `file://${join(work, 'harness.html')}`,
  width: Math.max(width, claudeWidth), height, transparent: true, profile: join(work, 'profile'),
}, async devtools => {
  for (const reaction of reactions) {
    const directory = join(work, reaction);
    await rm(directory, { recursive: true, force: true });
    await mkdir(directory, { recursive: true });
    const { duration, frames, count } = await renderReaction(devtools, reaction, directory);
    const file = join(output, `pet-${reaction}.gif`);
    await encode(directory, file);
    const bytes = (await readFile(file)).length;
    console.log(`${reaction.padEnd(5)} ${String(duration).padStart(4)}ms  ${String(frames).padStart(2)} frames  `
      + `${count} stills  ${(bytes / 1024).toFixed(1)} KB  assets/pet/pet-${reaction}.gif`);
  }
});
