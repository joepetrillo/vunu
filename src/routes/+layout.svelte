<script lang="ts">
  import type { Snippet } from "svelte";

  import "./layout.css";
  import favicon from "#lib/assets/favicon.svg";
  import { applyTheme, setTheme, Theme } from "#lib/theme.svelte.ts";

  let { children }: { children: Snippet } = $props();

  // One theme for the page, handed to any component below through context
  // (like a React context provider or an Angular service provided here).
  const theme = new Theme();
  setTheme(theme);

  // <html> is outside Svelte's tree, so an effect keeps it in step: after a
  // pick, a pick in another tab, or the device switching while on System.
  // The script in app.html already did the first paint.
  $effect(() => {
    applyTheme(theme.dark);
  });
</script>

<svelte:window onstorage={theme.followOtherTabs} />

<svelte:head>
  <link rel="icon" href={favicon} />
  <meta name="application-name" content="Vunu" />
  <meta
    name="description"
    content="Find movies nobody in your group has seen."
  />
</svelte:head>
{@render children()}
