<script lang="ts">
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import type { ComponentProps } from "svelte";

  import { cn } from "#lib/utils.ts";

  let {
    class: className,
    role = "status",
    "aria-label": ariaLabel = "Loading",
    ...restProps
  }: ComponentProps<typeof LoaderCircleIcon> = $props();
</script>

<LoaderCircleIcon
  {role}
  aria-label={ariaLabel}
  class={cn("size-4 animate-spin", className)}
  {...restProps}
/>
