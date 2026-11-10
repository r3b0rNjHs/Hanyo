<script lang="ts">
  let {
    src,
    alt,
    class: cls = "",
    rounded = "rounded-[var(--radius-card)]",
  }: { src: string | null; alt: string; class?: string; rounded?: string } = $props();
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

<div class="relative aspect-[3/4] overflow-hidden bg-raised {rounded} {cls}">
  <!-- Typographic placeholder (as in the design), visible while the image loads or if it fails. -->
  <div class="absolute inset-0 flex items-end bg-accent/20 p-3" aria-hidden="true">
    <span class="font-display line-clamp-3 text-lg leading-[0.95] font-bold tracking-tight text-fg/90 uppercase">{alt}</span>
  </div>
  {#if src && !failed}
    <img
      src={attempt ? `${src}${src.includes("?") ? "&" : "?"}r=${attempt}` : src}
      {alt}
      loading="lazy"
      decoding="async"
      class="absolute inset-0 h-full w-full object-cover"
      onerror={onError}
    />
  {/if}
</div>
