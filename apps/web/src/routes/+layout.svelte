<script lang="ts">
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
  <div
    class="pt-safe fixed inset-x-0 top-0 z-40 flex items-center justify-center gap-2 bg-ink-800/95 pb-1.5 text-xs font-medium text-ink-200"
  >
    <Icon name="cloudOff" size={14} /> Sin conexión · solo contenido descargado
  </div>
{/if}

<main class={hideTabs ? "" : "pb-tabbar"}>
  {@render children()}
</main>

{#if !hideTabs}
  <nav
    class="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-white/5 bg-ink-900/90 backdrop-blur-xl"
    aria-label="Navegación principal"
  >
    <ul class="mx-auto flex h-[var(--tabbar-h)] max-w-lg items-stretch">
      {#each tabs as tab (tab.href)}
        {@const active = isActive(tab.href)}
        <li class="flex-1">
          <a
            href={tab.href}
            class="flex h-full flex-col items-center justify-center gap-0.5 text-[10.5px] font-medium transition-colors {active
              ? 'text-hanji-300'
              : 'text-ink-500'}"
            aria-current={active ? "page" : undefined}
          >
            <span class="relative">
              <Icon name={tab.icon} size={24} stroke={active ? 2.2 : 1.8} />
              {#if tab.href === "/downloads" && (downloads.active || downloads.queue.length > 0)}
                <span class="absolute -top-0.5 -right-1 h-2 w-2 rounded-full bg-hanji-400"></span>
              {/if}
            </span>
            {tab.label}
          </a>
        </li>
      {/each}
    </ul>
  </nav>
{/if}
