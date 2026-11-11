<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { api } from "$lib/api";
  import Icon from "$lib/components/Icon.svelte";
  import Spinner from "$lib/components/Spinner.svelte";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import { readerSettings } from "$lib/reader/settings.svelte";
  import { formatBytes } from "$lib/format";
  import { endSession, loadSession, session } from "$lib/session.svelte";
  import { currentTheme, setTheme, type Theme } from "$lib/theme";
  import type { ServerStats, SourceHealth } from "@hanyo/types";
  import { timeAgo } from "$lib/format";
  import { install, isIos, promptInstall } from "$lib/install.svelte";

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

  let theme = $state<Theme>(currentTheme());
  $effect(() => setTheme(theme));

  let health = $state<SourceHealth[] | null>(null);
  let checkingSources = $state(false);
  let showAllSources = $state(false);
  $effect(() => {
    api.sourceHealth().then((h) => (health = h), () => (health = null));
  });
  async function checkSources() {
    checkingSources = true;
    try {
      health = await api.checkSources();
    } catch {
      // keep the previous list
    } finally {
      checkingSources = false;
    }
  }
  const broken = $derived((health ?? []).filter((h) => !h.ok));
  const lastCheck = $derived(health?.length ? Math.max(...health.map((h) => h.checkedAt)) : null);

  let stats = $state<ServerStats | null>(null);
  $effect(() => {
    api.serverStats().then((r) => (stats = r), () => (stats = null));
  });

  function uptime(sec: number): string {
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    return d ? `${d} d ${h} h` : h ? `${h} h` : `${Math.max(1, Math.floor(sec / 60))} min`;
  }

  let relinkMsg = $state<string | null>(null);
  async function relink() {
    relinkMsg = "Buscando…";
    try {
      const r = await api.relinkLibrary();
      relinkMsg = `Buscando fuentes para ${r.series} series en segundo plano. Tardará unos minutos.`;
    } catch (e) {
      relinkMsg = (e as Error).message;
    }
  }

  async function logout() {
    await endSession();
    await goto("/login");
  }

  // ── Account ──
  let accountOpen = $state(false);
  let current = $state("");
  let newUsername = $state("");
  let newPassword = $state("");
  let accountMsg = $state<{ ok: boolean; text: string } | null>(null);
  let accountBusy = $state(false);
  $effect(() => {
    void loadSession().then((u) => {
      if (u && !newUsername) newUsername = u.username;
    });
  });
  // ── Accounts (admins) ──
  type Account = Awaited<ReturnType<typeof api.adminUsers>>[number];
  let accounts = $state<Account[] | null>(null);
  let invites = $state<{ token: string; createdAt: number; expiresAt: number }[]>([]);
  let inviteMsg = $state<string | null>(null);
  let confirmDelete = $state<Account | null>(null);
  const inviteUrl = (t: string) => `${location.origin}/invite/${t}`;
  $effect(() => {
    if (!session.user?.isAdmin) return;
    void reloadAccounts();
  });
  async function reloadAccounts() {
    [accounts, invites] = await Promise.all([api.adminUsers(), api.invites()]).catch(() => [accounts, invites] as const);
  }
  async function newInvite() {
    const inv = await api.createInvite();
    await reloadAccounts();
    await shareInvite(inv.token);
  }
  async function shareInvite(token: string) {
    const url = inviteUrl(token);
    try {
      if (navigator.share) await navigator.share({ title: "Hanyo", text: "Te invito a Hanyo", url });
      else {
        await navigator.clipboard.writeText(url);
        inviteMsg = "Enlace copiado";
      }
    } catch {
      // Share sheet closed: nothing to do.
    }
  }
  async function copyInvite(token: string) {
    await navigator.clipboard.writeText(inviteUrl(token)).catch(() => undefined);
    inviteMsg = "Enlace copiado";
    setTimeout(() => (inviteMsg = null), 2000);
  }
  async function revoke(token: string) {
    await api.revokeInvite(token).catch(() => undefined);
    await reloadAccounts();
  }
  async function deleteAccount(a: Account) {
    confirmDelete = null;
    try {
      await api.deleteUser(a.id);
    } catch (e) {
      inviteMsg = (e as Error).message;
    }
    await reloadAccounts();
  }
  const fmtDate = (ms: number) => new Date(ms).toLocaleDateString("es-ES", { day: "numeric", month: "short" });

  async function saveAccount(e: SubmitEvent) {
    e.preventDefault();
    accountBusy = true;
    accountMsg = null;
    try {
      const r = await api.updateAccount({
        currentPassword: current,
        username: newUsername.trim() || undefined,
        password: newPassword || undefined,
      });
      session.user = r.user;
      current = "";
      newPassword = "";
      accountMsg = { ok: true, text: "Guardado. Los demás dispositivos tendrán que volver a entrar si cambiaste la contraseña." };
    } catch (err) {
      accountMsg = { ok: false, text: (err as Error).message };
    } finally {
      accountBusy = false;
    }
  }
</script>

<!-- Lists read best in a column on wide screens. -->
<div class="lg:mx-auto lg:max-w-2xl">

<PageHeader title="Ajustes" />

<div class="space-y-6 px-4">
  <section>
    <h2 class="mb-2 px-1 text-xs font-semibold tracking-[0.08em] text-muted uppercase">Cuenta</h2>
    <div class="rounded-[var(--radius-card)] bg-surface">
      <div class="flex items-center justify-between gap-3 px-4 py-3">
        <span class="flex min-w-0 items-center gap-3">
          <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/20 font-bold text-accent-soft uppercase">{session.user?.username.slice(0, 1) ?? "·"}</span>
          <span class="min-w-0">
            <span class="block truncate font-semibold">{session.user?.username ?? "…"}</span>
            <span class="block text-xs text-muted">{session.user?.isAdmin ? "Administrador" : "Usuario"}</span>
          </span>
        </span>
        <button class="h-9 shrink-0 rounded-full bg-raised px-4 text-sm font-semibold" onclick={() => (accountOpen = !accountOpen)} aria-expanded={accountOpen}>
          {accountOpen ? "Cerrar" : "Editar"}
        </button>
      </div>
      {#if accountOpen}
        <form class="space-y-2 border-t border-fg/5 px-4 py-3" onsubmit={saveAccount}>
          <label class="block text-xs text-muted" for="acc-user">Usuario</label>
          <input id="acc-user" bind:value={newUsername} autocomplete="username" autocapitalize="none" class="h-11 w-full rounded-full bg-raised px-4 text-[15px] outline-none focus:ring-2 focus:ring-accent/60" />
          <label class="block text-xs text-muted" for="acc-new">Nueva contraseña (opcional, mínimo 8)</label>
          <input id="acc-new" type="password" bind:value={newPassword} autocomplete="new-password" class="h-11 w-full rounded-full bg-raised px-4 text-[15px] outline-none focus:ring-2 focus:ring-accent/60" />
          <label class="block text-xs text-muted" for="acc-cur">Contraseña actual</label>
          <input id="acc-cur" type="password" bind:value={current} required autocomplete="current-password" class="h-11 w-full rounded-full bg-raised px-4 text-[15px] outline-none focus:ring-2 focus:ring-accent/60" />
          {#if accountMsg}<p class="text-xs {accountMsg.ok ? 'text-ok' : 'text-danger'}" role="status">{accountMsg.text}</p>{/if}
          <button class="h-11 w-full rounded-full bg-accent font-bold text-on-accent disabled:opacity-50" disabled={accountBusy || !current}>
            {accountBusy ? "Guardando…" : "Guardar"}
          </button>
        </form>
      {/if}
    </div>
  </section>

  {#if !standalone && !install.installed}
    {#if install.available}
      <!-- Chrome / Edge (desktop and Android) can install it with one click. -->
      <section class="flex items-center gap-4 rounded-[var(--radius-card)] border border-accent/40 bg-accent/10 p-4 text-sm">
        <img src="/icons/icon-192.png" alt="" class="h-12 w-12 shrink-0 rounded-[14px]" />
        <span class="min-w-0 flex-1">
          <span class="block font-semibold text-accent-soft">Instala Hanyo como aplicación</span>
          <span class="block text-soft">Con su propia ventana e icono, y funcionando sin conexión.</span>
        </span>
        <button class="h-10 shrink-0 rounded-full bg-accent px-4 font-bold text-on-accent" onclick={() => promptInstall()}>Instalar</button>
      </section>
    {:else if isIos()}
      <section class="rounded-[var(--radius-card)] border border-accent/40 bg-accent/10 p-4 text-sm">
        <p class="font-semibold text-accent-soft">Instala Hanyo en tu iPhone</p>
        <p class="mt-1 text-soft">
          En Safari pulsa <b>Compartir</b> → <b>Añadir a pantalla de inicio</b>. Así las descargas no se borran y
          puedes recibir avisos de capítulos nuevos.
        </p>
      </section>
    {:else}
      <section class="rounded-[var(--radius-card)] border border-line bg-surface p-4 text-sm">
        <p class="font-semibold">Instala Hanyo en este ordenador</p>
        <p class="mt-1 text-soft">
          En Chrome o Edge, pulsa el icono de instalar en la barra de direcciones (o el menú ⋮ → <b>Instalar Hanyo</b>).
          En Safari para Mac: <b>Archivo</b> → <b>Añadir al Dock</b>.
        </p>
      </section>
    {/if}
  {/if}

  {#if session.user?.isAdmin && accounts}
    <section>
      <h2 class="mb-2 px-1 text-xs font-semibold tracking-[0.08em] text-muted uppercase">Cuentas</h2>
      <div class="rounded-[var(--radius-card)] bg-surface text-sm">
        <ul class="divide-y divide-fg/5">
          {#each accounts as a (a.id)}
            <li class="flex items-center gap-3 px-4 py-2.5">
              <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-raised text-xs font-bold uppercase">{a.username.slice(0, 1)}</span>
              <span class="min-w-0 flex-1">
                <span class="block truncate font-semibold">{a.username}{a.id === session.user.id ? " (tú)" : ""}</span>
                <span class="block text-xs text-muted">
                  {a.isAdmin ? "Administrador · " : ""}{a.librarySize} series{a.lastReadAt ? ` · leyó el ${fmtDate(a.lastReadAt)}` : ""}
                </span>
              </span>
              {#if a.id !== session.user.id}
                <button class="h-8 rounded-full px-3 text-xs font-semibold text-danger" onclick={() => (confirmDelete = a)}>Eliminar</button>
              {/if}
            </li>
          {/each}
        </ul>
        {#if invites.length}
          <div class="border-t border-fg/5 px-4 py-2.5">
            <p class="text-xs font-semibold text-muted">Invitaciones pendientes</p>
            {#each invites as inv (inv.token)}
              <div class="mt-1.5 flex items-center gap-2">
                <span class="min-w-0 flex-1 truncate text-xs text-soft">Caduca el {fmtDate(inv.expiresAt)}</span>
                <button class="h-8 rounded-full bg-raised px-3 text-xs font-semibold" onclick={() => copyInvite(inv.token)}>Copiar</button>
                <button class="h-8 rounded-full px-3 text-xs font-semibold text-danger" onclick={() => revoke(inv.token)}>Anular</button>
              </div>
            {/each}
          </div>
        {/if}
        <button class="flex w-full items-center justify-center gap-2 border-t border-fg/5 py-3 font-semibold text-accent-soft" onclick={newInvite}>
          <Icon name="plus" size={16} stroke={2.4} /> Invitar a alguien
        </button>
        {#if inviteMsg}<p class="px-4 pb-3 text-center text-xs text-muted" role="status">{inviteMsg}</p>{/if}
      </div>
      <p class="mt-1.5 px-1 text-xs text-faint">El enlace es de un solo uso y caduca en 7 días. Cada cuenta tiene su biblioteca y su progreso; nadie ve lo de los demás.</p>
    </section>
  {/if}

  {#if confirmDelete}
    {@const a = confirmDelete}
    <button class="fixed inset-0 z-40 bg-black/60" onclick={() => (confirmDelete = null)} aria-label="Cerrar"></button>
    <div class="pb-safe fixed inset-x-0 bottom-0 z-50 rounded-t-[28px] bg-raised p-5" role="alertdialog" aria-label="Eliminar cuenta">
      <p class="font-display text-lg font-semibold">¿Eliminar la cuenta de {a.username}?</p>
      <p class="mt-1 text-sm text-muted">Se borran su biblioteca, listas, progreso e historial. Las series siguen disponibles para los demás.</p>
      <button class="mt-4 h-12 w-full rounded-full bg-danger font-bold text-white" onclick={() => deleteAccount(a)}>Eliminar cuenta</button>
      <button class="mt-1 h-12 w-full rounded-full font-semibold text-muted" onclick={() => (confirmDelete = null)}>Cancelar</button>
    </div>
  {/if}

  <section>
    <h2 class="mb-2 px-1 text-xs font-semibold tracking-[0.08em] text-muted uppercase">Apariencia</h2>
    <div class="grid grid-cols-3 gap-1 rounded-full bg-surface p-1" role="radiogroup" aria-label="Tema">
      {#each [["dark", "Oscuro"], ["light", "Claro"], ["system", "Sistema"]] as const as [t, label] (t)}
        <button
          role="radio"
          aria-checked={theme === t}
          onclick={() => (theme = t)}
          class="h-9 rounded-full text-[13px] font-semibold {theme === t ? 'bg-accent text-on-accent' : 'text-soft'}"
        >{label}</button>
      {/each}
    </div>
  </section>

  <section>
    <h2 class="mb-2 px-1 text-xs font-semibold tracking-[0.08em] text-muted uppercase">Lector</h2>
    <div class="divide-y divide-fg/5 rounded-[var(--radius-card)] bg-surface">
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
      <label class="flex items-center justify-between gap-3 px-4 py-3">
        <span>
          <span class="block">Precargar el siguiente capítulo</span>
          <span class="block text-xs text-muted">Se abre al instante, también si pierdes la conexión</span>
        </span>
        <input type="checkbox" bind:checked={readerSettings.prefetchNext} class="switch shrink-0" />
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

  <section>
    <h2 class="mb-2 px-1 text-xs font-semibold tracking-[0.08em] text-muted uppercase">Biblioteca</h2>
    <div class="rounded-[var(--radius-card)] bg-surface px-4 py-3">
      <div class="flex items-center justify-between gap-3">
        <span>Buscar fuentes nuevas</span>
        <button class="h-9 rounded-full bg-raised px-4 text-sm font-semibold" onclick={relink}>Buscar</button>
      </div>
      <p class="mt-2 text-xs text-muted">
        {relinkMsg ?? "Vincula cada serie de tu biblioteca con todas las fuentes disponibles. También se hace solo tras cada actualización."}
      </p>
    </div>
  </section>

  {#if health}
    <section>
      <h2 class="mb-2 px-1 text-xs font-semibold tracking-[0.08em] text-muted uppercase">Fuentes</h2>
      <div class="rounded-[var(--radius-card)] bg-surface text-sm">
        <div class="flex items-center justify-between gap-3 px-4 py-3">
          <span class="min-w-0">
            <span class="flex items-center gap-2 font-semibold">
              <span class="h-2 w-2 rounded-full {broken.length ? 'bg-danger' : health.length ? 'bg-ok' : 'bg-faint'}"></span>
              {#if !health.length}Sin comprobar{:else if broken.length}{broken.length} {broken.length === 1 ? "fuente no funciona" : "fuentes no funcionan"}{:else}Todas funcionan ({health.length}){/if}
            </span>
            <span class="block text-xs text-muted">
              {lastCheck ? `Comprobado ${timeAgo(lastCheck)} · ` : ""}se revisan solas cada día y te avisamos si alguna falla
            </span>
          </span>
          <button class="h-9 shrink-0 rounded-full bg-raised px-4 text-sm font-semibold" disabled={checkingSources} onclick={checkSources}>
            {#if checkingSources}<Spinner size={16} />{:else}Comprobar{/if}
          </button>
        </div>
        {#if health.length}
          <ul class="divide-y divide-fg/5 border-t border-fg/5">
            {#each showAllSources ? health : broken as h (h.sourceKey)}
              <li class="flex items-center gap-3 px-4 py-2.5">
                <span class="h-2 w-2 shrink-0 rounded-full {h.ok ? 'bg-ok' : 'bg-danger'}"></span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate">{h.name} <span class="text-xs text-faint uppercase">{h.lang.split("-")[0]}</span></span>
                  {#if h.error}<span class="block truncate text-xs text-danger">{h.error}{h.failures > 1 ? ` · ${h.failures} días` : ""}</span>{/if}
                </span>
              </li>
            {/each}
          </ul>
          <button class="w-full border-t border-fg/5 py-2.5 text-xs font-semibold text-muted" onclick={() => (showAllSources = !showAllSources)}>
            {showAllSources ? "Mostrar solo las que fallan" : `Ver todas (${health.length})`}
          </button>
        {/if}
      </div>
    </section>
  {/if}

  {#if stats}
    <section>
      <h2 class="mb-2 px-1 text-xs font-semibold tracking-[0.08em] text-muted uppercase">Servidor</h2>
      <div class="divide-y divide-fg/5 rounded-[var(--radius-card)] bg-surface text-sm">
        <div class="px-4 py-3">
          <div class="flex justify-between"><span>Caché de imágenes</span><span class="text-muted">{formatBytes(stats.cache.bytes)} de {formatBytes(stats.cache.maxBytes)}</span></div>
          <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-label="Caché usada" aria-valuemin="0" aria-valuemax="100" aria-valuenow={stats.cache.maxBytes ? Math.round((stats.cache.bytes / stats.cache.maxBytes) * 100) : 0}>
            <div class="h-full rounded-full bg-accent" style="width: {stats.cache.maxBytes ? Math.min(100, (stats.cache.bytes / stats.cache.maxBytes) * 100) : 0}%"></div>
          </div>
          <p class="mt-1.5 text-xs text-muted">Páginas y portadas ya descargadas por el servidor; lo más antiguo se borra solo.</p>
        </div>
        <div class="flex justify-between px-4 py-3"><span>Biblioteca</span><span class="text-muted">{stats.library.series} series · {stats.library.chapters} capítulos</span></div>
        <div class="flex justify-between px-4 py-3"><span>Fuentes activas</span><span class="text-muted">{stats.sources}</span></div>
        <div class="flex justify-between px-4 py-3"><span>Encendido desde hace</span><span class="text-muted">{uptime(stats.uptimeSec)}</span></div>
      </div>
    </section>
  {/if}

  <button class="w-full rounded-[var(--radius-card)] bg-surface py-3 text-danger" onclick={logout}>Cerrar sesión</button>
  <p class="pb-4 text-center text-xs text-faint">Hanyo 0.1</p>
</div>
</div>
