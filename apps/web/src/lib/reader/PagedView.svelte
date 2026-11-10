<script lang="ts">
  import type { Snippet } from "svelte";
  import { onMount, untrack } from "svelte";

  /**
   * One page per screen (manga). Tap zones: left/right thirds turn pages, centre = menu.
   * In RTL (Japanese manga) the left side goes forward. Swipes follow the same direction.
   * Only previous/current/next are mounted; the next few are warmed with fetch() so the
   * HTTP/service-worker cache has them without holding decoded bitmaps.
   */
  let {
    pages,
    initialPage = 0,
    direction,
    onPage,
    onEnd,
    onToggleUi,
    onRatio,
    footer,
  }: {
    pages: string[];
    initialPage?: number;
    direction: "rtl" | "ltr";
    onPage: (index: number) => void;
    onEnd: () => void;
    onToggleUi: () => void;
    onRatio?: (index: number, ratio: number) => void;
    footer: Snippet;
  } = $props();

  // Keyed per chapter/mode by the parent: only the initial page matters.
  let index = $state(untrack(() => Math.min(initialPage, pages.length - 1)));
  const atEnd = $derived(index >= pages.length);
  const warmed = new Set<number>();

  $effect(() => {
    for (let i = index + 1; i <= index + 4 && i < pages.length; i++) {
      if (warmed.has(i)) continue;
      warmed.add(i);
      // Direct pages (source's own CDN) have no CORS: warm them as opaque requests.
      const url = pages[i]!;
      const init: RequestInit = url.startsWith("/")
        ? { credentials: "same-origin" }
        : { mode: "no-cors", referrerPolicy: "no-referrer" };
      void fetch(url, init).catch(() => warmed.delete(i));
    }
  });

  export function jumpTo(i: number) {
    go(i);
  }

  // ── Pinch zoom (own gestures: the page must not turn or the UI toggle while zoomed) ──
  const MAX_SCALE = 4;
  let scale = $state(1);
  let tx = $state(0);
  let ty = $state(0);
  const zoomed = $derived(scale > 1.01);
  let pinch: { dist: number; scale: number; px: number; py: number } | null = null;
  let pan: { x: number; y: number; tx: number; ty: number } | null = null;
  /** A gesture just ended: ignore the click the browser synthesises after it. */
  let suppressClick = false;

  function resetZoom() {
    scale = 1;
    tx = 0;
    ty = 0;
  }

  /** height/width of each loaded page, to know where the picture sits inside its letterbox. */
  const shapes = new Map<number, number>();

  /** Keep the picture (not its black letterbox) on screen; centre it on an axis it doesn't fill. */
  function clampPan() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const r = shapes.get(index) ?? h / w;
    const cw = Math.min(w, h / r);
    const ch = cw * r;
    const ox = (w - cw) / 2;
    const oy = (h - ch) / 2;
    const axis = (t: number, view: number, size: number, off: number) =>
      scale * size >= view
        ? Math.min(-scale * off, Math.max(view - scale * (off + size), t))
        : (view - scale * size) / 2 - scale * off;
    tx = axis(tx, w, cw, ox);
    ty = axis(ty, h, ch, oy);
  }

  const distance = (t: TouchList) => Math.hypot(t[0]!.clientX - t[1]!.clientX, t[0]!.clientY - t[1]!.clientY);

  function onTouchMove(e: TouchEvent) {
    if (e.touches.length === 2) {
      const mx = (e.touches[0]!.clientX + e.touches[1]!.clientX) / 2;
      const my = (e.touches[0]!.clientY + e.touches[1]!.clientY) / 2;
      if (!pinch) {
        // Remember which point of the page is under the fingers, to keep it there.
        pinch = { dist: distance(e.touches), scale, px: (mx - tx) / scale, py: (my - ty) / scale };
        pan = null;
      }
      scale = Math.min(MAX_SCALE, Math.max(1, (pinch.scale * distance(e.touches)) / pinch.dist));
      tx = mx - scale * pinch.px;
      ty = my - scale * pinch.py;
      clampPan();
      suppressClick = true;
    } else if (e.touches.length === 1 && zoomed) {
      const t = e.touches[0]!;
      pan ??= { x: t.clientX, y: t.clientY, tx, ty };
      tx = pan.tx + t.clientX - pan.x;
      ty = pan.ty + t.clientY - pan.y;
      clampPan();
      if (Math.abs(t.clientX - pan.x) + Math.abs(t.clientY - pan.y) > 8) suppressClick = true;
    }
  }

  function go(i: number) {
    const next = Math.max(0, Math.min(pages.length, i));
    if (next === index) return;
    resetZoom();
    index = next;
    if (next >= pages.length) onEnd();
    else onPage(next);
  }

  const forward = () => go(index + 1);
  const backward = () => go(index - 1);

  function onClick(e: MouseEvent) {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    // While zoomed only the centre works (menu); turning pages would lose the zoom by accident.
    const x = e.clientX / window.innerWidth;
    if (zoomed) {
      if (x > 0.33 && x < 0.67) onToggleUi();
      return;
    }
    if (x > 0.33 && x < 0.67) return onToggleUi();
    const left = x <= 0.33;
    if (direction === "rtl") (left ? forward : backward)();
    else (left ? backward : forward)();
  }

  let startX = 0;
  let startY = 0;
  function onTouchStart(e: TouchEvent) {
    if (e.touches.length !== 1) return;
    // A new one-finger gesture: forget the previous one (iOS sends no click after a pinch).
    pan = null;
    suppressClick = false;
    startX = e.touches[0]!.clientX;
    startY = e.touches[0]!.clientY;
  }
  function onTouchEnd(e: TouchEvent) {
    if (e.touches.length < 2) pinch = null;
    if (e.touches.length === 0) pan = null;
    if (scale < 1.05 && scale !== 1) resetZoom();
    if (zoomed || suppressClick) return;
    const t = e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - startX;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(t.clientY - startY) * 1.5) return;
    const swipedLeft = dx < 0;
    // LTR: swipe left = next. RTL: swipe right = next.
    if (direction === "ltr" ? swipedLeft : !swipedLeft) forward();
    else backward();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "ArrowRight") (direction === "rtl" ? backward : forward)();
    if (e.key === "ArrowLeft") (direction === "rtl" ? forward : backward)();
  }

  onMount(() => {
    window.scrollTo(0, 0);
    onPage(index);
  });
</script>

<svelte:window onkeydown={onKey} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
  class="fixed inset-0 select-none"
  onclick={onClick}
  ontouchstart={onTouchStart}
  ontouchmove={onTouchMove}
  ontouchend={onTouchEnd}
  ondblclick={(e) => {
    // Double tap in the centre (the sides turn pages): zoom 2.5× on that point, or back to fit.
    if (zoomed) return resetZoom();
    const x = e.clientX / window.innerWidth;
    if (x <= 0.33 || x >= 0.67) return;
    scale = 2.5;
    tx = e.clientX - 2.5 * e.clientX;
    ty = e.clientY - 2.5 * e.clientY;
    clampPan();
  }}
  style="touch-action: none"
>
  {#each pages as src, i (src)}
    {#if Math.abs(i - index) <= 1}
      <img
        {src}
        alt="Página {i + 1}"
        decoding="async"
        referrerpolicy="no-referrer"
        draggable="false"
        class="absolute inset-0 h-full w-full origin-top-left object-contain {i === index ? '' : 'invisible'}"
        style={i === index && zoomed ? `transform: translate(${tx}px, ${ty}px) scale(${scale})` : undefined}
        onload={(e) => {
          const img = e.currentTarget as HTMLImageElement;
          if (!img.naturalWidth) return;
          shapes.set(i, img.naturalHeight / img.naturalWidth);
          onRatio?.(i, img.naturalHeight / img.naturalWidth);
        }}
      />
    {/if}
  {/each}
  {#if atEnd}
    <div class="absolute inset-0 flex items-center justify-center p-6">{@render footer()}</div>
  {/if}
</div>
