<script lang="ts">
  import { refreshAll } from "$app/navigation";
  import { tick } from "svelte";

  import { authClient } from "#lib/auth-client.ts";

  // How Better Auth's client describes a failed request.
  interface AuthError {
    status: number;
    code?: string;
    message?: string;
  }

  // Two steps on one page: ask for the email, then for the code we sent to it.
  let step = $state<"email" | "code">("email");
  let email = $state("");
  let code = $state("");
  // Which request is in flight; every button is disabled while one is.
  let pending = $state<"send" | "verify" | null>(null);
  let errorMessage = $state<string | null>(null);
  // Confirms a re-sent code, which would otherwise look like nothing happened.
  let resent = $state(false);

  // Better Auth's messages are terse ("Invalid OTP"); these say what to do next.
  function describeError(error: AuthError): string {
    if (error.status === 429) {
      return "Too many attempts. Wait a few minutes and try again.";
    }
    switch (error.code) {
      case "INVALID_OTP":
        return "That code isn't right. Check the email and try again.";
      case "OTP_EXPIRED":
      case "TOO_MANY_ATTEMPTS":
        return "That code no longer works. Send a new one.";
      default:
        return error.message ?? "Something went wrong. Try again.";
    }
  }

  // Runs one Better Auth request and returns the message to show, or null if
  // it worked. The client returns server errors as `error`, but throws when the
  // request never reaches the server (no signal, server down).
  async function attempt(
    request: () => Promise<{ error: AuthError | null }>
  ): Promise<string | null> {
    try {
      const { error } = await request();
      return error === null ? null : describeError(error);
    } catch {
      return "Couldn't reach Vunu. Check your connection and try again.";
    }
  }

  async function requestCode(): Promise<boolean> {
    if (pending !== null) return false;
    pending = "send";
    errorMessage = await attempt(() =>
      authClient.emailOtp.sendVerificationOtp({ email, type: "sign-in" })
    );
    pending = null;
    return errorMessage === null;
  }

  async function submitEmail(event: SubmitEvent) {
    // The browser would otherwise submit the form as a full page request.
    event.preventDefault();
    if (await requestCode()) {
      step = "code";
      // The old form is removed. Focus the replacement after Svelte renders it.
      await tick();
      document.querySelector<HTMLInputElement>('input[name="code"]')?.focus();
    }
  }

  async function resendCode() {
    resent = await requestCode();
  }

  async function submitCode(event: SubmitEvent) {
    event.preventDefault();
    if (pending !== null) return;
    pending = "verify";
    resent = false;
    errorMessage = await attempt(() =>
      authClient.signIn.emailOtp({ email, otp: code })
    );
    if (errorMessage !== null) {
      pending = null;
      return;
    }
    // The response set the session cookie. Re-running the loads sends a request
    // through hooks.server.ts, which now sees the user and redirects to the
    // page they asked for. `pending` stays set until the page changes.
    try {
      await refreshAll();
    } catch {
      errorMessage =
        "Signed in, but couldn't open the page. Reload to continue.";
      pending = null;
    }
  }

  async function useDifferentEmail() {
    if (pending !== null) return;
    step = "email";
    code = "";
    errorMessage = null;
    resent = false;
    await tick();
    document.querySelector<HTMLInputElement>('input[name="email"]')?.focus();
  }
</script>

<svelte:head><title>Sign in · Vunu</title></svelte:head>

<main class="mx-auto max-w-sm p-4">
  <h1 class="text-2xl font-bold">Sign in to Vunu</h1>

  {#if step === "email"}
    <!-- Before hydration, POST keeps sensitive fields out of URLs/logs. -->
    <form method="POST" class="mt-6 flex flex-col gap-3" onsubmit={submitEmail}>
      <label class="flex flex-col gap-1">
        <span class="text-sm font-medium">Email</span>
        <input
          class="rounded border px-3 py-2"
          type="email"
          name="email"
          autocomplete="email"
          required
          disabled={pending !== null}
          bind:value={email}
        />
      </label>
      <button
        class="rounded bg-black px-3 py-2 text-white disabled:opacity-50"
        disabled={pending !== null}
      >
        {pending === "send" ? "Sending…" : "Email me a code"}
      </button>
    </form>
  {:else}
    <p class="mt-6 text-sm">
      We sent a 6-digit code to <strong>{email}</strong>. It expires in 5
      minutes.
    </p>
    <form method="POST" class="mt-4 flex flex-col gap-3" onsubmit={submitCode}>
      <label class="flex flex-col gap-1">
        <span class="text-sm font-medium">Code</span>
        <!-- one-time-code lets phones offer the code from the email. The
             pattern is a JS string because Svelte reads {6} in a quoted
             attribute as an expression, turning it into "[0-9]6". -->
        <input
          class="rounded border px-3 py-2 tracking-widest"
          type="text"
          name="code"
          inputmode="numeric"
          autocomplete="one-time-code"
          pattern={"[0-9]{6}"}
          maxlength="6"
          required
          disabled={pending !== null}
          bind:value={code}
        />
      </label>
      <button
        class="rounded bg-black px-3 py-2 text-white disabled:opacity-50"
        disabled={pending !== null}
      >
        {pending === "verify" ? "Signing in…" : "Sign in"}
      </button>
    </form>
    <p class="mt-4 text-sm">
      Didn't get it? Check your spam folder, or
      <button
        type="button"
        class="underline disabled:opacity-50"
        disabled={pending !== null}
        onclick={resendCode}
      >
        {pending === "send" ? "sending…" : "send it again"}</button
      >.
    </p>
    {#if resent}
      <p class="mt-2 text-sm" role="status">
        Sent. Use the code in the newest email.
      </p>
    {/if}
    <button
      type="button"
      class="mt-4 text-sm underline disabled:opacity-50"
      disabled={pending !== null}
      onclick={useDifferentEmail}
    >
      Use a different email
    </button>
  {/if}

  {#if errorMessage}
    <p class="mt-4 text-sm text-red-700" role="alert">{errorMessage}</p>
  {/if}
</main>
