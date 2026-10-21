<script lang="ts">
  import { Dialog as SheetPrimitive } from "bits-ui";

  import { cn } from "#lib/utils.ts";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: SheetPrimitive.OverlayProps = $props();
</script>

<SheetPrimitive.Overlay
  bind:ref
  data-slot="sheet-overlay"
  class={cn(
    "fixed inset-0 z-50 bg-black/80 ease-sheet supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:duration-(--duration-sheet-in) data-open:fade-in-0 data-closed:animate-out data-closed:duration-(--duration-sheet-out) data-closed:fade-out-0",
    className
  )}
  {...restProps}
/>
