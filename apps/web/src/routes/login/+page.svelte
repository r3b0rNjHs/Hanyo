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

<div class="pt-safe flex min-h-dvh flex-col justify-center px-7">
  <img src="/icons/icon.svg" alt="" class="h-20 w-20 rounded-[24px]" />
  <h1 class="font-display mt-6 text-[40px] leading-none font-bold tracking-[-0.04em]">Hanyo</h1>
  <p class="mt-2 text-[15px] text-muted">Tu biblioteca de manhwa, manga y manhua.</p>

  <form class="mt-10 w-full space-y-3" onsubmit={submit}>
    <label for="password" class="sr-only">Contraseña</label>
    <input
      id="password"
      type="password"
      bind:value={password}
      placeholder="Contraseña"
      autocomplete="current-password"
      class="h-14 w-full rounded-full bg-raised px-5 text-base outline-none placeholder:text-faint focus:ring-2 focus:ring-accent/60"
    />
    {#if error}<p class="px-2 text-sm text-danger" role="alert">{error}</p>{/if}
    <button disabled={busy || !password} class="h-14 w-full rounded-full bg-accent text-base font-bold text-on-accent disabled:opacity-40">
      {busy ? "Entrando…" : "Entrar"}
    </button>
  </form>
</div>
