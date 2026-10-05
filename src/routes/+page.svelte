<script lang="ts">
  import { refreshAll } from "$app/navigation";
  import { resolve } from "$app/paths";

  import { authClient } from "#lib/auth-client.ts";

  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();
  let signingOut = $state(false);
  let errorMessage = $state<string | null>(null);

  async function signOut() {
    if (signingOut) return;
    signingOut = true;
    errorMessage = null;
    try {
      const { error } = await authClient.signOut();
      if (error !== null) {
        errorMessage = "Couldn't sign out. Try again.";
        return;
      }
      // The cookie is gone; the hook redirects when page data refreshes.
      try {
        await refreshAll();
      } catch {
        errorMessage =
          "Signed out, but couldn't refresh the page. Reload to continue.";
      }
    } catch {
      errorMessage =
        "Couldn't reach Vunu. Check your connection and try again.";
    } finally {
      signingOut = false;
    }
  }
</script>

<svelte:head><title>Vunu</title></svelte:head>

<main class="mx-auto max-w-xl p-4">
  <h1 class="text-2xl font-bold">Vunu</h1>
  <p class="mt-2">Find movies nobody in your group has seen.</p>
  {#if data.user}
    <p class="mt-4 text-sm">
      Signed in as <strong>{data.user.email}</strong>.
      <button
        class="underline disabled:opacity-50"
        onclick={signOut}
        disabled={signingOut}
      >
        {signingOut ? "Signing out…" : "Sign out"}
      </button>
    </p>
  {/if}
  {#if errorMessage}
    <p class="mt-4 text-sm text-red-700" role="alert">{errorMessage}</p>
  {/if}
  <p class="mt-4 text-sm">
    <a class="underline" href={resolve("seen")}>Your seen movies</a>
  </p>
</main>
