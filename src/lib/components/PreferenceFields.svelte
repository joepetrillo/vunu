<script module lang="ts">
  // Checkboxes styled as chips.
  export const CHIP =
    "cursor-pointer rounded-4xl border px-4 py-2 text-sm font-medium transition-colors select-none has-checked:border-primary has-checked:bg-primary has-checked:text-primary-foreground has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50";
</script>

<script lang="ts">
  import * as Field from "#lib/components/ui/field/index.ts";
  import { Input } from "#lib/components/ui/input/index.ts";
  import { NativeSelect } from "#lib/components/ui/native-select/index.ts";
  import {
    formatRuntime,
    type Preferences,
    RATINGS,
    ratingLabel,
    RUNTIME_CHOICES,
    YEAR_MAX,
    YEAR_MIN,
  } from "#lib/deck-fields.ts";

  interface Props {
    genres: { id: number; name: string }[];
    /** What the fields start out showing. */
    initial: Preferences;
  }

  let { genres, initial }: Props = $props();

  // Writable deriveds: the fields can be edited, and reset if `initial`
  // changes (another group, say).
  let runtime = $derived(
    initial.maxRuntime === null ? "" : String(initial.maxRuntime)
  );
  let minYear = $derived(initial.minYear);
  let maxYear = $derived(initial.maxYear);
  let genreIds = $derived([...initial.genreIds]);
  // "Any" is the empty value, which the form leaves out of the URL.
  let animation = $derived(
    initial.animation === "any" ? "" : initial.animation
  );
  let ratings = $derived([...initial.ratings]);

  const ANIMATION = [
    { value: "", label: "Any" },
    { value: "exclude", label: "Not animated" },
    { value: "only", label: "Only animated" },
  ];
</script>

<!-- The preference fields. All optional: untouched, they mean anything. -->
<Field.Set>
  <Field.Legend variant="label">Genres</Field.Legend>
  <Field.Description>Pick any; none means all.</Field.Description>
  <!-- Each ticked box sends genreIds. -->
  <div class="flex flex-wrap gap-2">
    {#each genres as genre (genre.id)}
      <label class={CHIP}>
        <input
          class="sr-only"
          type="checkbox"
          name="genreIds"
          value={genre.id}
          bind:group={genreIds}
        />
        {genre.name}
      </label>
    {/each}
  </div>
</Field.Set>

<Field.Set>
  <Field.Legend variant="label">Animation</Field.Legend>
  <!-- Radio buttons: exactly one is picked. -->
  <div class="flex flex-wrap gap-2">
    {#each ANIMATION as choice (choice.value)}
      <label class={CHIP}>
        <input
          class="sr-only"
          type="radio"
          name="animation"
          value={choice.value}
          bind:group={animation}
        />
        {choice.label}
      </label>
    {/each}
  </div>
</Field.Set>

<Field.Set>
  <Field.Legend variant="label">Age rating</Field.Legend>
  <Field.Description
    >Pick any; none means all. R includes NC-17.</Field.Description
  >
  <div class="flex flex-wrap gap-2">
    {#each RATINGS as rating (rating)}
      <label class={CHIP}>
        <input
          class="sr-only"
          type="checkbox"
          name="ratings"
          value={rating}
          bind:group={ratings}
        />
        {ratingLabel(rating)}
      </label>
    {/each}
  </div>
</Field.Set>

<Field.Field>
  <Field.Label for="runtime">Length</Field.Label>
  <NativeSelect
    id="runtime"
    class="w-full"
    name="maxRuntime"
    bind:value={runtime}
  >
    <option value="">Any length</option>
    {#each RUNTIME_CHOICES as minutes (minutes)}
      <option value={String(minutes)}>
        Up to {formatRuntime(minutes)}
      </option>
    {/each}
  </NativeSelect>
</Field.Field>

<Field.Set>
  <Field.Legend variant="label">Release year</Field.Legend>
  <div class="grid grid-cols-2 gap-3">
    <Input
      type="number"
      inputmode="numeric"
      name="minYear"
      min={YEAR_MIN}
      max={YEAR_MAX}
      placeholder="From"
      aria-label="From year"
      bind:value={minYear}
    />
    <Input
      type="number"
      inputmode="numeric"
      name="maxYear"
      min={YEAR_MIN}
      max={YEAR_MAX}
      placeholder="To"
      aria-label="To year"
      bind:value={maxYear}
    />
  </div>
</Field.Set>
