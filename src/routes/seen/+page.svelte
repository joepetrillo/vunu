<script lang="ts">
  import { resolve } from "$app/paths";

  import MoviePoster from "#lib/components/MoviePoster.svelte";

  import type { PageProps } from "./$types";
  import SeenButton from "./SeenButton.svelte";

  let { data }: PageProps = $props();

  // A link to this page with the current search, changed by `changes`. Every
  // change goes back to page 1 unless it sets the page, and default values are
  // left out to keep URLs short.
  function searchHref(changes: Partial<PageProps["data"]["search"]>): string {
    const { scope, title, genre, decade, page } = {
      ...data.search,
      page: 1,
      ...changes,
    };
    const params: Record<string, string> = {};
    if (scope === "all") params.scope = scope;
    if (title !== "") params.title = title;
    if (genre !== undefined) params.genre = String(genre);
    if (decade !== undefined) params.decade = String(decade);
    if (page > 1) params.page = String(page);
    const query = new URLSearchParams(params).toString();
    return query === "" ? resolve("seen") : `${resolve("seen")}?${query}`;
  }

  let filtered = $derived(
    data.search.title !== "" ||
      data.search.genre !== undefined ||
      data.search.decade !== undefined
  );

  // Fires as the search form is turned into a URL. Without it, empty fields
  // would show up as `title=&genre=`.
  function dropEmptyFields(event: FormDataEvent) {
    for (const [name, value] of [...event.formData]) {
      if (value === "") event.formData.delete(name);
    }
  }

  // Picking a genre or decade searches right away.
  function submitOnChange(event: Event & { currentTarget: HTMLSelectElement }) {
    event.currentTarget.form?.requestSubmit();
  }
</script>

<svelte:head><title>Seen movies · Vunu</title></svelte:head>

<main class="mx-auto max-w-xl p-4">
  <a class="text-sm underline" href={resolve("/")}>Home</a>
  <h1 class="mt-2 text-2xl font-bold">Seen movies</h1>
  <p class="mt-1 text-sm text-neutral-600">
    Vunu never deals you a movie on your list.
  </p>

  <nav class="mt-4 flex gap-2 border-b" aria-label="Lists">
    <a
      class={[
        "-mb-px border-b-2 px-3 py-2 text-sm",
        data.search.scope === "mine"
          ? "border-black font-medium"
          : "border-transparent text-neutral-600",
      ]}
      href={searchHref({ scope: "mine" })}
      aria-current={data.search.scope === "mine" ? "page" : undefined}
    >
      Your list ({data.seenCount})
    </a>
    <a
      class={[
        "-mb-px border-b-2 px-3 py-2 text-sm",
        data.search.scope === "all"
          ? "border-black font-medium"
          : "border-transparent text-neutral-600",
      ]}
      href={searchHref({ scope: "all" })}
      aria-current={data.search.scope === "all" ? "page" : undefined}
    >
      All movies
    </a>
  </nav>

  <!-- A GET form: submitting navigates to this page with the fields as URL
       search params, and the load function reruns with them. -->
  <form
    class="mt-4 flex flex-wrap gap-2"
    role="search"
    onformdata={dropEmptyFields}
  >
    {#if data.search.scope === "all"}
      <input type="hidden" name="scope" value="all" />
    {/if}
    <input
      class="min-w-0 flex-1 rounded border px-3 py-2"
      type="search"
      name="title"
      value={data.search.title}
      maxlength="100"
      placeholder="Search by title"
      aria-label="Title"
    />
    <button class="rounded bg-black px-3 py-2 text-white">Search</button>
    <div class="flex w-full gap-2">
      <select
        class="min-w-0 flex-1 rounded border px-2 py-2"
        name="genre"
        aria-label="Genre"
        onchange={submitOnChange}
      >
        <option value="">Any genre</option>
        {#each data.genres as genre (genre.id)}
          <option value={genre.id} selected={genre.id === data.search.genre}>
            {genre.name}
          </option>
        {/each}
      </select>
      <select
        class="min-w-0 flex-1 rounded border px-2 py-2"
        name="decade"
        aria-label="Decade"
        onchange={submitOnChange}
      >
        <option value="">Any decade</option>
        {#each data.decades as decade (decade)}
          <option value={decade} selected={decade === data.search.decade}>
            {decade}s
          </option>
        {/each}
      </select>
    </div>
  </form>

  {#if data.movies.length > 0}
    <ul class="mt-4 divide-y">
      {#each data.movies as movie (movie.id)}
        <li class="flex items-center gap-3 py-2">
          <div class="w-12 shrink-0">
            <MoviePoster
              posterPath={movie.posterPath}
              title={movie.title}
              sizes="48px"
            />
          </div>
          <div class="min-w-0 flex-1">
            <p class="truncate font-medium">{movie.title}</p>
            <p class="text-sm text-neutral-600">
              {movie.year ?? "Year unknown"}
              {#if data.search.scope === "all" && movie.seen}
                · Seen
              {/if}
            </p>
          </div>
          <SeenButton
            movieId={movie.id}
            title={movie.title}
            seen={movie.seen}
          />
        </li>
      {/each}
    </ul>
  {:else if data.search.page > 1}
    <p class="mt-6 text-sm">No more movies.</p>
  {:else if filtered}
    <p class="mt-6 text-sm">
      No movies match.
      <a
        class="underline"
        href={searchHref({ title: "", genre: undefined, decade: undefined })}
      >
        Clear the search
      </a>
    </p>
  {:else if data.search.scope === "mine"}
    <p class="mt-6 text-sm">
      Nothing here yet. Find movies you've seen in
      <a class="underline" href={searchHref({ scope: "all" })}>All movies</a>.
    </p>
  {:else}
    <p class="mt-6 text-sm">The catalog is empty.</p>
  {/if}

  {#if data.search.page > 1 || data.hasNextPage}
    <nav class="mt-4 flex justify-between text-sm" aria-label="Pages">
      {#if data.search.page > 1}
        <a class="underline" href={searchHref({ page: data.search.page - 1 })}>
          Previous
        </a>
      {:else}
        <span></span>
      {/if}
      {#if data.hasNextPage}
        <a class="underline" href={searchHref({ page: data.search.page + 1 })}>
          Next
        </a>
      {/if}
    </nav>
  {/if}
</main>
