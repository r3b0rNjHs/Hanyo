<script lang="ts">
  import type { Snippet } from "svelte";
  import { onMount, tick, untrack } from "svelte";

  /**
   * Long-strip (webtoon) reader.
   * - Uses the document scroller (native iOS momentum, toolbar behaviour).
   * - Only a window of pages around the current one has a mounted <img>; the rest keep a
   *   sized placeholder. iOS kills PWAs that hold too many decoded tall images.
   * - Safari has no scroll anchoring, so when a page ABOVE the viewport learns its real
   *   height we compensate the scroll position ourselves.
   */
  let {
    pages,
    initialPage = 0,
    initialOffset = 0,
    onPage,
    onOffset,
    onEnd,
    onTap,
    onRatio,
    footer,
  }: {
    pages: string[];
    initialPage?: number;
    /** Where inside the initial page to start (0–1), restored once that page has its real height. */
    initialOffset?: number;
    onPage: (index: number) => void;
    /** Position inside the current page (0–1) while scrolling. */
    onOffset?: (offset: number) => void;
    onEnd: () => void;
    onTap: (zone: "prev" | "menu" | "next") => void;
    onRatio?: (index: number, ratio: number) => void;
    footer: Snippet;
  } = $props();

  const BEHIND = 3;
  const AHEAD = 6;
  const DEFAULT_RATIO = 1.45;

  // The reader is re-created (keyed) on every chapter or mode change, so only the
  // initial props matter here; untrack makes that explicit.
  let ratios = $state<number[]>(untrack(() => pages.map(() => DEFAULT_RATIO)));
  let current = $state(untrack(() => initialPage));
  let slots: HTMLDivElement[] = $state([]);
  let endSentinel: HTMLDivElement;

  const mounted = (i: number) => i >= current - BEHIND && i <= current + AHEAD;

  /** Pending intra-page restore; dropped as soon as the reader touches the screen. */
  let pendingOffset = untrack(() => (initialOffset > 0.005 ? { index: initialPage, offset: initialOffset } : null));
  const cancelPending = () => (pendingOffset = null);

  async function restoreOffset(i: number) {
    if (!pendingOffset || pendingOffset.index !== i) return;
    const { offset } = pendingOffset;
    pendingOffset = null;
    await tick();
    const r = slots[i]?.getBoundingClientRect();
    if (r) window.scrollBy(0, r.top + offset * r.height);
  }

  async function onLoad(i: number, img: HTMLImageElement) {
    if (!img.naturalWidth) return;
    const ratio = img.naturalHeight / img.naturalWidth;
    onRatio?.(i, ratio);
    if (Math.abs(ratio - ratios[i]!) < 0.001) return void restoreOffset(i);
    const el = slots[i];
    const before = el?.getBoundingClientRect();
    ratios[i] = ratio;
    await tick();
    if (el && before && before.bottom <= 0) {
      window.scrollBy(0, el.getBoundingClientRect().height - before.height);
    }
    void restoreOffset(i);
  }

  let ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const line = window.innerHeight * 0.4;
      let i = current;
      while (i > 0 && slots[i]!.getBoundingClientRect().top > line) i--;
      while (i < pages.length - 1 && slots[i]!.getBoundingClientRect().bottom < line) i++;
      if (i !== current) {
        current = i;
        onPage(i);
      }
      if (!pendingOffset && onOffset) {
        const r = slots[i]!.getBoundingClientRect();
        onOffset(Math.min(1, Math.max(0, -r.top / r.height)));
      }
    });
  }

  function onClick(e: MouseEvent) {
    const y = e.clientY / window.innerHeight;
    if (y < 0.28) {
      onTap("prev");
      window.scrollBy({ top: -window.innerHeight * 0.8, behavior: "smooth" });
    } else if (y > 0.72) {
      onTap("next");
      window.scrollBy({ top: window.innerHeight * 0.8, behavior: "smooth" });
    } else onTap("menu");
  }

  export function jumpTo(index: number) {
    current = index;
    void tick().then(() => slots[index]?.scrollIntoView({ block: "start" }));
    onPage(index);
  }

  onMount(() => {
    if (initialPage > 0) jumpTo(initialPage);
    else window.scrollTo(0, 0);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("touchstart", cancelPending, { passive: true, once: true });
    window.addEventListener("wheel", cancelPending, { passive: true, once: true });
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) onEnd();
      },
      { rootMargin: "0px 0px 20% 0px" },
    );
    io.observe(endSentinel);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("touchstart", cancelPending);
      window.removeEventListener("wheel", cancelPending);
      io.disconnect();
    };
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="mx-auto max-w-3xl select-none" onclick={onClick} style="touch-action: manipulation">
  {#each pages as src, i (src)}
    <div bind:this={slots[i]} class="relative w-full" style="aspect-ratio: 1 / {ratios[i]}; content-visibility: auto">
      {#if mounted(i)}
        <img
          {src}
          alt="Página {i + 1}"
          decoding="async"
          referrerpolicy="no-referrer"
          draggable="false"
          class="block h-full w-full"
          onload={(e) => onLoad(i, e.currentTarget as HTMLImageElement)}
        />
      {:else}
        <div class="flex h-full w-full items-center justify-center text-xs text-white/20">{i + 1}</div>
      {/if}
    </div>
  {/each}
  <div bind:this={endSentinel} class="h-px"></div>
</div>
{@render footer()}
