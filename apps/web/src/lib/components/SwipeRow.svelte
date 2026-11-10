<script module lang="ts">
  /** Only one row open at a time, like iOS lists. */
  let openRow = $state<symbol | null>(null);
</script>

<script lang="ts">
  import type { Snippet } from "svelte";

  /**
   * Swipe left to reveal row actions (iOS Mail style). Vertical scrolling is untouched: the
   * gesture only takes over once it is clearly horizontal. Right-click opens it on desktop.
   */
  let {
    children,
    actions,
    width = 150,
  }: { children: Snippet; actions: Snippet<[() => void]>; width?: number } = $props();

  const id = Symbol("row");
  const open = $derived(openRow === id);
  let dx = $state(0);
  let dragging = $state(false);
  let startX = 0;
  let startY = 0;
  let base = 0;
  let axis: "h" | "v" | null = null;
  let swiped = false;

  const close = () => {
    if (openRow === id) openRow = null;
  };

  $effect(() => {
    if (!dragging) dx = open ? -width : 0;
  });

  function onStart(e: TouchEvent) {
    const t = e.touches[0]!;
    startX = t.clientX;
    startY = t.clientY;
    base = open ? -width : 0;
    axis = null;
    swiped = false;
  }

  function onMove(e: TouchEvent) {
    const t = e.touches[0]!;
    const ddx = t.clientX - startX;
    const ddy = t.clientY - startY;
    if (!axis) {
      if (Math.abs(ddx) < 8 && Math.abs(ddy) < 8) return;
      axis = Math.abs(ddx) > Math.abs(ddy) ? "h" : "v";
    }
    if (axis !== "h") return;
    dragging = true;
    swiped = true;
    dx = Math.min(0, Math.max(-width - 24, base + ddx));
  }

  function onEnd() {
    if (axis === "h") openRow = dx < -width / 2 ? id : open ? null : openRow;
    dragging = false;
  }

  /** A swipe or tapping an open row must not follow the link underneath. */
  function onClickCapture(e: MouseEvent) {
    if (swiped || open) {
      e.preventDefault();
      e.stopPropagation();
      if (!swiped) close();
      swiped = false;
    }
  }
</script>

<div class="relative overflow-hidden">
  <div class="absolute inset-y-0 right-0 flex" style="width: {width}px" aria-hidden={!open}>
    {@render actions(close)}
  </div>
  <div
    class="relative bg-base"
    style="transform: translateX({dx}px); transition: {dragging ? 'none' : 'transform 0.22s ease'}"
    ontouchstart={onStart}
    ontouchmove={onMove}
    ontouchend={onEnd}
    onclickcapture={onClickCapture}
    oncontextmenu={(e) => {
      e.preventDefault();
      openRow = open ? null : id;
    }}
    role="presentation"
  >
    {@render children()}
  </div>
</div>
