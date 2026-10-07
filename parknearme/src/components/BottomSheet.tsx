// Draggable bottom sheet with three snap points (peek / half / full), in the
// style of Apple Maps.
//
// The sheet is always laid out at its full height and moved with
// translateY, written imperatively so drags don't re-render React. While not
// fully expanded, vertical drags anywhere on the sheet move it (the body uses
// `touch-action: pan-x` so horizontal carousels still scroll natively). When
// expanded, the body scrolls and the grabber/header area drags the sheet.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import './sheet.css';

export type Snap = 'peek' | 'half' | 'full';
const ORDER: Snap[] = ['peek', 'half', 'full'];

interface Props {
  snap: Snap;
  onSnapChange: (snap: Snap) => void;
  /** Reports how many pixels of the viewport the settled sheet covers. */
  onVisibleHeightChange?: (px: number) => void;
  /** Sticky area under the grabber (titles, close buttons). Always draggable. */
  header?: ReactNode;
  children: ReactNode;
  label: string;
  /** Visible height at the peek snap, excluding the bottom safe area. */
  peekHeight?: number;
  /** Upper bound for the half snap as a fraction of the viewport. */
  maxHalfFraction?: number;
}

interface DragState {
  pointerId: number;
  startY: number;
  lastY: number;
  lastT: number;
  velocity: number;
  active: boolean;
}

export function BottomSheet({ snap, onSnapChange, onVisibleHeightChange, header, children, label, peekHeight = 132, maxHalfFraction = 0.6 }: Props) {
  const sheetRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState | null>(null);
  const [dims, setDims] = useState({ full: 0, content: 0, viewport: 0, safeBottom: 0 });

  // Track the sheet's full height, the natural content height and the viewport.
  useLayoutEffect(() => {
    const sheet = sheetRef.current;
    const content = contentRef.current;
    if (!sheet || !content) return;
    const measure = () =>
      setDims({
        full: sheet.offsetHeight,
        content: content.offsetHeight + (topRef.current?.offsetHeight ?? 0),
        viewport: window.innerHeight,
        safeBottom: probeRef.current?.offsetHeight ?? 0,
      });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(sheet);
    ro.observe(content);
    if (topRef.current) ro.observe(topRef.current);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  const heightFor = useCallback(
    (s: Snap): number => {
      const peek = Math.min(dims.full, peekHeight + dims.safeBottom);
      if (s === 'peek') return peek;
      if (s === 'full') return dims.full;
      const half = Math.min(dims.content + dims.safeBottom, dims.viewport * maxHalfFraction, dims.full);
      return Math.max(peek, half);
    },
    [dims, peekHeight, maxHalfFraction],
  );

  const place = useCallback(
    (visible: number, animate: boolean) => {
      const el = sheetRef.current;
      if (!el) return;
      el.classList.toggle('is-dragging', !animate);
      el.style.transform = `translate3d(0, ${Math.max(0, dims.full - visible)}px, 0)`;
    },
    [dims.full],
  );

  // Settle on the requested snap whenever it or the measurements change.
  useLayoutEffect(() => {
    if (!dims.full) return;
    const visible = heightFor(snap);
    place(visible, true);
    onVisibleHeightChange?.(visible);
  }, [snap, dims, heightFor, place, onVisibleHeightChange]);

  // Content that doesn't scroll should start at the top when collapsing.
  useEffect(() => {
    if (snap !== 'full' && bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [snap]);

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const inBody = bodyRef.current?.contains(e.target as Node) ?? false;
    if (inBody && snap === 'full') return; // let expanded content scroll
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, select, [data-no-drag]')) return;
    drag.current = { pointerId: e.pointerId, startY: e.clientY, lastY: e.clientY, lastT: e.timeStamp, velocity: 0, active: false };
  };

  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dy = e.clientY - d.startY;
    if (!d.active) {
      if (Math.abs(dy) < 6) return;
      d.active = true;
      sheetRef.current?.setPointerCapture(e.pointerId);
    }
    const dt = Math.max(1, e.timeStamp - d.lastT);
    d.velocity = 0.7 * ((e.clientY - d.lastY) / dt) + 0.3 * d.velocity;
    d.lastY = e.clientY;
    d.lastT = e.timeStamp;
    const min = heightFor('peek');
    const max = heightFor('full');
    let visible = heightFor(snap) - dy;
    // Rubber-band past the ends.
    if (visible > max) visible = max + (visible - max) * 0.25;
    if (visible < min) visible = min - (min - visible) * 0.25;
    place(visible, false);
  };

  const finish = (e: PointerEvent<HTMLElement>, cancelled: boolean) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    if (!d.active) return;
    if (sheetRef.current?.hasPointerCapture(e.pointerId)) sheetRef.current.releasePointerCapture(e.pointerId);
    const visible = heightFor(snap) - (e.clientY - d.startY);
    const snaps = ORDER.filter((s, i) => i === 0 || heightFor(s) - heightFor(ORDER[i - 1]!) > 24);
    let next: Snap;
    if (cancelled) {
      next = snap;
    } else if (Math.abs(d.velocity) > 0.45) {
      // Flick: go one step in the flick direction from where the finger is.
      const up = d.velocity < 0;
      const candidates = snaps.filter((s) => (up ? heightFor(s) > visible : heightFor(s) < visible));
      next = (up ? candidates[0] : candidates[candidates.length - 1]) ?? (up ? snaps[snaps.length - 1]! : snaps[0]!);
    } else {
      next = snaps.reduce((best, s) => (Math.abs(heightFor(s) - visible) < Math.abs(heightFor(best) - visible) ? s : best), snap);
    }
    place(heightFor(next), true);
    if (next !== snap) onSnapChange(next);
    else onVisibleHeightChange?.(heightFor(next));
  };

  const cycle = () => onSnapChange(snap === 'full' ? 'half' : snap === 'half' ? 'full' : 'half');
  const onGrabberKey = (e: KeyboardEvent) => {
    const i = ORDER.indexOf(snap);
    if (e.key === 'ArrowUp' && i < ORDER.length - 1) {
      e.preventDefault();
      onSnapChange(ORDER[i + 1]!);
    } else if (e.key === 'ArrowDown' && i > 0) {
      e.preventDefault();
      onSnapChange(ORDER[i - 1]!);
    }
  };

  return (
    <section
      ref={sheetRef}
      className={`sheet is-${snap}`}
      aria-label={label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => finish(e, false)}
      onPointerCancel={(e) => finish(e, true)}
    >
      <div className="sheet-probe" ref={probeRef} aria-hidden="true" />
      <div className="sheet-top" ref={topRef}>
        <button
          type="button"
          className="sheet-grabber"
          aria-label={snap === 'full' ? 'Collapse panel' : 'Expand panel'}
          aria-expanded={snap === 'full'}
          onClick={cycle}
          onKeyDown={onGrabberKey}
        >
          <span aria-hidden="true" />
        </button>
        {header}
      </div>
      <div ref={bodyRef} className="sheet-body">
        <div ref={contentRef} className="sheet-content">
          {children}
        </div>
      </div>
    </section>
  );
}
