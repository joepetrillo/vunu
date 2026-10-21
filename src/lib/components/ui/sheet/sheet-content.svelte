<script lang="ts" module>
  export type Side = "top" | "right" | "bottom" | "left";
</script>

<script lang="ts">
  import XIcon from "@lucide/svelte/icons/x";
  import { Dialog as SheetPrimitive } from "bits-ui";
  import type { Snippet } from "svelte";
  import type { ComponentProps } from "svelte";

  import { Button } from "#lib/components/ui/button/index.ts";
  import { cn, type WithoutChildrenOrChild } from "#lib/utils.ts";

  import SheetOverlay from "./sheet-overlay.svelte";
  import SheetPortal from "./sheet-portal.svelte";

  let {
    ref = $bindable(null),
    class: className,
    side = "right",
    showCloseButton = true,
    portalProps,
    children,
    ...restProps
  }: WithoutChildrenOrChild<SheetPrimitive.ContentProps> & {
    portalProps?: WithoutChildrenOrChild<ComponentProps<typeof SheetPortal>>;
    side?: Side;
    showCloseButton?: boolean;
    children: Snippet;
  } = $props();
</script>

<!-- The sheet slides the whole way in from its edge and leaves the way it
     came, on the steep sheet curve; the overlay fades on the same clock.
     With less motion it fades instead (layout.css). -->
<SheetPortal {...portalProps}>
  <SheetOverlay />
  <SheetPrimitive.Content
    bind:ref
    data-slot="sheet-content"
    data-side={side}
    class={cn(
      "fixed z-50 flex flex-col bg-popover bg-clip-padding text-sm text-popover-foreground shadow-lg ease-sheet data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto data-[side=bottom]:border-t data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-full data-[side=left]:w-3/4 data-[side=left]:border-r data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-full data-[side=right]:w-3/4 data-[side=right]:border-l data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto data-[side=top]:border-b data-[side=left]:sm:max-w-sm data-[side=right]:sm:max-w-sm data-open:animate-in data-open:duration-(--duration-sheet-in) data-[side=bottom]:data-open:slide-in-from-bottom data-[side=left]:data-open:slide-in-from-left data-[side=right]:data-open:slide-in-from-right data-[side=top]:data-open:slide-in-from-top data-closed:animate-out data-closed:duration-(--duration-sheet-out) data-[side=bottom]:data-closed:slide-out-to-bottom data-[side=left]:data-closed:slide-out-to-left data-[side=right]:data-closed:slide-out-to-right data-[side=top]:data-closed:slide-out-to-top",
      className
    )}
    {...restProps}
  >
    {@render children()}
    {#if showCloseButton}
      <SheetPrimitive.Close data-slot="sheet-close">
        {#snippet child({ props })}
          <Button
            variant="ghost"
            class="absolute top-4 right-4"
            size="icon-sm"
            {...props}
          >
            <XIcon />
            <span class="sr-only">Close</span>
          </Button>
        {/snippet}
      </SheetPrimitive.Close>
    {/if}
  </SheetPrimitive.Content>
</SheetPortal>
