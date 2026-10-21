<script lang="ts">
  import { resolve } from "$app/paths";

  import Page from "#lib/components/Page.svelte";
  import PreferenceFields from "#lib/components/PreferenceFields.svelte";
  import { Button } from "#lib/components/ui/button/index.ts";
  import * as Field from "#lib/components/ui/field/index.ts";
  import { dropEmptyFields } from "#lib/drop-empty-fields.ts";

  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  let groupId = $derived({ groupId: data.group.id });
  let deckHref = $derived(resolve("/groups/[groupId]/find", groupId));
</script>

<svelte:head><title>In the mood for · Vunu</title></svelte:head>

<!-- The first step of Find a movie, so the deck never starts by accident
     with everything. Changed later from the deck's mood bar. -->
<Page
  title="In the mood for"
  description="Just for you, just for tonight. You'll also get movies your group has already started, so your answer can finish a match."
  back={{
    href: resolve("/groups/[groupId]", groupId),
    label: data.group.name,
  }}
>
  <!-- A GET form: submitting navigates to the deck with the fields in its
       URL query, like a search box. Kit turns it into a client-side
       navigation, so the deck's load runs with the new preferences. -->
  <form method="GET" action={deckHref} onformdata={dropEmptyFields}>
    <Field.Group>
      <PreferenceFields genres={data.genres} initial={data.preferences} />
    </Field.Group>
    <!-- Stays in reach while the fields scroll under it. Its margins undo
         Page's padding (safe areas included) so its background reaches the
         screen's edges. -->
    <div
      class="sticky bottom-0 mt-8 -mr-[max(env(safe-area-inset-right),1.25rem)] -ml-[max(env(safe-area-inset-left),1.25rem)] flex flex-col gap-3 bg-background pt-3 pr-[max(env(safe-area-inset-right),1.25rem)] pb-[max(env(safe-area-inset-bottom),1rem)] pl-[max(env(safe-area-inset-left),1.25rem)]"
    >
      <Button type="submit" size="lg">Show movies</Button>
      <Button variant="ghost" href={deckHref}>Anything is fine</Button>
    </div>
  </form>
</Page>
