<script lang="ts">
  import type { ResolvedPathname } from "$app/types";
  import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
  import type { Snippet } from "svelte";

  import HugeiconsIcon from "#lib/components/HugeiconsIcon.svelte";
  import { Badge } from "#lib/components/ui/badge/index.ts";
  import * as Item from "#lib/components/ui/item/index.ts";
  import { formatCount } from "#lib/format.ts";

  interface Props {
    href: ResolvedPathname;
    title: string;
    description?: string;
    /** Shown before the chevron. */
    count?: number;
    /** Shown before the title, like an icon. */
    media?: Snippet;
  }

  let { href, title, description, count, media }: Props = $props();
</script>

<!-- One row of a ListGroup that opens another screen: the whole row is the
     link, with a chevron to say so. -->
<li>
  <Item.Root class="rounded-none">
    {#snippet child({ props })}
      <a {href} {...props}>
        {#if media}
          <Item.Media>{@render media()}</Item.Media>
        {/if}
        <Item.Content class="min-w-0">
          <!-- wrap-anywhere, not break-words: only it lets a name with no
               spaces wrap instead of pushing the row wider. -->
          <Item.Title class="wrap-anywhere">{title}</Item.Title>
          {#if description}
            <Item.Description class="wrap-anywhere"
              >{description}</Item.Description
            >
          {/if}
        </Item.Content>
        {#if count !== undefined}
          <Badge variant="secondary" class="shrink-0 tabular-nums"
            >{formatCount(count)}</Badge
          >
        {/if}
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          class="size-5 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
      </a>
    {/snippet}
  </Item.Root>
</li>
