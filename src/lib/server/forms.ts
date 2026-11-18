import { type ActionFailure, fail } from "@sveltejs/kit";
import type { z } from "zod";

// Shared by every page's form actions.

export const RELOAD = "Something went wrong. Reload the page and try again.";

/**
 * The request's form fields, or null for a body that isn't a readable form:
 * malformed multipart bodies fail here, before Zod sees any fields.
 */
export async function readFields(request: Request): Promise<FormData | null> {
  return request.formData().catch((error: unknown) => {
    if (error instanceof TypeError) return null;
    throw error;
  });
}

/**
 * The form's fields, validated, or a failure to return from the action.
 * Field errors (an empty nickname, say) carry the schema's own message.
 * A field sent more than once (checkboxes) arrives as a list.
 */
export async function readForm<T extends z.ZodType>(
  request: Request,
  schema: T
): Promise<
  | { ok: true; data: z.output<T> }
  | { ok: false; failure: ActionFailure<{ message: string }> }
> {
  const fields = await readFields(request);
  const form = schema.safeParse(fields === null ? null : collect(fields));
  if (form.success) return { ok: true, data: form.data };
  // A hidden field (an ID) failing means a bug or a tampered request, so
  // only show messages written for people.
  const issue = form.error.issues[0];
  const message =
    issue?.code === "too_small" ||
    issue?.code === "too_big" ||
    issue?.code === "custom"
      ? issue.message
      : RELOAD;
  return { ok: false, failure: fail(400, { message }) };
}

// Like Object.fromEntries, but a name that repeats keeps every value.
function collect(fields: FormData): Record<string, unknown> {
  const values: Record<string, FormDataEntryValue | FormDataEntryValue[]> = {};
  for (const [name, value] of fields) {
    const earlier = values[name];
    values[name] =
      earlier === undefined
        ? value
        : Array.isArray(earlier)
          ? [...earlier, value]
          : [earlier, value];
  }
  return values;
}
