<script lang="ts">
  let { src, alt, class: cls = "" }: { src: string | null; alt: string; class?: string } = $props();
  let failed = $state(false);
</script>

<div class="relative aspect-[2/3] overflow-hidden rounded-xl bg-ink-800 {cls}">
  {#if src && !failed}
    <img
      {src}
      {alt}
      loading="lazy"
      decoding="async"
      class="h-full w-full object-cover"
      onerror={() => (failed = true)}
    />
  {:else}
    <div class="flex h-full w-full items-center justify-center p-3 text-center text-xs font-medium text-ink-400">
      {alt}
    </div>
  {/if}
</div>
