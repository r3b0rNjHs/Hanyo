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
      void fetch(pages[i]!, { credentials: "same-origin" }).catch(() => warmed.delete(i));
    }
  });

  export function jumpTo(i: number) {
    go(i);
  }

  function go(i: number) {
    const next = Math.max(0, Math.min(pages.length, i));
    if (next === index) return;
    index = next;
    if (next >= pages.length) onEnd();
    else onPage(next);
  }

  const forward = () => go(index + 1);
  const backward = () => go(index - 1);

  function onClick(e: MouseEvent) {
    const x = e.clientX / window.innerWidth;
    if (x > 0.33 && x < 0.67) return onToggleUi();
    const left = x <= 0.33;
    if (direction === "rtl") (left ? forward : backward)();
    else (left ? backward : forward)();
  }

  let startX = 0;
  let startY = 0;
  function onTouchStart(e: TouchEvent) {
    if (e.touches.length !== 1) return;
    startX = e.touches[0]!.clientX;
    startY = e.touches[0]!.clientY;
  }
  function onTouchEnd(e: TouchEvent) {
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
  ontouchend={onTouchEnd}
  style="touch-action: pinch-zoom"
>
  {#each pages as src, i (src)}
    {#if Math.abs(i - index) <= 1}
      <img
        {src}
        alt="Página {i + 1}"
        decoding="async"
        draggable="false"
        class="absolute inset-0 h-full w-full object-contain {i === index ? '' : 'invisible'}"
        onload={(e) => {
          const img = e.currentTarget as HTMLImageElement;
          if (img.naturalWidth) onRatio?.(i, img.naturalHeight / img.naturalWidth);
        }}
      />
    {/if}
  {/each}
  {#if atEnd}
    <div class="absolute inset-0 flex items-center justify-center p-6">{@render footer()}</div>
  {/if}
</div>
