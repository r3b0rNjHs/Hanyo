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
  import { connection } from "$lib/connection.svelte";

  let { children } = $props();

  const tabs = [
    { href: "/", label: "Biblioteca", icon: "library" },
    { href: "/search", label: "Buscar", icon: "search" },
    { href: "/downloads", label: "Descargas", icon: "download" },
    { href: "/settings", label: "Ajustes", icon: "settings" },
  ] as const;

  const hideTabs = $derived(page.url.pathname.startsWith("/read/") || page.url.pathname === "/login");

  function isActive(href: string): boolean {
    const p = page.url.pathname;
    return href === "/" ? p === "/" || p.startsWith("/series/") : p.startsWith(href);
  }

  onMount(() => {
    void downloads.init();
    if (!dev && "serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/service-worker.js", { type: "module" });
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
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  });
</script>

{#if !connection.online && !hideTabs}
  <!-- Sits just above the tab bar so it never covers a screen title. -->
  <div class="fixed inset-x-0 z-40 flex justify-center px-4" style="bottom: calc(var(--safe-bottom) + var(--tabbar-gap) + var(--tabbar-h) + 10px)" role="status">
    <div class="flex items-center gap-2 rounded-full border border-line bg-raised px-3.5 py-1.5 text-xs font-medium text-soft shadow-lg">
      <Icon name="cloudOff" size={14} /> Sin conexión · solo lo descargado
    </div>
  </div>
{/if}

<main class={hideTabs ? "" : "pb-tabbar"}>
  {@render children()}
</main>

{#if !hideTabs}
  <nav
    aria-label="Navegación principal"
    class="fixed inset-x-4 z-30 mx-auto max-w-md"
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
              : 'text-muted active:bg-white/5'}"
          >
            <Icon name={tab.icon} size={active ? 20 : 22} stroke={active ? 2.1 : 1.9} />
            {#if active}<span class="truncate">{tab.label}</span>{/if}
            {#if tab.href === "/downloads" && !active && (downloads.active || downloads.queue.length > 0)}
              <span class="absolute top-3 right-[calc(50%-14px)] h-2 w-2 rounded-full bg-fresh"></span>
            {/if}
          </a>
        </li>
      {/each}
    </ul>
  </nav>
{/if}
