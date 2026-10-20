<script lang="ts">
  import ComputerPhoneSyncIcon from "@hugeicons/core-free-icons/ComputerPhoneSyncIcon";
  import Moon02Icon from "@hugeicons/core-free-icons/Moon02Icon";
  import PaintBoardIcon from "@hugeicons/core-free-icons/PaintBoardIcon";
  import Sun03Icon from "@hugeicons/core-free-icons/Sun03Icon";

  import HugeiconsIcon from "#lib/components/HugeiconsIcon.svelte";
  import * as Item from "#lib/components/ui/item/index.ts";
  import * as ToggleGroup from "#lib/components/ui/toggle-group/index.ts";
  import {
    getTheme,
    themeChoiceSchema,
    type ThemeChoice,
  } from "#lib/theme.svelte.ts";

  const theme = getTheme();
  const id = $props.id();

  const options = [
    { value: "light", label: "Light", icon: Sun03Icon },
    { value: "dark", label: "Dark", icon: Moon02Icon },
    { value: "system", label: "System", icon: ComputerPhoneSyncIcon },
  ] as const;

  // Says the pick in words, since the buttons are only icons.
  const described: Record<ThemeChoice, string> = {
    light: "Always light",
    dark: "Always dark",
    system: "Same as this device",
  };
</script>

<!-- A row for a ListGroup: Light, Dark, or System (follow the device). -->
<li>
  <Item.Root class="rounded-none">
    <Item.Media>
      <HugeiconsIcon icon={PaintBoardIcon} class="size-5" />
    </Item.Media>
    <!-- Room for the description: on a narrow phone the buttons move to
         their own line instead of squeezing it to "Same as…". -->
    <Item.Content class="min-w-32">
      <Item.Title id="{id}-label">Appearance</Item.Title>
      <!-- Until the app loads, nobody knows the pick (it's only in this
           browser), so the line holds its place unseen instead of guessing. -->
      <Item.Description class={[theme.choice === null && "invisible"]}>
        {described[theme.choice ?? "system"]}
      </Item.Description>
    </Item.Content>
    <Item.Actions>
      <!-- A function binding: reads the theme (nothing selected until the
           app loads), and writes only real picks. Tapping the selected button
           again would otherwise clear it. -->
      <ToggleGroup.Root
        type="single"
        variant="outline"
        size="lg"
        aria-labelledby="{id}-label"
        bind:value={
          () => theme.choice ?? "",
          (value) => {
            const choice = themeChoiceSchema.safeParse(value);
            if (choice.success) theme.pick(choice.data);
          }
        }
      >
        {#each options as option (option.value)}
          <!-- 44px: big enough to hit with a thumb. -->
          <ToggleGroup.Item
            class="h-11 min-w-11"
            value={option.value}
            aria-label={option.label}
            title={option.label}
          >
            <HugeiconsIcon icon={option.icon} />
          </ToggleGroup.Item>
        {/each}
      </ToggleGroup.Root>
    </Item.Actions>
  </Item.Root>
</li>
