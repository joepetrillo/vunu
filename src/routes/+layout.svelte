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

  function keepKitScrollRestoration(event: PageTransitionEvent) {
    if (event.persisted) history.scrollRestoration = "manual";
  }
</script>

<!-- Kit 3 sets history.scrollRestoration to "manual" and restores the scroll
     position itself after a reload, but only once its JavaScript has loaded,
     so the page first paints at the top and then jumps. Handing a page that's
     being left back to the browser lets it restore the position before the
     first paint; Kit's own restore then lands on the same spot and switches
     back to "manual". A page kept in the back/forward cache never reloads, so
     it switches back here (Kit expects "manual" for its own back and forward). -->
<svelte:window
  onstorage={theme.followOtherTabs}
  onpagehide={() => (history.scrollRestoration = "auto")}
  onpageshow={keepKitScrollRestoration}
/>

<svelte:head>
  <link rel="icon" href={favicon} />
  <meta name="application-name" content="Vunu" />
  <meta
    name="description"
    content="Find movies nobody in your group has seen."
  />
</svelte:head>
{@render children()}
