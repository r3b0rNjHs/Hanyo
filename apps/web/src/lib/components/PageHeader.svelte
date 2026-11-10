<script lang="ts">
  import type { Snippet } from "svelte";
  let { title, subtitle, actions }: { title: string; subtitle?: string; actions?: Snippet } = $props();
</script>

<header class="pt-safe sticky top-0 z-20 bg-base/90 backdrop-blur-xl">
  <div class="flex items-center justify-between gap-3 px-5 pt-4 pb-3">
    <div class="min-w-0">
      <h1 class="font-display truncate text-[30px] leading-tight font-bold tracking-[-0.03em]">{title}</h1>
      {#if subtitle}<p class="mt-0.5 text-sm text-muted">{subtitle}</p>{/if}
    </div>
    {#if actions}<div class="flex shrink-0 items-center gap-2">{@render actions()}</div>{/if}
  </div>
</header>
