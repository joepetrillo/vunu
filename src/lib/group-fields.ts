import { z } from "zod";

// Rules for what people type into group forms. Shared by the server (which
// validates) and the pages (which show the same limits on their inputs).

export const GROUP_NAME_MAX = 50;
export const NICKNAME_MAX = 30;

// Runs of spaces, tabs, or newlines become one space, so "Sam" and "Sam  "
// (or a pasted line break) can't pass as different names.
function displayText(max: number, label: string) {
  return z
    .string()
    .transform((value) => value.replace(/\s+/g, " ").trim())
    .pipe(
      z
        .string()
        .min(1, { error: `Enter a ${label}.` })
        .max(max, { error: `Keep the ${label} to ${String(max)} characters.` })
    );
}

export const groupNameSchema = displayText(GROUP_NAME_MAX, "group name");
export const nicknameSchema = displayText(NICKNAME_MAX, "nickname");

// No 0/O or 1/I/L: a code read aloud or copied by hand can't be misread.
// 31 characters, 6 long: about 890 million codes.
export const INVITE_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const INVITE_CODE_LENGTH = 6;

/**
 * Accepts a code as people type it ("k7qm 2x", "K7Q-M2X") and outputs the
 * stored form ("K7QM2X"). Anything that can't be a code fails here, before
 * it counts against the lookup limit or reaches the database.
 */
export const inviteCodeSchema = z
  .string()
  .transform((value) => value.replace(/[\s-]/g, "").toUpperCase())
  .pipe(
    z
      .string()
      .length(INVITE_CODE_LENGTH)
      .regex(new RegExp(`^[${INVITE_CODE_ALPHABET}]+$`))
  );
