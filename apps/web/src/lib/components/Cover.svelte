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
    <!-- Typographic placeholder, as in the design: the title set big on a solid block. -->
    <div class="flex h-full w-full items-end bg-accent/25 p-3">
      <span class="font-display line-clamp-3 text-lg leading-[0.95] font-bold tracking-tight text-fg uppercase">{alt}</span>
    </div>
  {/if}
</div>
