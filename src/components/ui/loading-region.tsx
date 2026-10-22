"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

export function Skeleton({ className = "" }: { className?: string }) {
  return <span aria-hidden="true" className={`skeleton block ${className}`} />;
}

export function RowsSkeleton({ rows = 6 }: { rows?: number }) {
  return <div className="space-y-4 p-5 sm:p-6">{Array.from({ length: rows }, (_, index) =>
    <div key={index} className="flex items-center gap-4"><Skeleton className="h-10 w-10 shrink-0" /><div className="flex-1 space-y-2"><Skeleton className="h-3 w-2/3" /><Skeleton className="h-3 w-1/3" /></div><Skeleton className="h-5 w-16" /></div>,
  )}</div>;
}

export function ChartSkeleton() {
  return <div className="flex h-full min-h-72 flex-col gap-5 p-5 sm:p-6"><Skeleton className="h-5 w-52" /><div className="flex flex-1 items-end gap-3 border-b border-l border-[var(--color-border-light)] p-4">{[38, 72, 54, 88, 62, 45, 31, 24, 18, 12].map((height, index) => <span key={index} className="skeleton block flex-1" style={{ height: `${height}%` }} />)}</div><Skeleton className="h-6 w-2/3" /></div>;
}

export function TableSkeleton({ columns = 6, rows = 12 }: { columns?: number; rows?: number }) {
  const cells = Array.from({ length: columns }, (_, index) => index);
  return <div className="flex h-full min-h-80 flex-col">
    <div className="space-y-4 p-5"><div className="flex items-center justify-between gap-6"><Skeleton className="h-5 w-1/3" /><Skeleton className="h-10 w-1/3" /></div><Skeleton className="h-3 w-2/3" /><Skeleton className="h-3 w-32" /></div>
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{Array.from({ length: rows }, (_, row) => <div key={row} className="grid min-h-12 flex-1 items-center gap-4 border-t border-[var(--color-border-light)] px-4 py-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(112px, 1fr))`, minWidth: columns * 128 }}>{cells.map(column => <Skeleton key={column} className={`h-3 ${column === 1 ? "w-full" : "w-2/3"}`} />)}</div>)}</div>
    <div className="flex justify-between gap-5 border-t border-[var(--color-border-light)] p-4"><Skeleton className="h-8 w-24" /><Skeleton className="h-5 w-1/3" /><Skeleton className="h-8 w-24" /></div>
  </div>;
}

/** Keep the scroll DOM mounted. Lock its measured box across a refresh and its
 * response; larger results scroll inside it. Width changes may reflow normally.
 * Only interactive leaves become inert: making the scroll parent inert would
 * also disable wheel/touch scrolling while the skeleton is visible. */
export function LoadingRegion({ children, loading, skeleton, error, label, className = "", contentClassName = "", as: Tag = "div", preserveHeight = true }: {
  children: ReactNode;
  loading: boolean;
  skeleton?: ReactNode;
  error?: string | null;
  label: string;
  className?: string;
  contentClassName?: string;
  as?: "div" | "section";
  preserveHeight?: boolean;
}) {
  const region = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const placeholder = useRef<HTMLDivElement>(null);
  const hasSettled = useRef(!loading);
  const [height, setHeight] = useState<number | null>(null);
  const [display, setDisplay] = useState(children);
  if (!loading && display !== children) setDisplay(children);
  const displayedChildren = loading ? display : children;
  const blocked = loading || !!error;
  useLayoutEffect(() => {
    // The first pending render may contain only an empty hint. Let the first
    // result establish its real size before locking subsequent refreshes.
    if (!loading) { hasSettled.current = true; return; }
    if (!hasSettled.current || !preserveHeight || height !== null) return;
    const measured = region.current?.getBoundingClientRect().height || 0;
    if (measured > 0) setHeight(Math.ceil(measured));
  }, [loading, preserveHeight, height]);
  useLayoutEffect(() => {
    const element = region.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    let width: number | undefined;
    const observer = new ResizeObserver(entries => {
      const next = entries[0]?.contentRect.width;
      if (next !== undefined) {
        if (width !== undefined && Math.abs(next - width) > 1) setHeight(null);
        width = next;
      }
    });
    observer.observe(element);
    const resize = () => setHeight(null);
    window.addEventListener("resize", resize);
    return () => { observer.disconnect(); window.removeEventListener("resize", resize); };
  }, []);
  useLayoutEffect(() => {
    if (!blocked) return;
    const controls = [...(content.current?.querySelectorAll<HTMLElement>("button, a, input, select, textarea, summary, [tabindex], [role=button]") || [])]
      .filter(element => element.getAttribute("role") !== "region");
    const previous = controls.map(element => element.hasAttribute("inert"));
    controls.forEach(element => element.setAttribute("inert", ""));
    return () => controls.forEach((element, index) => { if (!previous[index]) element.removeAttribute("inert"); });
  }, [blocked, displayedChildren]);
  useLayoutEffect(() => {
    const element = region.current;
    const toggle = () => { if (!blocked) setHeight(null); };
    element?.addEventListener("toggle", toggle, true);
    return () => element?.removeEventListener("toggle", toggle, true);
  }, [blocked]);
  const positionPlaceholder = () => {
    if (placeholder.current && region.current)
      placeholder.current.style.transform = `translate(${region.current.scrollLeft}px, ${region.current.scrollTop}px)`;
  };
  useLayoutEffect(positionPlaceholder, [blocked]);
  return <Tag ref={region} aria-label={label} aria-busy={loading} data-loading-region data-loading={loading || undefined}
    className={`loading-region ${className}`} style={height !== null && preserveHeight ? { height } : undefined}
    onPointerDownCapture={event => { if (blocked) event.stopPropagation(); }}
    onPointerMoveCapture={event => { if (blocked) event.stopPropagation(); }}
    onPointerOverCapture={event => { if (blocked) event.stopPropagation(); }}
    onScrollCapture={event => { if (event.target === region.current) positionPlaceholder(); }}
    onClickCapture={event => { if (blocked) { event.preventDefault(); event.stopPropagation(); } }}>
    <div ref={content} data-loading-content aria-hidden={blocked || undefined} className={contentClassName} style={blocked ? { opacity: 0 } : undefined}>{displayedChildren}</div>
    {blocked && <div ref={placeholder} data-loading-placeholder className="loading-region-placeholder" aria-hidden={!error}>
      {error ? <p className="m-auto p-6 text-center text-sm text-[var(--color-text-secondary)]">{error}</p> : skeleton || <RowsSkeleton />}
    </div>}
  </Tag>;
}
