<script lang="ts">
  import { enhance } from "$app/forms";
  import { resolve } from "$app/paths";
  import Share2Icon from "@lucide/svelte/icons/share-2";

  import { ActionForm } from "#lib/action-form.svelte.ts";
  import ConfirmDialog from "#lib/components/ConfirmDialog.svelte";
  import { Button } from "#lib/components/ui/button/index.ts";
  import * as Card from "#lib/components/ui/card/index.ts";

  interface Props {
    groupId: string;
    groupName: string;
    code: string;
    url: string;
    isOwner: boolean;
  }

  let { groupId, groupName, code, url, isOwner }: Props = $props();

  // What the share button last did, shown next to it.
  let status = $state<string | null>(null);

  // The card shows on the group page (while you're alone) and the members
  // screen; the reset lives with the members screen's actions.
  let resetAction = $derived(
    resolve(`/groups/[groupId]/members?/resetInvite` as const, { groupId })
  );

  const reset = new ActionForm({ scope: () => groupId });
  let resetForm = $state<HTMLFormElement>();
  let confirmingReset = $state(false);

  // Phones open their share sheet (Messages, WhatsApp, …); browsers without
  // one copy the link instead.
  async function share() {
    status = null;
    const text = `Join ${groupName} on Vunu (code ${code})`;
    // TypeScript's DOM types say every browser has `share`; desktop Firefox
    // doesn't, so check on a plain object.
    if (!("share" in (navigator as object))) {
      await copyLink();
      return;
    }
    try {
      await navigator.share({ title: text, text, url });
    } catch {
      // Closing the sheet without picking anything, or a quick second tap:
      // iOS Safari allows one sheet at a time and throws until the last has
      // fully closed. Either way there's nothing to say, and the next tap
      // simply tries again. No state is kept, so nothing can get stuck.
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      status = "Link copied.";
    } catch {
      status = "Couldn't copy. Copy the link above instead.";
    }
  }
</script>

<Card.Root role="region" aria-labelledby="invite-heading">
  <Card.Header>
    <Card.Title id="invite-heading">Invite people</Card.Title>
    <Card.Description>Anyone with this link or code can join.</Card.Description>
  </Card.Header>
  <Card.Content>
    <p
      class="font-mono text-4xl font-semibold tracking-[0.25em]"
      aria-label="Invite code"
    >
      {code}
    </p>
    <p class="mt-2 text-sm wrap-anywhere text-muted-foreground">{url}</p>
  </Card.Content>
  <Card.Footer class="flex flex-col items-stretch gap-3">
    <Button size="lg" onclick={share}>
      <Share2Icon data-icon="inline-start" />
      Share invite
    </Button>
    {#if isOwner}
      <form
        bind:this={resetForm}
        class="flex flex-col"
        method="POST"
        action={resetAction}
        use:enhance={reset.submit}
      >
        <!-- Asks first; the dialog's Reset invite submits this form. -->
        <Button
          variant="ghost"
          disabled={reset.saving}
          onclick={() => (confirmingReset = true)}
        >
          {reset.saving ? "Resetting…" : "Reset invite"}
        </Button>
      </form>
      <ConfirmDialog
        bind:open={confirmingReset}
        title="Reset the invite?"
        description="The current link and code will stop working. Anyone who hasn't joined yet will need the new one."
        confirmLabel="Reset invite"
        destructive
        onconfirm={() => resetForm?.requestSubmit()}
      />
    {/if}
    <!-- Polite: announced after whatever the screen reader is saying. -->
    <p class="text-center text-sm text-balance empty:hidden" aria-live="polite">
      {status}
    </p>
    {#if reset.error}
      <p class="text-sm text-destructive" role="alert">{reset.error}</p>
    {/if}
  </Card.Footer>
</Card.Root>
