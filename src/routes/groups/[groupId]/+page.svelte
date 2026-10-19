<script lang="ts">
  import { resolve } from "$app/paths";

  import ListGroup from "#lib/components/ListGroup.svelte";
  import NavRow from "#lib/components/NavRow.svelte";
  import Page from "#lib/components/Page.svelte";
  import { Button } from "#lib/components/ui/button/index.ts";
  import { listNames } from "#lib/format.ts";

  import type { PageProps } from "./$types";
  import InviteCard from "./InviteCard.svelte";

  let { data }: PageProps = $props();

  let group = $derived(data.group);
  let groupId = $derived({ groupId: group.id });
  let alone = $derived(group.members.length === 1);
</script>

<svelte:head><title>{group.name} · Vunu</title></svelte:head>

<Page title={group.name} back={{ href: resolve("/"), label: "Home" }}>
  <!-- Nothing to start: the deck is always there, and everyone in the
       group counts toward every match. -->
  <Button
    size="lg"
    class="mb-8 w-full"
    href={resolve("/groups/[groupId]/find/preferences", groupId)}
  >
    Find a movie
  </Button>

  {#if alone}
    <div class="mb-8">
      <InviteCard
        groupId={group.id}
        groupName={group.name}
        code={group.inviteCode}
        url={data.inviteUrl}
        isOwner={group.me.role === "owner"}
      />
    </div>
  {/if}

  <nav aria-label="This group" class="flex flex-col gap-6">
    <ListGroup>
      <NavRow
        href={resolve("/groups/[groupId]/matches", groupId)}
        title="Matches"
        description={data.matchCount === 0
          ? "None yet"
          : "Nobody here has seen these"}
        count={data.matchCount}
      />
      <NavRow
        href={resolve("/groups/[groupId]/watched", groupId)}
        title="Watched"
        description="Movies this group has watched"
        count={data.watchedCount}
      />
    </ListGroup>

    <ListGroup>
      <NavRow
        href={resolve("/groups/[groupId]/members", groupId)}
        title="Members"
        description={listNames(group.members.map((m) => m.nickname))}
        count={group.members.length}
      />
      <NavRow
        href={resolve("/groups/[groupId]/settings", groupId)}
        title="Settings"
        description={group.me.role === "owner"
          ? "Names, leave or delete the group"
          : "Your name here, leave the group"}
      />
    </ListGroup>
  </nav>
</Page>
