<script lang="ts">
  import "@fontsource-variable/inter";
  import "@fontsource-variable/space-grotesk";
  import "../app.css";
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import { dev } from "$app/environment";
  import Icon from "$lib/components/Icon.svelte";
  import { downloads } from "$lib/offline/downloads.svelte";
  import { flushProgressQueue } from "$lib/offline/progress-queue";
  import { runAutoDownloads } from "$lib/offline/auto-download";
  import { feedBadge, refreshFeedBadge } from "$lib/feed-badge.svelte";
  import { watchInstall } from "$lib/install.svelte";
  import { connection } from "$lib/connection.svelte";

  let { children } = $props();

  const tabs = [
    { href: "/", label: "Biblioteca", icon: "library" },
    { href: "/updates", label: "Novedades", icon: "bell" },
    { href: "/explore", label: "Explorar", icon: "compass" },
    { href: "/downloads", label: "Descargas", icon: "download" },
  ] as const;

  const hideTabs = $derived(
    page.url.pathname.startsWith("/read/") || page.url.pathname === "/login" || page.url.pathname.startsWith("/invite/"),
  );

  function isActive(href: string): boolean {
    const p = page.url.pathname;
    // Search lives inside Explore; series pages and settings belong to the library.
    if (href === "/") return p === "/" || p.startsWith("/series/") || p.startsWith("/settings");
    if (href === "/explore") return p.startsWith("/explore") || p.startsWith("/search");
    if (href === "/updates") return p.startsWith("/updates") || p.startsWith("/stats");
    return p.startsWith(href);
  }

  onMount(() => {
    watchInstall();
    void downloads.init();
    if (!dev && "serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/service-worker.js", { type: "module" });
      // On the very first visit the library is fetched before the service worker controls the
      // page, so it never reaches the offline cache. Fetch it again once the worker is in charge.
      const warm = () => void fetch("/api/library", { credentials: "same-origin" }).catch(() => undefined);
      if (navigator.serviceWorker.controller) warm();
      else navigator.serviceWorker.addEventListener("controllerchange", warm, { once: true });
    }
    const online = () => {
      connection.online = true;
      void flushProgressQueue();
      downloads.resume();
    };
    const offline = () => (connection.online = false);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    if (navigator.onLine) void flushProgressQueue();
    // Automatic downloads on open and when the app returns to the foreground (throttled).
    const auto = () => {
      if (document.visibilityState !== "visible" || /^\/(login|invite)/.test(page.url.pathname)) return;
      void runAutoDownloads();
      void refreshFeedBadge();
    };
    setTimeout(auto, 3000);
    if (!/^\/(login|invite)/.test(page.url.pathname)) void refreshFeedBadge();
    document.addEventListener("visibilitychange", auto);
    return () => {
      document.removeEventListener("visibilitychange", auto);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  });
</script>

{#if !connection.online && !hideTabs}
  <!-- Sits just above the tab bar so it never covers a screen title. -->
  <div class="fixed inset-x-0 z-40 flex justify-center px-4 lg:bottom-6! lg:pl-[232px]" style="bottom: calc(var(--safe-bottom) + var(--tabbar-gap) + var(--tabbar-h) + 10px)" role="status">
    <div class="flex items-center gap-2 rounded-full border border-line bg-raised px-3.5 py-1.5 text-xs font-medium text-soft shadow-lg">
      <Icon name="cloudOff" size={14} /> Sin conexión · solo lo descargado
    </div>
  </div>
{/if}

<main class={hideTabs ? "" : "pb-tabbar lg:pl-[232px]"}>
  <!-- Wide screens: content in a centred column next to the sidebar. -->
  <div class={hideTabs ? "" : "lg:mx-auto lg:max-w-[1180px] lg:px-6"}>
    {@render children()}
  </div>
</main>

{#if !hideTabs}
  <!-- Desktop: a fixed sidebar replaces the floating tab bar. -->
  <nav aria-label="Navegación principal" class="fixed inset-y-0 left-0 z-30 hidden w-[232px] flex-col border-r border-line bg-surface/60 px-4 py-6 backdrop-blur-xl lg:flex">
    <a href="/" class="mb-8 flex items-center gap-3 px-2">
      <img src="/icons/icon.svg" alt="" class="h-9 w-9 rounded-[10px]" />
      <span class="font-display text-xl font-bold tracking-tight">Hanyo</span>
    </a>
    <ul class="space-y-1">
      {#each tabs as tab (tab.href)}
        <!-- Settings has its own entry here, so it doesn't light up Biblioteca. -->
        {@const active = isActive(tab.href) && !(tab.href === "/" && page.url.pathname.startsWith("/settings"))}
        <li>
          <a
            href={tab.href}
            aria-current={active ? "page" : undefined}
            class="relative flex h-11 items-center gap-3 rounded-2xl px-3 text-[15px] font-semibold transition-colors {active
              ? 'bg-accent text-on-accent'
              : 'text-soft hover:bg-fg/5'}"
          >
            <Icon name={tab.icon} size={20} stroke={2} />
            {tab.label}
            {#if (tab.href === "/updates" && feedBadge.unseen) || (tab.href === "/downloads" && (downloads.active || downloads.queue.length > 0))}
              <span class="ml-auto h-2 w-2 rounded-full {active ? 'bg-on-accent' : 'bg-fresh'}"></span>
            {/if}
          </a>
        </li>
      {/each}
    </ul>
    <a
      href="/settings"
      aria-current={page.url.pathname.startsWith("/settings") ? "page" : undefined}
      class="mt-auto flex h-11 items-center gap-3 rounded-2xl px-3 text-[15px] font-semibold {page.url.pathname.startsWith('/settings') ? 'bg-raised text-fg' : 'text-muted hover:bg-fg/5'}"
    >
      <Icon name="settings" size={20} stroke={2} /> Ajustes
    </a>
  </nav>

  <nav
    aria-label="Navegación principal"
    class="fixed inset-x-4 z-30 mx-auto max-w-md lg:hidden"
    style="bottom: calc(var(--safe-bottom) + var(--tabbar-gap))"
  >
    <ul
      class="flex h-[var(--tabbar-h)] gap-1 rounded-full border border-line bg-raised/95 p-[7px] shadow-[0_12px_30px_rgba(0,0,0,0.5)] backdrop-blur-xl"
    >
      {#each tabs as tab (tab.href)}
        {@const active = isActive(tab.href)}
        <!-- The active tab grows to fit its label; the others stay icon-only. -->
        <li class="min-w-0 transition-[flex-grow] duration-200 {active ? 'grow-[2.2]' : 'grow'} basis-0">
          <a
            href={tab.href}
            aria-label={tab.label}
            aria-current={active ? "page" : undefined}
            class="relative flex h-full items-center justify-center gap-1.5 rounded-full text-[13px] font-semibold transition-colors {active
              ? 'bg-accent text-on-accent'
              : 'text-muted active:bg-fg/5'}"
          >
            <Icon name={tab.icon} size={active ? 20 : 22} stroke={active ? 2.1 : 1.9} />
            {#if active}<span class="truncate">{tab.label}</span>{/if}
            {#if tab.href === "/updates" && !active && feedBadge.unseen}
              <span class="absolute top-3 right-[calc(50%-14px)] h-2 w-2 rounded-full bg-fresh" aria-label="Capítulos nuevos"></span>
            {/if}
            {#if tab.href === "/downloads" && !active && (downloads.active || downloads.queue.length > 0)}
              <span class="absolute top-3 right-[calc(50%-14px)] h-2 w-2 rounded-full bg-fresh"></span>
            {/if}
          </a>
        </li>
      {/each}
    </ul>
  </nav>
{/if}
