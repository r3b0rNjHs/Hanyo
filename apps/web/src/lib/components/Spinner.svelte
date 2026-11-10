<script lang="ts">
  let { size = 22 }: { size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 24 24" class="animate-spin text-accent" aria-label="Cargando">
  <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-opacity=".2" stroke-width="3" fill="none" />
  <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="3" stroke-linecap="round" fill="none" />
</svg>
