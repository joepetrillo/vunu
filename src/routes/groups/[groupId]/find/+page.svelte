<script lang="ts">
  import {
    afterNavigate,
    beforeNavigate,
    goto,
    refreshAll,
  } from "$app/navigation";
  import { resolve } from "$app/paths";
  import type { ResolvedPathname } from "$app/types";
  import ChevronLeftIcon from "@lucide/svelte/icons/chevron-left";
  import SlidersHorizontalIcon from "@lucide/svelte/icons/sliders-horizontal";
  import Undo2Icon from "@lucide/svelte/icons/undo-2";
  import { prefersReducedMotion } from "svelte/motion";
  import { fade, scale } from "svelte/transition";

  import MoviePoster from "#lib/components/MoviePoster.svelte";
  import PreferenceFields from "#lib/components/PreferenceFields.svelte";
  import { Badge } from "#lib/components/ui/badge/index.ts";
  import { Button } from "#lib/components/ui/button/index.ts";
  import * as Card from "#lib/components/ui/card/index.ts";
  import * as Field from "#lib/components/ui/field/index.ts";
  import * as Sheet from "#lib/components/ui/sheet/index.ts";
  import { Spinner } from "#lib/components/ui/spinner/index.ts";
  import {
    countPreferences,
    describeMovie,
    hasPreferences,
    preferencesToQuery,
    REVIEW_PROMPT_AT,
  } from "#lib/deck-fields.ts";
  import { dropEmptyFields } from "#lib/drop-empty-fields.ts";
  import { formatCount, listNames } from "#lib/format.ts";
  import { CARD_MS, easeOutStrong, FADE_MS } from "#lib/motion.ts";

  import type { PageProps } from "./$types";
  import { cardArrive, cardLeave } from "./card-motion.ts";
  import { Deck } from "./deck.svelte.ts";
  import { swipe } from "./swipe.ts";

  let { data }: PageProps = $props();

  // Tonight's preferences, as this page's URL query has them.
  let query = $derived(preferencesToQuery(data.preferences));

  // A new Deck whenever the page data changes (new preferences, another
  // group); otherwise it lives as long as the page.
  let deck = $derived(new Deck(data.deck, query));

  // Follow other people's answers while the deck is on screen. An effect is
  // the right tool here: polling is an outside process that must start with
  // the deck and stop when it goes (like useEffect's cleanup in React, or
  // ngOnDestroy). If you leave the group meanwhile, reload (into a 404).
  let pollUrl = $derived(
    resolve("/groups/[groupId]/find/poll", { groupId: data.group.id })
  );
  $effect(() => deck.connect(pollUrl, () => void refreshAll()));

  // Links keep tonight's preferences: the group page lists the matches
  // that fit them first. `resolve` checks route IDs, query included.
  let groupId = $derived({ groupId: data.group.id });
  let groupHref = $derived(resolve("/groups/[groupId]", groupId));
  let matchesHref = $derived(
    query === ""
      ? resolve("/groups/[groupId]/matches", groupId)
      : resolve(`/groups/[groupId]/matches?${query}` as const, groupId)
  );
  let deckHref = $derived(resolve("/groups/[groupId]/find", groupId));

  // Changing preferences opens a sheet over the deck; picking new ones
  // navigates to this page with a new query, which closes it.
  let moodOpen = $state(false);
  let moodCount = $derived(countPreferences(data.preferences));
  afterNavigate(() => {
    moodOpen = false;
  });

  // Leaving the page drops answers still waiting to be sent, so any link
  // (back, Matches, preferences) waits for them first. A failed save
  // keeps you here with Retry. Closing the tab gets the browser's own
  // "Leave this page?" question instead.
  beforeNavigate((navigation) => {
    const target = navigation.to?.url;
    if (deck.pending === 0 || target === undefined) return;
    navigation.cancel();
    if (navigation.willUnload) return;
    // The navigation Kit just resolved and we cancelled: same origin (an
    // unload would have returned above), so its path is already resolved.
    const href =
      `${target.pathname}${target.search}${target.hash}` as ResolvedPathname;
    const saving = deck;
    void saving.settle().then((saved) => {
      // refreshAll: Kit preloaded the link's data when it was touched,
      // before these saves landed; that copy would show stale matches.
      if (saved) void goto(href, { refreshAll: true });
    });
  });

  // Whether the card on screen can be answered, by button or by swipe.
  let answerable = $derived(
    deck.card !== undefined &&
      !deck.undoing &&
      !deck.reviewPrompt &&
      deck.refused === null
  );

  // The cards' motion (card-motion.ts) asks the deck how each card left or
  // came back: only an answered card flies off, toward its answer's side,
  // and Undo brings it back from there. Less motion: fades only.
  function leave(node: HTMLElement, cardId: number) {
    return cardLeave(node, {
      answer: deck.answeredAs(cardId),
      reducedMotion: prefersReducedMotion.current,
    });
  }
  function arrive(node: HTMLElement, cardId: number) {
    return cardArrive(node, {
      undone: deck.undoneAs(cardId),
      reducedMotion: prefersReducedMotion.current,
    });
  }

  // The 5-match prompt takes the card's place: it grows in slightly, so the
  // swap reads as a new step rather than a glitch.
  function appear(node: HTMLElement) {
    return prefersReducedMotion.current
      ? fade(node, { duration: FADE_MS })
      : scale(node, { start: 0.96, duration: CARD_MS, easing: easeOutStrong });
  }

  // Swiping the card on screen answers it, exactly like its button.
  const swipeCard = swipe({
    enabled: () => answerable,
    reducedMotion: () => prefersReducedMotion.current,
    onAnswer: (answer) => {
      deck.answer(answer);
    },
  });
</script>

<svelte:head><title>Find a movie · Vunu</title></svelte:head>

<!-- A full-screen layout (not Page): the card takes whatever height the
       header and buttons leave. dvh follows Safari's toolbar as it hides.
       The top padding matches Page's, so the back link doesn't jump. -->
<!-- No link preloading: matches change with every answer, and data
       fetched when a link is touched could be stale by the time it opens. -->
<div
  data-deck
  data-sveltekit-preload-data="off"
  class="mx-auto flex h-dvh w-full max-w-md flex-col pt-[max(env(safe-area-inset-top),1.5rem)] pr-[max(env(safe-area-inset-right),1.25rem)] pb-[max(env(safe-area-inset-bottom),1rem)] pl-[max(env(safe-area-inset-left),1.25rem)]"
>
  <header class="flex items-center justify-between gap-3">
    <!-- shrink: buttons don't by default, and a long group name would push
         Matches off the screen. -->
    <Button
      href={groupHref}
      variant="ghost"
      size="sm"
      class="-ml-3 min-w-0 shrink"
    >
      <ChevronLeftIcon data-icon="inline-start" />
      <span class="truncate">{data.group.name}</span>
    </Button>
    <Button href={matchesHref} variant="secondary" size="sm">
      Matches
      <Badge class="tabular-nums">{formatCount(deck.matchCount)}</Badge>
    </Button>
  </header>
  <!-- Your preferences for tonight; nobody else sees them. One line with a
       count, whatever you pick, so the card keeps its size; the sheet shows
       them in full. -->
  <Sheet.Root bind:open={moodOpen}>
    <Sheet.Trigger
      class="mt-3 flex h-12 w-full items-center gap-3 rounded-2xl border px-4 text-left transition-colors outline-none select-none hover:bg-muted focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 active:bg-muted"
    >
      <SlidersHorizontalIcon class="size-5 shrink-0" />
      <span class="min-w-0 flex-1 truncate font-medium">In the mood for</span>
      <Badge
        variant={moodCount === 0 ? "secondary" : "default"}
        class="shrink-0 tabular-nums"
      >
        {moodCount === 0
          ? "Anything"
          : `${String(moodCount)} ${moodCount === 1 ? "filter" : "filters"}`}
      </Badge>
    </Sheet.Trigger>
    <Sheet.Content
      side="bottom"
      class="max-h-[90dvh] rounded-t-3xl sm:mx-auto sm:max-w-md"
    >
      <Sheet.Header>
        <Sheet.Title class="text-xl font-bold">In the mood for</Sheet.Title>
        <Sheet.Description>Just for you, just for tonight.</Sheet.Description>
      </Sheet.Header>
      <!-- The same GET form as the first step: the deck reloads with the
           new preferences in its URL. -->
      <form
        method="GET"
        action={deckHref}
        onformdata={dropEmptyFields}
        class="flex min-h-0 flex-1 flex-col"
      >
        <!-- overscroll-contain: scrolling past either end stops here
             instead of moving the page behind the sheet. -->
        <div
          class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-2"
        >
          <Field.Group>
            <PreferenceFields genres={data.genres} initial={data.preferences} />
          </Field.Group>
        </div>
        <Sheet.Footer
          class="border-t pt-4 pb-[max(env(safe-area-inset-bottom),1.5rem)]"
        >
          <Button type="submit" size="lg">Show movies</Button>
          <Button variant="ghost" href={deckHref}>Anything is fine</Button>
        </Sheet.Footer>
      </form>
    </Sheet.Content>
  </Sheet.Root>

  <main class="flex min-h-0 flex-1 flex-col items-center justify-center py-4">
    {#if deck.refused !== null}
      <div class="text-center text-balance" role="alert">
        <p class="text-lg font-semibold">{deck.refused}</p>
        <Button class="mt-4" onclick={() => refreshAll()}>Reload</Button>
      </div>
    {:else if deck.reviewPrompt}
      <div class="w-full" in:appear>
        <Card.Root class="w-full">
          <Card.Header>
            <Card.Title>{REVIEW_PROMPT_AT} movies nobody has seen</Card.Title>
            <Card.Description>
              Take a look and pick one, or keep going to find more.
            </Card.Description>
          </Card.Header>
          <Card.Footer class="flex flex-col items-stretch gap-3">
            <Button size="lg" href={matchesHref}>See the matches</Button>
            <Button variant="ghost" onclick={() => (deck.reviewPrompt = false)}>
              Keep going
            </Button>
          </Card.Footer>
        </Card.Root>
      </div>
    {:else if deck.card !== undefined}
      <!-- The visible card with the next one behind it, slightly smaller,
             so its poster is already loaded when it moves up. Fades in when
             the deck comes back (Keep going, more movies dealt). -->
      <div
        class="relative aspect-2/3 h-full max-h-full max-w-full"
        in:fade={{ duration: FADE_MS }}
      >
        {#each deck.cards.slice(0, 2).reverse() as card (card.id)}
          {@const isTop = card.id === deck.card.id}
          <!-- Tailwind 4's translate-* and scale-* set the translate and
               scale properties, so those are what moving up transitions.
               The card is a control, not content: no text selection or
               iOS long-press image menu (the poster ignores touches).
               touch-pan-y: sideways drags are the swipe's, while up and
               down still scroll the page. -->
          <div
            class={[
              "absolute inset-0 touch-pan-y transition-[translate,scale,opacity] duration-(--duration-card) ease-out-strong select-none [-webkit-touch-callout:none] motion-reduce:transition-opacity [&_img]:pointer-events-none",
              isTop ? "z-10" : "translate-y-3 scale-[0.94] opacity-60",
            ]}
            aria-hidden={!isTop}
            in:arrive={card.id}
            out:leave={card.id}
            {@attach isTop && swipeCard}
          >
            <MoviePoster
              posterPath={card.posterPath}
              title={card.title}
              sizes="(max-width: 640px) 80vw, 420px"
              loading="eager"
              class="h-full rounded-3xl shadow-xl"
            />
            <!-- Fade in while the card is dragged toward an answer (the
                 swipe sets their opacity). Words only: Vunu asks what
                 you've seen, not what you like. -->
            {#each [{ answer: "seen", label: "Seen", side: "right-4" }, { answer: "not_seen", label: "Not seen", side: "left-4" }] as const as hint (hint.answer)}
              <span
                data-swipe-label={hint.answer}
                aria-hidden="true"
                class={[
                  "pointer-events-none absolute top-4 rounded-full bg-background/90 px-4 py-2 text-lg font-semibold text-foreground opacity-0 shadow-lg",
                  hint.side,
                ]}
              >
                {hint.label}
              </span>
            {/each}
          </div>
        {/each}
      </div>
      <div class="mt-4 w-full text-center text-balance" aria-live="polite">
        <h1 class="line-clamp-2 text-2xl font-bold tracking-tight">
          {deck.card.title}
        </h1>
        <p class="mt-1 text-muted-foreground">{describeMovie(deck.card)}</p>
      </div>
    {:else if !deck.exhausted || deck.waitingOn === null}
      <div class="flex items-center gap-3 text-muted-foreground">
        <Spinner />
        Dealing more movies…
      </div>
    {:else if deck.waitingOn.length > 0}
      <!-- Never suggest other preferences here: the movies exist, they
             just need other people's answers. -->
      <div class="text-center text-balance" aria-live="polite">
        <p class="text-lg font-semibold">You're caught up</p>
        <p class="mt-2 text-muted-foreground">
          Waiting for {listNames(deck.waitingOn)} to answer.
        </p>
        <div class="mt-6 flex flex-col gap-3">
          <Button size="lg" href={matchesHref}>See the matches</Button>
        </div>
      </div>
    {:else}
      <div class="text-center text-balance">
        <p class="text-lg font-semibold">
          {hasPreferences(data.preferences)
            ? "That's every movie that fits your preferences."
            : "That's every movie for now."}
        </p>
        <p class="mt-2 text-muted-foreground">
          {hasPreferences(data.preferences)
            ? "Look over the matches, or change your preferences for more."
            : "Look over the matches."}
        </p>
        <div class="mt-6 flex flex-col gap-3">
          <Button size="lg" href={matchesHref}>See the matches</Button>
          {#if hasPreferences(data.preferences)}
            <Button variant="ghost" onclick={() => (moodOpen = true)}>
              Change preferences
            </Button>
          {/if}
        </div>
      </div>
    {/if}
  </main>

  <footer class="flex flex-col gap-3">
    <div class="flex min-h-9 items-center justify-between gap-3">
      <Button
        variant="ghost"
        size="sm"
        class="-ml-3"
        onclick={() => {
          void deck.undo();
        }}
        disabled={!deck.canUndo ||
          deck.undoing ||
          deck.error !== null ||
          deck.refused !== null}
      >
        <Undo2Icon data-icon="inline-start" />
        Undo
      </Button>
      <!-- Saving is quiet; only a failure asks for anything. -->
      <p class="text-sm text-muted-foreground" aria-live="polite">
        {#if deck.error !== null}
          <span class="text-destructive">{deck.error}</span>
        {:else if deck.undoError !== null}
          <span class="text-destructive">{deck.undoError}</span>
        {:else if deck.saving}
          Saving…
        {:else if deck.offline}
          Can't reach Vunu. Trying again…
        {/if}
      </p>
      {#if deck.error !== null}
        <Button
          variant="outline"
          size="sm"
          onclick={() => {
            deck.retry();
          }}
        >
          Retry
        </Button>
      {/if}
    </div>

    <!-- Two equal buttons: Vunu asks what you've seen, not what you like. -->
    <div class="grid grid-cols-2 gap-3">
      {#each [{ answer: "seen", label: "Seen" }, { answer: "not_seen", label: "Not seen" }] as const as choice (choice.answer)}
        <Button
          variant="secondary"
          class="h-16 text-lg"
          disabled={!answerable}
          onclick={() => {
            deck.answer(choice.answer);
          }}
        >
          {choice.label}
        </Button>
      {/each}
    </div>
  </footer>
</div>
