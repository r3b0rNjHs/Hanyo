<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { api, ApiError } from "$lib/api";
  import Spinner from "$lib/components/Spinner.svelte";
  import { session } from "$lib/session.svelte";

  const token = $derived(page.params.token ?? "");
  let valid = $state<boolean | null>(null);
  let username = $state("");
  let password = $state("");
  let repeat = $state("");
  let error = $state<string | null>(null);
  let busy = $state(false);

  onMount(() => {
    api.inviteValid(token).then((r) => (valid = r.valid), () => (valid = false));
  });

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (password !== repeat) {
      error = "Las contraseñas no coinciden";
      return;
    }
    busy = true;
    error = null;
    try {
      session.user = (await api.redeemInvite(token, username.trim(), password)).user;
      await goto("/", { replaceState: true });
    } catch (err) {
      error = err instanceof ApiError ? err.message : "No se pudo crear la cuenta";
    } finally {
      busy = false;
    }
  }

  const input =
    "h-14 w-full rounded-full bg-raised px-5 text-base outline-none placeholder:text-faint focus:ring-2 focus:ring-accent/60";
</script>

<div class="pt-safe mx-auto flex min-h-dvh max-w-md flex-col justify-center px-7">
  <img src="/icons/icon.svg" alt="" class="h-20 w-20 rounded-[24px]" />
  <h1 class="font-display mt-6 text-[34px] leading-none font-bold tracking-[-0.04em]">Te han invitado a Hanyo</h1>
  <p class="mt-2 text-[15px] text-muted">Tu propia biblioteca de manhwa, manga y manhua: elige tu usuario y contraseña.</p>

  {#if valid === null}
    <div class="mt-10 flex justify-center"><Spinner /></div>
  {:else if !valid}
    <p class="mt-10 rounded-[var(--radius-card)] bg-surface p-4 text-sm text-soft">
      Esta invitación ya se ha usado o ha caducado. Pide otra a quien te la envió.
    </p>
    <a href="/login" class="mt-4 text-center text-sm font-semibold text-accent-soft">Ya tengo cuenta</a>
  {:else}
    <form class="mt-10 w-full space-y-3" onsubmit={submit}>
      <label for="username" class="sr-only">Usuario</label>
      <input id="username" bind:value={username} placeholder="Usuario" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" class={input} />
      <label for="password" class="sr-only">Contraseña</label>
      <input id="password" type="password" bind:value={password} placeholder="Contraseña (mínimo 8)" autocomplete="new-password" class={input} />
      <label for="repeat" class="sr-only">Repite la contraseña</label>
      <input id="repeat" type="password" bind:value={repeat} placeholder="Repite la contraseña" autocomplete="new-password" class={input} />
      {#if error}<p class="px-2 text-sm text-danger" role="alert">{error}</p>{/if}
      <button disabled={busy || !username.trim() || !password || !repeat} class="h-14 w-full rounded-full bg-accent text-base font-bold text-on-accent disabled:opacity-40">
        {busy ? "Creando…" : "Crear mi cuenta"}
      </button>
    </form>
  {/if}
</div>
