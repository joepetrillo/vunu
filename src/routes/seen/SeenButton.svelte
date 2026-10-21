<script lang="ts">
  import { enhance } from "$app/forms";
  import { page } from "$app/state";

  import { ActionForm } from "#lib/action-form.svelte.ts";
  import { Button } from "#lib/components/ui/button/index.ts";

  import type { SubmitFunction } from "./$types";

  interface Props {
    movieId: number;
    title: string;
    seen: boolean;
  }

  type Change = "add" | "remove";

  let { movieId, title, seen }: Props = $props();

  let change = $derived<Change>(seen ? "remove" : "add");

  // The action-ID rule lives in ActionForm (spec section 4). The change is
  // part of the input, so "add" and "remove" never share an ID.
  const form = new ActionForm({ scope: () => change });

  // An error belongs to the change that failed. Once the row shows that
  // change done (a later refresh reveals the "failed" save went through
  // after all), it no longer applies and disappears.
  let submitted = $state<Change | null>(null);
  let errorMessage = $derived(submitted === change ? form.error : null);

  const submit: SubmitFunction = (input) => {
    // Captured now: `change` follows the page data, which another row's save
    // can refresh while this request is out.
    if (!form.saving) submitted = change;
    return form.submit(input);
  };

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
  <Button
    type="submit"
    variant={seen ? "outline" : "default"}
    size="sm"
    disabled={form.saving}
    aria-label={seen ? `Remove ${title}` : `Seen it: ${title}`}
  >
    {seen ? "Remove" : "Seen it"}
  </Button>
  {#if errorMessage}
    <p class="max-w-40 text-right text-xs text-destructive" role="alert">
      {errorMessage}
    </p>
  {/if}
</form>
