<script lang="ts">
  import type { Snippet } from "svelte";
  let { title, subtitle, actions }: { title: string; subtitle?: string; actions?: Snippet } = $props();
</script>

<header class="pt-safe sticky top-0 z-20 bg-ink-950/85 backdrop-blur-xl">
  <div class="flex items-end justify-between gap-3 px-4 pt-3 pb-3">
    <div class="min-w-0">
      <h1 class="truncate text-[28px] leading-tight font-bold tracking-tight">{title}</h1>
      {#if subtitle}<p class="mt-0.5 text-sm text-ink-400">{subtitle}</p>{/if}
    </div>
    {#if actions}<div class="flex shrink-0 items-center gap-1">{@render actions()}</div>{/if}
  </div>
</header>
