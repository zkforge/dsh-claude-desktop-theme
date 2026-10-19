import type { ModelIconShape } from './model-icon-data.ts';
import { modelIconInitial, resolveModelIcon } from './model-icon-match.ts';

interface ModelIconTarget {
  readonly id: string;
  readonly name: string;
}

function Shape({ shape }: { readonly shape: ModelIconShape }) {
  const common = {
    ...(shape.fillOpacity === undefined ? {} : { fillOpacity: shape.fillOpacity }),
    ...(shape.fillRule === undefined ? {} : { fillRule: shape.fillRule as 'evenodd' | 'nonzero' }),
    ...(shape.clipRule === undefined ? {} : { clipRule: shape.clipRule as 'evenodd' | 'nonzero' }),
    ...(shape.opacity === undefined ? {} : { opacity: shape.opacity }),
    ...(shape.transform === undefined ? {} : { transform: shape.transform }),
  };
  switch (shape.kind) {
    case 'path': return <path {...common} d={shape.d ?? ''} />;
    case 'circle': return <circle {...common} cx={shape.cx} cy={shape.cy} r={shape.r} />;
    case 'ellipse': return <ellipse {...common} cx={shape.cx} cy={shape.cy} rx={shape.rx} ry={shape.ry} />;
    case 'rect': return <rect {...common} x={shape.x} y={shape.y} width={shape.width} height={shape.height} rx={shape.rx} ry={shape.ry} />;
  }
}

/**
 * One row's leading glyph: the model family's mark when the index knows it,
 * otherwise the model's initial. The seat is always drawn so rows align.
 */
export function ModelIcon({ provider, model }: {
  readonly provider: ModelIconTarget;
  readonly model: ModelIconTarget;
}) {
  const match = resolveModelIcon(provider, model);
  if (match !== null) {
    return <span className="ccd-model-glyph" aria-hidden="true">
      <svg viewBox={match.mark.viewBox} width="16" height="16" fill="currentColor">
        {match.mark.shapes.map((shape, index) => <Shape key={index} shape={shape} />)}
      </svg>
    </span>;
  }
  return <span className="ccd-model-glyph ccd-model-glyph-fallback" aria-hidden="true">{modelIconInitial(provider, model)}</span>;
}
