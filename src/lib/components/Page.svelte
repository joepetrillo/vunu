<script lang="ts">
  import type { ResolvedPathname } from "$app/types";
  import ArrowLeft01Icon from "@hugeicons/core-free-icons/ArrowLeft01Icon";
  import type { Snippet } from "svelte";

  import HugeiconsIcon from "#lib/components/HugeiconsIcon.svelte";
  import { Button } from "#lib/components/ui/button/index.ts";

  interface Props {
    title: string;
    /** One line under the title. */
    description?: string;
    /** Where the back link goes, like an iOS navigation bar's back button. */
    back?: { href: ResolvedPathname; label: string };
    children: Snippet;
  }

  let { title, description, back, children }: Props = $props();
</script>

<!-- The page draws edge to edge (viewport-fit=cover in app.html), so padding
     keeps content clear of the notch, rounded corners, and home indicator. -->
<main
  class="mx-auto w-full max-w-xl pt-[max(env(safe-area-inset-top),1.5rem)] pr-[max(env(safe-area-inset-right),1.25rem)] pb-[max(env(safe-area-inset-bottom),2.5rem)] pl-[max(env(safe-area-inset-left),1.25rem)]"
>
  {#if back}
    <!-- Pulled left so the chevron lines up with the title below it. A
         long group name truncates instead of widening the page. -->
    <Button
      href={back.href}
      variant="ghost"
      size="sm"
      class="-ml-3 max-w-[calc(100%+0.75rem)]"
    >
      <HugeiconsIcon icon={ArrowLeft01Icon} data-icon="inline-start" />
      <span class="truncate">{back.label}</span>
    </Button>
  {/if}
  <header class={[back ? "mt-3" : "mt-6", "mb-8"]}>
    <h1 class="text-3xl font-bold tracking-tight wrap-anywhere">{title}</h1>
    {#if description}
      <p class="mt-2 text-balance text-muted-foreground">{description}</p>
    {/if}
  </header>
  {@render children()}
</main>
