<script lang="ts">
  import { enhance } from "$app/forms";
  import { resolve } from "$app/paths";
  import EllipsisIcon from "@lucide/svelte/icons/ellipsis";

  import { ActionForm } from "#lib/action-form.svelte.ts";
  import ListGroup from "#lib/components/ListGroup.svelte";
  import MatchList from "#lib/components/MatchList.svelte";
  import MoviePoster from "#lib/components/MoviePoster.svelte";
  import Page from "#lib/components/Page.svelte";
  import { Button } from "#lib/components/ui/button/index.ts";
  import * as DropdownMenu from "#lib/components/ui/dropdown-menu/index.ts";
  import * as Item from "#lib/components/ui/item/index.ts";
  import type { MovieCard } from "#lib/deck-fields.ts";
  import { listNames } from "#lib/format.ts";

  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  let groupId = $derived({ groupId: data.group.id });
  // Find more goes back to the deck with tonight's preferences, if any.
  let deckHref = $derived(
    data.query === ""
      ? resolve("/groups/[groupId]/find", groupId)
      : resolve(`/groups/[groupId]/find?${data.query}` as const, groupId)
  );

  // One save at a time per kind of change; the movie is part of each
  // input, so every row gets its own action ID.
  const scope = () => data.group.id;
  const watched = new ActionForm({ scope });
  const correction = new ActionForm({ scope });
  let error = $derived(watched.error ?? correction.error);

  // "you, Sam, Alex, and 95 others": you first, since that's the one
  // answer you can give.
  function waitingOn(row: PageProps["data"]["waitingOn"][number]): string {
    return listNames(
      row.waitingOnYou ? ["you", ...row.waitingOn] : row.waitingOn
    );
  }
</script>

<svelte:head><title>Matches · {data.group.name} · Vunu</title></svelte:head>

<!-- The row's menu. Its items are submit buttons for forms that live in the
     row (the `form` attribute), because the menu itself is drawn elsewhere
     in the page (a portal) where a form wouldn't reach. -->
{#snippet rowMenu(movie: MovieCard)}
  <form
    id={`watched-${String(movie.id)}`}
    method="POST"
    action="?/watched"
    use:enhance={watched.submit}
  >
    <input type="hidden" name="movieId" value={movie.id} />
  </form>
  <form
    id={`seen-${String(movie.id)}`}
    method="POST"
    action="?/seen"
    use:enhance={correction.submit}
  >
    <input type="hidden" name="movieId" value={movie.id} />
  </form>
  <DropdownMenu.Root>
    <DropdownMenu.Trigger>
      {#snippet child({ props })}
        <Button
          {...props}
          variant="ghost"
          size="icon"
          aria-label={`More for ${movie.title}`}
        >
          <EllipsisIcon />
        </Button>
      {/snippet}
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="end" class="w-auto">
      <DropdownMenu.Item class="w-full text-base" disabled={watched.saving}>
        {#snippet child({ props })}
          <button {...props} type="submit" form={`watched-${String(movie.id)}`}>
            We watched this
          </button>
        {/snippet}
      </DropdownMenu.Item>
      <DropdownMenu.Item class="w-full text-base" disabled={correction.saving}>
        {#snippet child({ props })}
          <button {...props} type="submit" form={`seen-${String(movie.id)}`}>
            Actually, I've seen this
          </button>
        {/snippet}
      </DropdownMenu.Item>
    </DropdownMenu.Content>
  </DropdownMenu.Root>
{/snippet}

<Page
  title="Matches"
  description={data.matches.length === 0
    ? "A movie everyone here says Not seen to shows up here."
    : "Nobody here has seen these. Pick one together."}
  back={{
    href: resolve("/groups/[groupId]", groupId),
    label: data.group.name,
  }}
>
  <Button
    href={deckHref}
    size="lg"
    variant={data.matches.length === 0 ? "default" : "secondary"}
    class="mb-8 w-full"
  >
    {data.matches.length === 0 ? "Find a movie" : "Find more"}
  </Button>

  {#if error}
    <p class="mb-4 text-sm text-destructive" role="alert">{error}</p>
  {/if}

  {#if data.matches.length > 0}
    <section aria-label={`${String(data.matches.length)} matches`}>
      <MatchList matches={data.matches} actions={rowMenu} />
    </section>
  {/if}

  {#if data.waitingOn.length > 0}
    <section class="mt-10" aria-labelledby="almost-heading">
      <h2 id="almost-heading" class="text-xl font-semibold">Almost</h2>
      <p class="mt-1 mb-3 text-balance text-muted-foreground">
        Not matches yet: these wait on someone's answer.
      </p>
      <ListGroup>
        {#each data.waitingOn as row (row.movie.id)}
          <li>
            <Item.Root class="flex-nowrap rounded-none">
              <Item.Media class="w-12 shrink-0">
                <MoviePoster
                  posterPath={row.movie.posterPath}
                  title={row.movie.title}
                  sizes="48px"
                />
              </Item.Media>
              <Item.Content class="min-w-0">
                <Item.Title class="line-clamp-2">{row.movie.title}</Item.Title>
                <Item.Description>
                  Waiting on {waitingOn(row)}
                </Item.Description>
              </Item.Content>
            </Item.Root>
          </li>
        {/each}
      </ListGroup>
    </section>
  {/if}
</Page>
