<script lang="ts">
  import { goto } from "$app/navigation";
  import { api, ApiError } from "$lib/api";

  let password = $state("");
  let error = $state<string | null>(null);
  let busy = $state(false);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = null;
    try {
      await api.login(password);
      await goto("/", { replaceState: true });
    } catch (err) {
      error = err instanceof ApiError ? err.message : "No se pudo iniciar sesión";
    } finally {
      busy = false;
    }
  }
</script>

<div class="pt-safe flex min-h-dvh flex-col items-center justify-center px-8">
  <img src="/icons/icon.svg" alt="" class="h-20 w-20 rounded-[22px] shadow-2xl shadow-hanji-500/20" />
  <h1 class="mt-5 text-3xl font-bold tracking-tight">Hanyo</h1>
  <p class="mt-1 text-sm text-ink-400">Tu biblioteca de manhwa, manga y manhua</p>

  <form class="mt-10 w-full max-w-xs space-y-3" onsubmit={submit}>
    <input
      type="password"
      bind:value={password}
      placeholder="Contraseña"
      autocomplete="current-password"
      class="w-full rounded-xl border border-white/10 bg-ink-850 px-4 py-3.5 text-base outline-none placeholder:text-ink-500 focus:border-hanji-400/60"
    />
    {#if error}<p class="text-center text-sm text-red-400">{error}</p>{/if}
    <button
      disabled={busy || !password}
      class="w-full rounded-xl bg-gradient-to-r from-hanji-300 to-hanji-500 py-3.5 font-semibold text-ink-950 disabled:opacity-50"
    >
      {busy ? "Entrando…" : "Entrar"}
    </button>
  </form>
</div>
