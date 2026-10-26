import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

/** A single-line value with a full-text tooltip outside the card's clipping box. */
export function InfoText({ text, hint = text }: { text: string; hint?: string }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const [open, setOpen] = useState(false);
  const id = useId();
  const hide = () => { clearTimeout(timer.current); setOpen(false); };
  const show = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(true), 400); };
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(hide, [text, hint]);
  useLayoutEffect(() => {
    const node = tip.current, target = anchor.current;
    if (!open || node === null || target === null) return;
    node.setAttribute('popover', 'manual');
    node.showPopover();
    const a = target.getBoundingClientRect(), p = node.getBoundingClientRect();
    node.style.left = `${Math.max(8, Math.min(a.right - p.width, innerWidth - p.width - 8))}px`;
    node.style.top = `${Math.max(8, a.top >= p.height + 8 ? a.top - p.height - 6 : Math.min(a.bottom + 6, innerHeight - p.height - 8))}px`;
    const dismiss = () => setOpen(false);
    document.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    return () => {
      document.removeEventListener('scroll', dismiss, true); window.removeEventListener('resize', dismiss);
      if (node.matches(':popover-open')) node.hidePopover();
    };
  }, [open]);
  return <>
    <span ref={anchor} className="ccd-info-text" tabIndex={0} aria-describedby={open ? id : undefined}
      onPointerEnter={show} onPointerLeave={hide} onPointerDown={hide} onFocus={show} onBlur={hide}
      onKeyDown={event => { if (event.key === 'Escape') hide(); }}>{text}</span>
    {open && <span ref={tip} id={id} className="ccd-info-tooltip" role="tooltip">{hint}</span>}
  </>;
}
