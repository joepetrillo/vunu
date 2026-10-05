<script lang="ts">
  import { enhance } from "$app/forms";
  import { page } from "$app/state";

  import type { SubmitFunction } from "./$types";

  interface Props {
    movieId: number;
    title: string;
    seen: boolean;
  }

  type Change = "add" | "remove";

  let { movieId, title, seen }: Props = $props();

  let change = $derived<Change>(seen ? "remove" : "add");
  let saving = $state(false);

  // Kept with the change it was about: once the row shows that change done
  // (say, a later refresh reveals the "failed" save went through after all),
  // the message no longer applies and disappears.
  let failure = $state<{ change: Change; message: string } | null>(null);
  let errorMessage = $derived(
    failure?.change === change ? failure.message : null
  );

  // The change still waiting for an answer from the server. A request that
  // failed without one (dropped connection, server error) may have gone
  // through anyway, so trying again resends its action ID and the server
  // recognizes the retry. Plain `let`: nothing on screen depends on it.
  let unanswered: { change: Change; actionId: string } | null = null;

  // A relative action like "?/add" would replace the page's query string and
  // lose the search, so keep the query and add the action's name to it.
  let action = $derived.by(() => {
    // Kit picks the first named action. A restored/shared URL may still have
    // one, so remove it before appending the current change.
    const search = new URLSearchParams(
      [...page.url.searchParams].filter(([name]) => !name.startsWith("/"))
    ).toString();
    return search === "" ? `?/${change}` : `?${search}&/${change}`;
  });

  // `use:enhance` sends the form with fetch instead of a full page load. This
  // runs before it's sent; the function it returns runs with the result.
  const submit: SubmitFunction = ({ formData, cancel }) => {
    if (saving) {
      cancel();
      return;
    }
    // Captured now: `change` follows the page data, which another row's save
    // can refresh while this request is out.
    const submitted = change;
    if (unanswered?.change !== submitted) {
      unanswered = { change: submitted, actionId: crypto.randomUUID() };
    }
    formData.set("actionId", unanswered.actionId);
    saving = true;
    failure = null;

    return async ({ result, update }) => {
      try {
        if (result.type === "error") {
          failure = { change: submitted, message: "Couldn't save. Try again." };
        } else {
          unanswered = null;
          if (result.type === "failure") {
            failure = {
              change: submitted,
              message: result.data?.message ?? "Couldn't save. Try again.",
            };
          } else {
            // Re-runs the page's load, so the list shows the change.
            try {
              await update();
            } catch {
              failure = {
                change: submitted,
                message:
                  result.type === "success"
                    ? "Saved, but couldn't refresh. Reload the page."
                    : "Couldn't open the page. Reload to continue.",
              };
            }
          }
        }
      } finally {
        saving = false;
      }
    };
  };
</script>

<form
  method="POST"
  {action}
  use:enhance={submit}
  class="flex shrink-0 flex-col items-end gap-1"
>
  <input type="hidden" name="movieId" value={movieId} />
  <!-- The label adds the title for screen readers, which can list a page's
       buttons without the rows around them. It starts with the visible text,
       so voice control ("click Remove") still finds it. -->
  <button
    class={[
      "rounded px-3 py-1.5 text-sm disabled:opacity-50",
      seen ? "border" : "bg-black text-white",
    ]}
    disabled={saving}
    aria-label={seen ? `Remove ${title}` : `Seen it: ${title}`}
  >
    {seen ? "Remove" : "Seen it"}
  </button>
  {#if errorMessage}
    <p class="max-w-40 text-right text-xs text-red-700" role="alert">
      {errorMessage}
    </p>
  {/if}
</form>
