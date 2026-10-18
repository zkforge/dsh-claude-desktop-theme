import type { Disposer } from '../contracts/ports.ts';
import { hostSelectors } from './host-dom.ts';
import { HERO_RIPPLE_DURATION } from '../contracts/hero-canvas.ts';
import type { HeroRippleImpulse } from '../contracts/hero-canvas.ts';

/** One decorative canvas per visible hero; no timers survive its phase change. */
export function mountHeroCanvas(document: Document,
  draw: (canvas: HTMLCanvasElement, elapsed: number, impulses: readonly HeroRippleImpulse[]) => void,
  report: (error: unknown) => void): Disposer {
  const win = document.defaultView!;
  const host = hostSelectors(document);
  const reduced = win.matchMedia('(prefers-reduced-motion: reduce)');
  let root: HTMLElement | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let titleCanvas: HTMLCanvasElement | null = null;
  let frame = 0;
  let last = 0;
  let elapsed = 0;
  let impulses: HeroRippleImpulse[] = [];
  let disposed = false;
  const stop = () => { win.cancelAnimationFrame(frame); frame = 0; last = 0; };
  const resize = new ResizeObserver(() => {
    if (!canvas || !root) return;
    const ratio = Math.min(win.devicePixelRatio || 1, 2);
    const rect = root.getBoundingClientRect();
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    if (titleCanvas) {
      titleCanvas.style.left = `${rect.left}px`;
      titleCanvas.style.width = `${rect.width}px`;
      titleCanvas.style.height = `${Math.max(0, rect.top)}px`;
      titleCanvas.width = canvas.width;
      titleCanvas.height = Math.round(Math.max(0, rect.top) * ratio);
    }
    sync();
  });
  /**
   * Whether the reader is doing something that needs the main thread.
   *
   * The field is decorative. While a pointer is held (a column drag, a
   * selection), the window is moving, or the reader is typing, its next frame
   * is the first thing to give up: the clock still advances, so the field picks
   * up where it would have been rather than restarting.
   */
  let busy = false;
  const tick = (time: number) => {
    frame = 0;
    if (!canvas || disposed) return;
    // Cap this background to 24 fps, independent of the display's refresh rate.
    if (busy) {
      /* Time still passes: the reveal and the tone drift must not freeze and
         then jump forward when the gesture ends. */
      if (last) elapsed += time - last;
      last = time;
    } else if (!last || time - last >= 1000 / 24) {
      if (last) elapsed += time - last;
      last = time;
      impulses = impulses.filter(impulse => elapsed - impulse.startedAt < HERO_RIPPLE_DURATION);
      try {
        draw(canvas, elapsed, impulses);
        if (titleCanvas && titleCanvas.height) draw(titleCanvas, elapsed, []);
      }
      catch (error) { stop(); report(error); return; }
    }
    frame = win.requestAnimationFrame(tick);
  };
  /* A key press that starts a line also means the reader is here; so does a
     pointer going down. Neither stops the page, only this frame's paint. */
  const engage = (event: Event) => {
    if (event.type === 'keydown') {
      const { key, metaKey, ctrlKey } = event as KeyboardEvent;
      /* Modifiers alone and the command shortcuts do not produce text. */
      if (key === 'Shift' || key === 'Control' || key === 'Alt' || key === 'Meta' || metaKey || ctrlKey) return;
    }
    busy = true;
  };
  const release = () => {
    if (!busy) return;
    busy = false;
    /* Do not paint an overdue frame the moment the gesture ends; the next
       frame's normal cadence takes over. */
    last = 0;
  };
  function sync() {
    if (disposed) return;
    const next = document.querySelector<HTMLElement>(`${host.conversationRoot}[data-phase="hero"]`);
    if (next !== root) {
      stop(); resize.disconnect(); canvas?.remove(); titleCanvas?.remove();
      root = next; canvas = null; titleCanvas = null; elapsed = 0; impulses = [];
      if (root) {
        canvas = document.createElement('canvas');
        canvas.className = 'ccd-hero-ripples'; canvas.setAttribute('aria-hidden', 'true');
        root.prepend(canvas);
        // The native caption strip sits outside the conversation root.
        titleCanvas = document.createElement('canvas');
        titleCanvas.className = 'ccd-hero-ripples ccd-hero-ripples-titlebar';
        titleCanvas.setAttribute('aria-hidden', 'true');
        document.body.prepend(titleCanvas);
        resize.observe(root);
      }
    }
    if (!canvas || !root || !canvas.width || !canvas.height || document.hidden
      || reduced.matches || !root.getClientRects().length) {
      stop();
      impulses = [];
      if (canvas) canvas.hidden = true;
      if (titleCanvas) titleCanvas.hidden = true;
      return;
    }
    canvas.hidden = false;
    if (titleCanvas) titleCanvas.hidden = false;
    if (!frame) { last = 0; frame = win.requestAnimationFrame(tick); }
  }
  const click = (event: MouseEvent) => {
    if (disposed || !root || !canvas || canvas.hidden || reduced.matches || document.hidden
      || event.defaultPrevented || event.button !== 0 || event.detail === 0) return;
    const target = event.target as Element | null;
    if (!target || !root.contains(target) || typeof target.closest !== 'function') return;
    // Observe background clicks without consuming them. Native controls, the
    // editor, menus and header retain their own actions and produce no wave.
    if (target.closest(`a, button, input, textarea, select, summary, label,
      [contenteditable]:not([contenteditable="false"]), [role="button"], [role="tab"],
      [role="slider"], [role="menu"], [role="dialog"], [data-menu-material],
      ${host.composerCard}, ${host.conversationHeader}`)) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height || event.clientX < rect.left || event.clientX > rect.right
      || event.clientY < rect.top || event.clientY > rect.bottom) return;
    // One gesture starts one uninterrupted wave. Further clicks cannot stack,
    // restart its clock or drag its origin while that wave is still playing.
    if (impulses.some(impulse => elapsed - impulse.startedAt < HERO_RIPPLE_DURATION)) return;
    impulses = [{
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
      startedAt: elapsed,
    }];
  };
  const observer = new MutationObserver(sync);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-phase'] });
  document.addEventListener('visibilitychange', sync);
  document.addEventListener('click', click, { passive: true });
  /* Capture, so a handler that stops propagation deep in the page cannot
     leave the field painting through a drag or a keystroke. */
  document.addEventListener('pointerdown', engage, { capture: true, passive: true });
  document.addEventListener('keydown', engage, { capture: true, passive: true });
  document.addEventListener('pointerup', release, { capture: true, passive: true });
  document.addEventListener('pointercancel', release, { capture: true, passive: true });
  document.addEventListener('keyup', release, { capture: true, passive: true });
  win.addEventListener('blur', release);
  reduced.addEventListener('change', sync);
  win.addEventListener('resize', sync);
  sync();
  return () => {
    disposed = true; stop(); observer.disconnect(); resize.disconnect(); canvas?.remove(); titleCanvas?.remove();
    document.removeEventListener('visibilitychange', sync);
    document.removeEventListener('click', click);
    document.removeEventListener('pointerdown', engage, { capture: true });
    document.removeEventListener('keydown', engage, { capture: true });
    document.removeEventListener('pointerup', release, { capture: true });
    document.removeEventListener('pointercancel', release, { capture: true });
    document.removeEventListener('keyup', release, { capture: true });
    win.removeEventListener('blur', release);
    reduced.removeEventListener('change', sync); win.removeEventListener('resize', sync);
    root = null; canvas = null; titleCanvas = null; impulses = [];
  };
}
