<script lang="ts">
  import type { Snippet } from "svelte";

  import "./layout.css";
  import favicon from "#lib/assets/favicon.svg";

  let { children }: { children: Snippet } = $props();
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
  <meta name="application-name" content="Vunu" />
  <meta
    name="description"
    content="Find movies nobody in your group has seen."
  />
</svelte:head>
{@render children()}
