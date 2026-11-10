<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { api } from "$lib/api";
  import Icon from "$lib/components/Icon.svelte";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import { readerSettings } from "$lib/reader/settings.svelte";

  let standalone = $state(false);
  let push = $state<"unsupported" | "disabled-server" | "off" | "on" | "denied">("off");
  let pushMsg = $state<string | null>(null);

  onMount(async () => {
    standalone = matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      push = "unsupported";
      return;
    }
    const key = await api.pushKey().catch(() => null);
    if (!key?.enabled) {
      push = "disabled-server";
      return;
    }
    if (Notification.permission === "denied") push = "denied";
    else {
      const reg = await navigator.serviceWorker.getRegistration();
      push = (await reg?.pushManager.getSubscription()) ? "on" : "off";
    }
  });

  async function enablePush() {
    pushMsg = null;
    try {
      const key = await api.pushKey();
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        push = "denied";
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key.publicKey!),
      });
      await api.pushSubscribe(sub.toJSON());
      push = "on";
      await api.pushTest();
    } catch (e) {
      pushMsg = (e as Error).message;
    }
  }

  function urlBase64ToUint8Array(b64: string): Uint8Array<ArrayBuffer> {
    const pad = "=".repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  }

  async function logout() {
    await api.logout().catch(() => null);
    await goto("/login");
  }
</script>

<PageHeader title="Ajustes" />

<div class="space-y-6 px-4">
  {#if !standalone}
    <section class="rounded-[var(--radius-card)] border border-accent/40 bg-accent/10 p-4 text-sm">
      <p class="font-semibold text-accent-soft">Instala Hanyo en tu iPhone</p>
      <p class="mt-1 text-soft">
        En Safari pulsa <b>Compartir</b> → <b>Añadir a pantalla de inicio</b>. Así las descargas no se borran y
        puedes recibir avisos de capítulos nuevos.
      </p>
    </section>
  {/if}

  <section>
    <h2 class="mb-2 px-1 text-xs font-semibold tracking-[0.08em] text-muted uppercase">Lector</h2>
    <div class="divide-y divide-white/5 rounded-[var(--radius-card)] bg-surface">
      <label class="flex items-center justify-between px-4 py-3">
        <span>Modo por defecto</span>
        <select bind:value={readerSettings.defaultMode} class="rounded-full bg-raised px-3 py-1.5 text-sm text-soft">
          <option value="auto">Automático</option>
          <option value="vertical">Vertical (manhwa)</option>
          <option value="rtl">Páginas ← (manga)</option>
          <option value="ltr">Páginas →</option>
        </select>
      </label>
      <label class="flex items-center justify-between px-4 py-3">
        <span>Fondo</span>
        <select bind:value={readerSettings.background} class="rounded-full bg-raised px-3 py-1.5 text-sm text-soft">
          <option value="black">Negro</option>
          <option value="gray">Gris</option>
          <option value="white">Blanco</option>
        </select>
      </label>
      <label class="flex items-center justify-between px-4 py-3">
        <span>Mantener pantalla encendida</span>
        <input type="checkbox" bind:checked={readerSettings.keepAwake} class="switch" />
      </label>
      <label class="flex items-center justify-between px-4 py-3">
        <span>Mostrar número de página</span>
        <input type="checkbox" bind:checked={readerSettings.showPageNumber} class="switch" />
      </label>
      <label class="block px-4 py-3">
        <span class="flex justify-between"><span>Brillo</span><span class="text-muted">{Math.round(readerSettings.brightness * 100)}%</span></span>
        <input type="range" min="0.3" max="1" step="0.05" bind:value={readerSettings.brightness} class="mt-2 w-full accent-[var(--color-accent)]" />
      </label>
    </div>
  </section>

  <section>
    <h2 class="mb-2 px-1 text-xs font-semibold tracking-[0.08em] text-muted uppercase">Notificaciones</h2>
    <div class="rounded-[var(--radius-card)] bg-surface px-4 py-3">
      <div class="flex items-center justify-between gap-3">
        <span class="flex items-center gap-2"><Icon name="bell" size={18} /> Capítulos nuevos</span>
        {#if push === "on"}
          <span class="flex items-center gap-1.5 text-sm text-ok"><Icon name="check" size={16} stroke={2.6} /> Activadas</span>
        {:else if push === "off"}
          <button class="h-9 rounded-full bg-accent px-4 text-sm font-semibold text-on-accent" onclick={enablePush}>Activar</button>
        {/if}
      </div>
      {#if push === "unsupported"}<p class="mt-2 text-xs text-muted">Instala la app en la pantalla de inicio (iOS 16.4+) para recibir avisos.</p>{/if}
      {#if push === "disabled-server"}<p class="mt-2 text-xs text-muted">El servidor no tiene las notificaciones configuradas.</p>{/if}
      {#if push === "denied"}<p class="mt-2 text-xs text-muted">Permiso denegado. Actívalo en Ajustes de iOS → Notificaciones → Hanyo.</p>{/if}
      {#if pushMsg}<p class="mt-2 text-xs text-danger">{pushMsg}</p>{/if}
    </div>
  </section>

  <button class="w-full rounded-[var(--radius-card)] bg-surface py-3 text-danger" onclick={logout}>Cerrar sesión</button>
  <p class="pb-4 text-center text-xs text-faint">Hanyo 0.1</p>
</div>
