import { inArray } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { inviteCodeSchema } from "#lib/group-fields.ts";
import { groupMembers, groups } from "#lib/server/db/schema.ts";
import {
  createGroup,
  deleteGroup,
  getGroupForMember,
  joinGroup,
  lastNickname,
  leaveGroup,
  listGroups,
  MAX_GROUP_MEMBERS,
  MAX_INVITE_LOOKUPS,
  previewInvite,
  removeMember,
  renameGroup,
  resetInvite,
  setNickname,
} from "#lib/server/groups.ts";
import { connectTestDb, createFixtures } from "#lib/server/testing/db.ts";

// Runs against a real database: row locks and unique indexes are what keep
// these rules true under concurrent requests.
const { pool, db } = connectTestDb();
const fixtures = createFixtures(db);
// Deleting the users leaves their groups behind, so track those too.
const groupIds: string[] = [];

afterAll(async () => {
  if (groupIds.length > 0) {
    await db.delete(groups).where(inArray(groups.id, groupIds));
  }
  await fixtures.cleanUp();
  await pool.end();
});

const id = () => crypto.randomUUID();

async function newGroup(ownerId: string, name = "Movie night") {
  const groupId = id();
  groupIds.push(groupId);
  const outcome = await createGroup(db, {
    actionId: id(),
    userId: ownerId,
    groupId,
    name,
    nickname: "Owner",
  });
  expect(outcome).toBe("applied");
  const group = await db.query.groups.findFirst({ where: { id: groupId } });
  if (group === undefined) throw new Error("group wasn't created");
  return group;
}

function join(
  userId: string,
  group: { id: string; inviteCode: string },
  nickname: string
) {
  return joinGroup(db, {
    actionId: id(),
    userId,
    groupId: group.id,
    inviteCode: group.inviteCode,
    nickname,
  });
}

async function members(groupId: string) {
  const rows = await db.query.groupMembers.findMany({
    columns: { userId: true, role: true, nickname: true },
    where: { groupId },
    orderBy: { joinedAt: "asc" },
  });
  return rows;
}

describe("creating a group", () => {
  it("makes the creator its owner with a valid invite code", async () => {
    const owner = await fixtures.user();
    const group = await newGroup(owner);

    expect(inviteCodeSchema.safeParse(group.inviteCode).data).toBe(
      group.inviteCode
    );
    expect(await members(group.id)).toEqual([
      { userId: owner, role: "owner", nickname: "Owner" },
    ]);
  });

  it("creates one group when a create is retried", async () => {
    const owner = await fixtures.user();
    const change = {
      actionId: id(),
      userId: owner,
      groupId: id(),
      name: "Retry",
      nickname: "Me",
    };
    groupIds.push(change.groupId);

    expect(await createGroup(db, change)).toBe("applied");
    expect(await createGroup(db, change)).toBe("duplicate");
    expect(await members(change.groupId)).toHaveLength(1);
  });

  it("rejects an action ID reused with different input", async () => {
    const owner = await fixtures.user();
    const change = {
      actionId: id(),
      userId: owner,
      groupId: id(),
      name: "First",
      nickname: "Me",
    };
    groupIds.push(change.groupId);

    expect(await createGroup(db, change)).toBe("applied");
    expect(await createGroup(db, { ...change, name: "Second" })).toBe(
      "conflict"
    );
  });
});

describe("joining with an invite code", () => {
  let owner: string;
  let group: Awaited<ReturnType<typeof newGroup>>;

  beforeEach(async () => {
    owner = await fixtures.user();
    group = await newGroup(owner);
  });

  it("adds the person as a member", async () => {
    const friend = await fixtures.user();
    expect(await join(friend, group, "Sam")).toBe("applied");
    expect(await members(group.id)).toEqual([
      { userId: owner, role: "owner", nickname: "Owner" },
      { userId: friend, role: "member", nickname: "Sam" },
    ]);
    expect(await lastNickname(db, friend)).toBe("Sam");
  });

  it("changes nothing for someone already in the group", async () => {
    expect(await join(owner, group, "Someone else")).toBe("applied");
    expect(await members(group.id)).toEqual([
      { userId: owner, role: "owner", nickname: "Owner" },
    ]);
  });

  it("refuses a nickname already used in the group, ignoring case", async () => {
    const friend = await fixtures.user();
    const change = {
      actionId: id(),
      userId: friend,
      groupId: group.id,
      inviteCode: group.inviteCode,
      nickname: "OWNER",
    };
    expect(await joinGroup(db, change)).toBe("nickname_taken");
    // The refusal logged nothing, so the same action ID with a new name runs.
    expect(await joinGroup(db, { ...change, nickname: "Sam" })).toBe("applied");
  });

  it("refuses a wrong code and an old code after a reset", async () => {
    const friend = await fixtures.user();
    expect(await join(friend, { ...group, inviteCode: "ZZZZZZ" }, "Sam")).toBe(
      "invite_invalid"
    );
    // The right code with a different group's ID is no better.
    expect(await join(friend, { ...group, id: id() }, "Sam")).toBe(
      "invite_invalid"
    );

    const reset = await resetInvite(db, {
      actionId: id(),
      userId: owner,
      groupId: group.id,
    });
    expect(reset).toBe("applied");
    expect(await join(friend, group, "Sam")).toBe("invite_invalid");

    const fresh = await db.query.groups.findFirst({ where: { id: group.id } });
    if (fresh === undefined) throw new Error("group disappeared");
    expect(fresh.inviteCode).not.toBe(group.inviteCode);
    expect(await join(friend, fresh, "Sam")).toBe("applied");
  });

  it("recognizes a retried join even after the code was reset", async () => {
    const change = {
      actionId: id(),
      userId: await fixtures.user(),
      groupId: group.id,
      inviteCode: group.inviteCode,
      nickname: "Sam",
    };
    expect(await joinGroup(db, change)).toBe("applied");
    await resetInvite(db, { actionId: id(), userId: owner, groupId: group.id });
    expect(await joinGroup(db, change)).toBe("duplicate");
  });

  it("lets exactly one of two simultaneous joins take the last place", async () => {
    // Fill the group directly (tests may write fixtures) up to one free place.
    const fillers = await Promise.all(
      Array.from({ length: MAX_GROUP_MEMBERS - 2 }, () => fixtures.user())
    );
    await db.insert(groupMembers).values(
      fillers.map((userId, i) => ({
        groupId: group.id,
        userId,
        role: "member" as const,
        nickname: `Filler ${String(i)}`,
      }))
    );

    const [a, b] = [await fixtures.user(), await fixtures.user()];
    const outcomes = await Promise.all([
      join(a, group, "A"),
      join(b, group, "B"),
    ]);

    expect(outcomes.sort()).toEqual(["applied", "group_full"]);
    expect(await members(group.id)).toHaveLength(MAX_GROUP_MEMBERS);
  });
});

describe("invite lookup limit", () => {
  it(`allows ${String(MAX_INVITE_LOOKUPS)} lookups, then refuses`, async () => {
    const owner = await fixtures.user();
    const group = await newGroup(owner);
    const guesser = await fixtures.user();

    for (let i = 0; i < MAX_INVITE_LOOKUPS; i++) {
      const preview = await previewInvite(db, guesser, "ZZZZZZ");
      expect(preview.status).toBe("invite_invalid");
    }
    // Even the right code is refused now, and joining counts too.
    const preview = await previewInvite(db, guesser, group.inviteCode);
    expect(preview.status).toBe("too_many_lookups");
    expect(await join(guesser, group, "G")).toBe("too_many_lookups");
  });

  it("recognizes a retried join even at the lookup limit", async () => {
    const owner = await fixtures.user();
    const group = await newGroup(owner);
    const friend = await fixtures.user();
    const change = {
      actionId: id(),
      userId: friend,
      groupId: group.id,
      inviteCode: group.inviteCode,
      nickname: "Sam",
    };
    expect(await joinGroup(db, change)).toBe("applied");
    // Use up the rest of the window, as if the response was lost meanwhile.
    for (let i = 1; i < MAX_INVITE_LOOKUPS; i++) {
      await previewInvite(db, friend, "ZZZZZZ");
    }
    expect(await joinGroup(db, change)).toBe("duplicate");
    // A new attempt is still refused.
    expect(await join(friend, group, "Other")).toBe("too_many_lookups");
  });

  it("shows the group to someone holding its code", async () => {
    const owner = await fixtures.user();
    const group = await newGroup(owner, "Friday films");
    const friend = await fixtures.user();

    expect(await previewInvite(db, friend, group.inviteCode)).toEqual({
      status: "found",
      id: group.id,
      name: "Friday films",
      isMember: false,
    });
    expect(await previewInvite(db, owner, group.inviteCode)).toMatchObject({
      isMember: true,
    });
  });
});

describe("leaving", () => {
  it("hands ownership to the longest-standing member", async () => {
    const owner = await fixtures.user();
    const group = await newGroup(owner);
    const [first, second] = [await fixtures.user(), await fixtures.user()];
    await join(first, group, "First");
    await join(second, group, "Second");

    const change = { actionId: id(), userId: owner, groupId: group.id };
    expect(await leaveGroup(db, change)).toBe("applied");
    expect(await leaveGroup(db, change)).toBe("duplicate");

    expect(await members(group.id)).toEqual([
      { userId: first, role: "owner", nickname: "First" },
      { userId: second, role: "member", nickname: "Second" },
    ]);
  });

  it("deletes the group when the last member leaves", async () => {
    const owner = await fixtures.user();
    const group = await newGroup(owner);
    expect(
      await leaveGroup(db, { actionId: id(), userId: owner, groupId: group.id })
    ).toBe("applied");
    expect(
      await db.query.groups.findFirst({ where: { id: group.id } })
    ).toBeUndefined();
  });
});

describe("owner actions", () => {
  let owner: string;
  let member: string;
  let group: Awaited<ReturnType<typeof newGroup>>;

  beforeEach(async () => {
    owner = await fixtures.user();
    member = await fixtures.user();
    group = await newGroup(owner, "Before");
    await join(member, group, "Member");
  });

  it("lets the owner rename, remove, and delete", async () => {
    const base = { userId: owner, groupId: group.id };
    expect(
      await renameGroup(db, { ...base, actionId: id(), name: "After" })
    ).toBe("applied");
    expect((await getGroupForMember(db, group.id, owner))?.name).toBe("After");

    expect(
      await removeMember(db, { ...base, actionId: id(), memberId: member })
    ).toBe("applied");
    expect(await getGroupForMember(db, group.id, member)).toBeNull();
    // A removed member can come back with the invite.
    expect(await join(member, group, "Member")).toBe("applied");

    const deletion = { ...base, actionId: id() };
    expect(await deleteGroup(db, deletion)).toBe("applied");
    // The log outlives the group, so a retry is still recognized.
    expect(await deleteGroup(db, deletion)).toBe("duplicate");
    expect(await getGroupForMember(db, group.id, owner)).toBeNull();
  });

  it("refuses owner actions from a member", async () => {
    const base = { userId: member, groupId: group.id };
    expect(await renameGroup(db, { ...base, actionId: id(), name: "X" })).toBe(
      "not_owner"
    );
    expect(
      await removeMember(db, { ...base, actionId: id(), memberId: owner })
    ).toBe("not_owner");
    expect(await resetInvite(db, { ...base, actionId: id() })).toBe(
      "not_owner"
    );
    expect(await deleteGroup(db, { ...base, actionId: id() })).toBe(
      "not_owner"
    );
    expect((await getGroupForMember(db, group.id, owner))?.name).toBe("Before");
  });

  it("makes the owner leave instead of removing themselves", async () => {
    expect(
      await removeMember(db, {
        actionId: id(),
        userId: owner,
        groupId: group.id,
        memberId: owner,
      })
    ).toBe("cannot_remove_self");
  });
});

describe("nicknames", () => {
  it("can change case of your own but not take someone else's", async () => {
    const owner = await fixtures.user();
    const group = await newGroup(owner);
    const friend = await fixtures.user();
    await join(friend, group, "sam");
    const base = { userId: friend, groupId: group.id };

    expect(
      await setNickname(db, { ...base, actionId: id(), nickname: "Sam" })
    ).toBe("applied");
    expect(
      await setNickname(db, { ...base, actionId: id(), nickname: "owner" })
    ).toBe("nickname_taken");
    expect(
      (await members(group.id)).find((m) => m.userId === friend)?.nickname
    ).toBe("Sam");
  });
});

describe("non-members", () => {
  it("can't read or change a group", async () => {
    const owner = await fixtures.user();
    const group = await newGroup(owner, "Private");
    const stranger = await fixtures.user();
    const base = { userId: stranger, groupId: group.id };

    expect(await getGroupForMember(db, group.id, stranger)).toBeNull();
    expect(await listGroups(db, stranger)).toEqual([]);
    // Every change answers "not found", the same as for a missing group.
    const outcomes = await Promise.all([
      leaveGroup(db, { ...base, actionId: id() }),
      renameGroup(db, { ...base, actionId: id(), name: "Mine" }),
      deleteGroup(db, { ...base, actionId: id() }),
      resetInvite(db, { ...base, actionId: id() }),
      setNickname(db, { ...base, actionId: id(), nickname: "Spy" }),
      removeMember(db, { ...base, actionId: id(), memberId: owner }),
    ]);
    expect(outcomes).toEqual(Array<string>(6).fill("not_found"));

    const after = await getGroupForMember(db, group.id, owner);
    expect(after).toMatchObject({
      name: "Private",
      inviteCode: group.inviteCode,
    });
    expect(after?.members).toEqual([
      { userId: owner, nickname: "Owner", role: "owner" },
    ]);
  });

  it("can't tell a missing group from someone else's", async () => {
    const stranger = await fixtures.user();
    expect(
      await renameGroup(db, {
        actionId: id(),
        userId: stranger,
        groupId: id(),
        name: "X",
      })
    ).toBe("not_found");
  });
});

describe("listing groups", () => {
  it("shows the user's groups with member counts and their role", async () => {
    const owner = await fixtures.user();
    const friend = await fixtures.user();
    const group = await newGroup(owner, "Listed");
    await join(friend, group, "Friend");

    expect(await listGroups(db, friend)).toEqual([
      { id: group.id, name: "Listed", role: "member", memberCount: 2 },
    ]);
  });
});
