<script lang="ts">
  import { refreshAll } from "$app/navigation";
  import { resolve } from "$app/paths";
  import Add01Icon from "@hugeicons/core-free-icons/Add01Icon";
  import Film01Icon from "@hugeicons/core-free-icons/Film01Icon";
  import Login03Icon from "@hugeicons/core-free-icons/Login03Icon";
  import UserCircleIcon from "@hugeicons/core-free-icons/UserCircleIcon";

  import { authClient } from "#lib/auth-client.ts";
  import AppearanceRow from "#lib/components/AppearanceRow.svelte";
  import HugeiconsIcon from "#lib/components/HugeiconsIcon.svelte";
  import ListGroup from "#lib/components/ListGroup.svelte";
  import NavRow from "#lib/components/NavRow.svelte";
  import Page from "#lib/components/Page.svelte";
  import { Button } from "#lib/components/ui/button/index.ts";
  import * as Item from "#lib/components/ui/item/index.ts";
  import { formatCount } from "#lib/format.ts";

  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();
  let signingOut = $state(false);
  let errorMessage = $state<string | null>(null);

  // "3 people · 2 matches": who's in it, and whether there's something to
  // watch. Matches are left out until there are some.
  function describeGroup(group: PageProps["data"]["groups"][number]) {
    const people =
      group.memberCount === 1
        ? "Just you"
        : `${formatCount(group.memberCount)} people`;
    if (group.matchCount === 0) return people;
    const matches = group.matchCount === 1 ? "match" : "matches";
    return `${people} · ${formatCount(group.matchCount)} ${matches}`;
  }

  async function signOut() {
    if (signingOut) return;
    signingOut = true;
    errorMessage = null;
    try {
      const { error } = await authClient.signOut();
      if (error !== null) {
        errorMessage = "Couldn't sign out. Try again.";
        return;
      }
      // The cookie is gone; the hook redirects when page data refreshes.
      try {
        await refreshAll();
      } catch {
        errorMessage =
          "Signed out, but couldn't refresh the page. Reload to continue.";
      }
    } catch {
      errorMessage =
        "Couldn't reach Vunu. Check your connection and try again.";
    } finally {
      signingOut = false;
    }
  }
</script>

<svelte:head><title>Vunu</title></svelte:head>

<Page title="Vunu" description="Find movies nobody in your group has seen.">
  <section aria-labelledby="groups-heading">
    <h2 id="groups-heading" class="mb-3 text-xl font-semibold">Your groups</h2>
    {#if data.groups.length === 0}
      <p class="mb-6 text-balance text-muted-foreground">
        You're not in a group yet. Start one for your movie nights, or join a
        friend's.
      </p>
    {:else}
      <ListGroup class="mb-4">
        {#each data.groups as group (group.id)}
          <NavRow
            href={resolve("/groups/[groupId]", { groupId: group.id })}
            title={group.name}
            description={describeGroup(group)}
          />
        {/each}
      </ListGroup>
    {/if}
    <!-- Starting and joining sit together under the list: both add a row
         to it, and neither is needed often once you're in a group. -->
    <div class="grid grid-cols-2 gap-3">
      <Button
        href={resolve("/groups/new")}
        variant={data.groups.length === 0 ? "default" : "secondary"}
        size="lg"
      >
        <HugeiconsIcon icon={Add01Icon} data-icon="inline-start" />
        New group
      </Button>
      <Button href={resolve("/join")} variant="secondary" size="lg">
        <HugeiconsIcon icon={Login03Icon} data-icon="inline-start" />
        Join a group
      </Button>
    </div>
  </section>

  <section class="mt-10" aria-labelledby="you-heading">
    <h2 id="you-heading" class="mb-3 text-xl font-semibold">You</h2>
    <ListGroup>
      <NavRow
        href={resolve("/seen")}
        title="Seen movies"
        count={data.seenCount}
      >
        {#snippet media()}
          <HugeiconsIcon icon={Film01Icon} class="size-5" />
        {/snippet}
      </NavRow>
      <AppearanceRow />
      {#if data.user}
        <li>
          <Item.Root class="rounded-none">
            <Item.Media>
              <HugeiconsIcon icon={UserCircleIcon} class="size-5" />
            </Item.Media>
            <Item.Content class="min-w-0">
              <Item.Title>Signed in</Item.Title>
              <Item.Description class="line-clamp-none break-all"
                >{data.user.email}</Item.Description
              >
            </Item.Content>
            <Item.Actions>
              <Button
                variant="outline"
                size="sm"
                onclick={signOut}
                disabled={signingOut}
              >
                {signingOut ? "Signing out…" : "Sign out"}
              </Button>
            </Item.Actions>
          </Item.Root>
        </li>
      {/if}
    </ListGroup>
    {#if errorMessage}
      <p class="mt-4 text-sm text-destructive" role="alert">{errorMessage}</p>
    {/if}
  </section>
</Page>
