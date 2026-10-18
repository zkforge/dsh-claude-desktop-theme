/** Pixel flow and magnetic/spring constants adapted from zanwei/claude-model-selector, MIT. */
export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const smoothstep = (edge0: number, edge1: number, value: number) => {
  const x = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return x * x * (3 - 2 * x);
};
const mix = (from: number, to: number, amount: number) => from + (to - from) * amount;
type Color = readonly [number, number, number];
const mixColor = (from: Color, to: Color, amount: number) =>
  `rgb(${Math.round(mix(from[0], to[0], amount))} ${Math.round(mix(from[1], to[1], amount))} ${Math.round(mix(from[2], to[2], amount))})`;
export function magnet(value: number): number {
  const delta = value - Math.round(value);
  const distance = Math.abs(delta);
  if (distance < .001 || distance > .5) return value;
  const t = 1 - distance / .5;
  return value - delta * (.68 + .42 * t) * t * t;
}
/** The nine colour stops the field reads, resolved once per theme. */
interface Palette {
  leftColor: Color;
  deepViolet: Color;
  deepMid: Color;
  midPurple: Color;
  softMid: Color;
  softLilac: Color;
  paleCool: Color;
  highlightColor: Color;
  peakColor: Color;
}

/**
 * The colour scheme the palette was read under.
 *
 * The stops live in `theme/tokens.css` and only change when the host swaps the
 * document's scheme (`body[data-ds-dark-theme]`), so the marker is the cache
 * key: reading it is one attribute lookup where resolving the palette is a
 * `getComputedStyle` plus nine custom-property reads, on every drawn frame.
 */
function schemeOf(canvas: HTMLCanvasElement): string {
  const document = canvas.ownerDocument;
  return `${document?.documentElement?.getAttribute('data-dsh-ccd-style') ?? ''}|${document?.body?.hasAttribute('data-ds-dark-theme') ?? false}`;
}

const palettes = new WeakMap<HTMLCanvasElement, { readonly scheme: string; readonly palette: Palette }>();

function paletteOf(canvas: HTMLCanvasElement, scheme: string): Palette {
  const cached = palettes.get(canvas);
  if (cached !== undefined && cached.scheme === scheme) return cached.palette;
  const style = getComputedStyle(canvas);
  const color = (key: string): Color => {
    const channels = style.getPropertyValue('--ccd-effort-pixel-' + key).split(',').map(Number);
    return [channels[0] ?? 0, channels[1] ?? 0, channels[2] ?? 0];
  };
  const palette: Palette = {leftColor: color('leftColor'),deepViolet: color('deepViolet'),deepMid: color('deepMid'),midPurple: color('midPurple'),softMid: color('softMid'),softLilac: color('softLilac'),paleCool: color('paleCool'),highlightColor: color('highlightColor'),peakColor: color('peakColor')};
  palettes.set(canvas, { scheme, palette });
  return palette;
}

export function drawPixelField(canvas: HTMLCanvasElement, elapsed: number, reduced: boolean): void {
  const context = canvas.getContext('2d');
  if (!context || !canvas.width || !canvas.height) return;
  const palette = paletteOf(canvas, schemeOf(canvas));
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = canvas.width / ratio, height = canvas.height / ratio;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  const reveal = reduced ? 1 : smoothstep(0, 1, elapsed / 1000);
  const frontier = 1 - reveal;
  const cell = width < 280 ? 5 : 6, gap = 1.1;
  const columns = Math.ceil(width / cell), rows = Math.ceil(height / cell);

    const leftColor = palette.leftColor;
    const deepViolet = palette.deepViolet;
    const deepMid = palette.deepMid;
    const midPurple = palette.midPurple;
    const softMid = palette.softMid;
    const softLilac = palette.softLilac;
    const paleCool = palette.paleCool;
    const highlightColor = palette.highlightColor;
    const peakColor = palette.peakColor;
        const tones = [
      deepViolet, deepViolet, deepMid, deepMid,
      midPurple, midPurple, midPurple,
      softMid, softMid, softLilac, paleCool,
    ];

        const flowDuration = 4000;
    const rawFlow = elapsed / flowDuration;
    const flowCycle = Math.floor(rawFlow);
    const easedFlow = flowCycle + smoothstep(0, 1, rawFlow - flowCycle);

    context.save();
    context.beginPath();
    context.roundRect(0, 0, width, height, 10);
    context.clip();

    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const x = column * cell;
        const y = row * cell;
        const normalizedX = (x + cell * 0.5) / width;
        const revealAlpha = smoothstep(frontier - 0.1, frontier + 0.07, normalizedX);
        if (revealAlpha <= 0.002) continue;

                const purpleAmount = smoothstep(0.1, 0.88, normalizedX);
        const fieldIntensity = smoothstep(0.04, 0.38, normalizedX);
        const depthBias = smoothstep(0.35, 0.95, normalizedX);

        const baseHash = Math.abs(Math.sin(column * 12.9898 + row * 78.233) * 43758.5453) % 1;
        const tempoHash = Math.abs(Math.sin(column * 7.13 + row * 19.41) * 19341.731) % 1;
        const phaseHash = Math.abs(Math.sin(column * 31.17 + row * 11.93) * 28437.123) % 1;
        const chromaHash = Math.abs(Math.sin(column * 9.47 + row * 67.13) * 15823.917) % 1;

        const period = 500 + tempoHash * 1500;
        const localTime = elapsed + phaseHash * period;
        const cycle = Math.floor(localTime / period);
        const cycleProgress = (localTime % period) / period;
        const cycleHash = Math.abs(
          Math.sin(column * 17.17 + row * 41.73 + cycle * 13.11) * 24634.6345,
        ) % 1;
        const widthHash = Math.abs(
          Math.sin(column * 5.37 + row * 29.11 + cycle * 7.43) * 17391.443,
        ) % 1;

                const pulseCenter = 0.2 + cycleHash * 0.55;
        const pulseWidth = 0.09 + widthHash * 0.08;
        const pulseDistance = (cycleProgress - pulseCenter) / pulseWidth;
        const pulseEnvelope = Math.exp(-pulseDistance * pulseDistance * 1.45);
        const activeCycle = cycleHash > 0.12 ? 1 : 0.26;
        const irregularFlicker = pulseEnvelope * activeCycle;

                const flowCoordinate = (normalizedX + easedFlow) * 9;
        const flowIndex = Math.floor(flowCoordinate);
        const flowProgress = smoothstep(0, 1, flowCoordinate - flowIndex);
        const flowHashA = Math.abs(
          Math.sin(flowIndex * 18.31 + row * 37.17) * 19283.173,
        ) % 1;
        const flowHashB = Math.abs(
          Math.sin((flowIndex + 1) * 18.31 + row * 37.17) * 19283.173,
        ) % 1;
        const clusterGate = smoothstep(0.46, 0.84, mix(flowHashA, flowHashB, flowProgress));
        const wavePhase =
          (normalizedX + easedFlow + row * 0.06 + baseHash * 0.02) * Math.PI * 2;
        const directionalWave = Math.pow(0.5 + 0.5 * Math.cos(wavePhase), 5);
        const directionalFlow = Math.max(clusterGate, directionalWave * 0.62);
        const flowingFlicker = Math.max(
          irregularFlicker * (0.48 + directionalFlow * 0.58),
          directionalFlow * (0.38 + baseHash * 0.28),
        );

        const revealGlow = reveal < 0.995
          ? Math.exp(-((normalizedX - frontier) ** 2) / 0.012)
            * (1 - smoothstep(0.7, 1, reveal))
          : 0;
        const lightAmount = Math.max(
          flowingFlicker,
          revealGlow * (0.4 + baseHash * 0.4),
        );

                const peakHighlight =
          lightAmount > 0.4
          && irregularFlicker > 0.16
          && cycleHash > 0.26
          && clusterGate > 0.04;
        const hottestHighlight =
          lightAmount > 0.68
          && irregularFlicker > 0.3
          && cycleHash > 0.48
          && clusterGate > 0.12;
        const highlightAmount = peakHighlight
          ? 0.97
          : clamp(lightAmount * (0.44 + cycleHash * 0.3), 0, 0.64);

                const toneDrift =
          baseHash * 0.28
          + depthBias * 0.28
          + cycleProgress * 0.38
          + easedFlow * 0.18
          + cycleHash * 0.2
          + Math.sin(elapsed * 0.00135 + phaseHash * Math.PI * 2) * 0.14;
        const tonePosition = ((toneDrift % 1) + 1) % 1 * tones.length;
        const toneIndex = Math.floor(tonePosition);
        const toneMix = tonePosition - toneIndex;
        const toneA = tones[toneIndex]!;
        const toneB = tones[(toneIndex + 1) % tones.length]!;
        const cellTone: Color = [
          mix(toneA[0], toneB[0], toneMix),
          mix(toneA[1], toneB[1], toneMix),
          mix(toneA[2], toneB[2], toneMix),
        ];

                const chromaNudge = (chromaHash - 0.5) * 10 + depthBias * 12;
        const variedPurple: Color = [
          clamp(cellTone[0] + chromaNudge * 0.35 - depthBias * 8, 140, 196),
          clamp(cellTone[1] - depthBias * 16 + (baseHash - 0.5) * 8, 104, 168),
          clamp(cellTone[2] + depthBias * 6 + (cycleHash - 0.5) * 6, 182, 216),
        ];
        const baseColor: Color = [
          mix(leftColor[0], variedPurple[0], purpleAmount),
          mix(leftColor[1], variedPurple[1], purpleAmount),
          mix(leftColor[2], variedPurple[2], purpleAmount),
        ];
        const color = hottestHighlight
          ? mixColor(baseColor, peakColor, 0.95)
          : mixColor(baseColor, highlightColor, highlightAmount);

        const baseOpacity = 0.7 + baseHash * 0.2;
        context.globalAlpha = peakHighlight || hottestHighlight
          ? revealAlpha * fieldIntensity
          : revealAlpha * fieldIntensity * clamp(baseOpacity + flowingFlicker * 0.12, 0, 1);
        context.fillStyle = color;
        context.fillRect(x + gap * 0.5, y + gap * 0.5, cell - gap, cell - gap);
      }
    }


  context.restore();
}
