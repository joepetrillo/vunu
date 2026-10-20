<script lang="ts">
  import MonitorSmartphoneIcon from "@lucide/svelte/icons/monitor-smartphone";
  import MoonIcon from "@lucide/svelte/icons/moon";
  import PaletteIcon from "@lucide/svelte/icons/palette";
  import SunIcon from "@lucide/svelte/icons/sun";

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
    { value: "light", label: "Light", icon: SunIcon },
    { value: "dark", label: "Dark", icon: MoonIcon },
    { value: "system", label: "System", icon: MonitorSmartphoneIcon },
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
      <PaletteIcon class="size-5" />
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
            <option.icon />
          </ToggleGroup.Item>
        {/each}
      </ToggleGroup.Root>
    </Item.Actions>
  </Item.Root>
</li>
