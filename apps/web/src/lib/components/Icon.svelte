<script lang="ts">
  // Minimal inline icon set (24px, stroke-based) to avoid an icon dependency.
  const paths = {
    library: "M4 19.5V5a2 2 0 0 1 2-2h3v18H6a2 2 0 0 1-2-1.5ZM9 3h4v18H9M13 4.2l3.6-1a1.5 1.5 0 0 1 1.85 1.05l3.3 12.3a1.5 1.5 0 0 1-1.05 1.84l-3.6.97",
    search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm10 2-4.35-4.35",
    download: "M12 3v12m0 0 5-5m-5 5-5-5M5 21h14",
    settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7.6 7.6 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7.6 7.6 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.07-.4.1-.8.1-1.2Z",
    back: "M15 18l-6-6 6-6",
    plus: "M12 5v14M5 12h14",
    check: "M5 12.5l4.5 4.5L19 7",
    close: "M6 6l12 12M18 6 6 18",
    play: "M8 5.5v13l11-6.5-11-6.5Z",
    refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
    trash: "M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3",
    cloudOff: "M3 3l18 18M8.5 8.6A5 5 0 0 0 7 18h10.5m2.6-1.6A4 4 0 0 0 17 10h-.6A6 6 0 0 0 10 6.1",
    more: "M5 12h.01M12 12h.01M19 12h.01",
    list: "M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01",
    vertical: "M7 3h10v7H7zM7 14h10v7H7z",
    paged: "M3 5h8v14H3zM13 5h8v14h-8z",
    bell: "M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9Zm4.3 13a2 2 0 0 0 3.4 0",
    layers: "M12 3 2 8l10 5 10-5-10-5Zm-10 9 10 5 10-5M2 16l10 5 10-5",
    eye: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  } as const;

  let {
    name,
    size = 22,
    stroke = 1.9,
    class: cls = "",
  }: { name: keyof typeof paths; size?: number; stroke?: number; class?: string } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width={stroke}
  stroke-linecap="round"
  stroke-linejoin="round"
  class={cls}
  aria-hidden="true"
>
  <path d={paths[name]} />
</svg>
