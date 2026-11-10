<script lang="ts">
  let { src, alt, class: cls = "" }: { src: string | null; alt: string; class?: string } = $props();
  let failed = $state(false);
  let retried = $state(false);
  let attempt = $state(0);

  // Sources rate-limit bursts of covers (e.g. a full search page); retry once before giving up.
  function onError() {
    if (retried) {
      failed = true;
      return;
    }
    retried = true;
    setTimeout(() => attempt++, 3000);
  }
</script>

<div class="relative aspect-[2/3] overflow-hidden rounded-xl bg-ink-800 {cls}">
  {#if src && !failed}
    <img
      src={attempt ? `${src}${src.includes("?") ? "&" : "?"}r=${attempt}` : src}
      {alt}
      loading="lazy"
      decoding="async"
      class="h-full w-full object-cover"
      onerror={onError}
    />
  {:else}
    <div class="flex h-full w-full items-center justify-center p-3 text-center text-xs font-medium text-ink-400">
      {alt}
    </div>
  {/if}
</div>
