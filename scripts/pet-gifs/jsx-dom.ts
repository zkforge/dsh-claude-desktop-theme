/**
 * Minimal JSX factory for the README asset renderer.
 *
 * `scripts/pet-gifs.mjs` bundles the real `Whale.tsx` into a headless page.
 * esbuild is pointed at this factory (`jsxFactory: 'h'`, injected into every
 * module), so the artwork builds the SVG DOM directly instead of routing a
 * static mark through React. Attribute names are mapped the way React maps
 * them, for the handful the whale actually uses.
 */

const renamed: Record<string, string> = {
  className: 'class',
  shapeRendering: 'shape-rendering',
  ariaHidden: 'aria-hidden',
};

export function h(type: string, props: Record<string, unknown> | null, ...children: unknown[]): Element {
  const node = document.createElementNS('http://www.w3.org/2000/svg', type);
  for (const [name, value] of Object.entries(props ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    node.setAttribute(renamed[name] ?? name, String(value));
  }
  append(node, children);
  return node;
}

export function Fragment(_props: Record<string, unknown> | null, ...children: unknown[]): DocumentFragment {
  const node = document.createDocumentFragment();
  append(node, children);
  return node;
}

function append(node: Element | DocumentFragment, children: unknown[]): void {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || typeof child === 'boolean') continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}
