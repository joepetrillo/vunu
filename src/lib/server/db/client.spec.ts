import { expect, it, vi } from "vitest";

import { createDb } from "./client.ts";

it("handles idle pool errors without leaking the error payload", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const { pool } = createDb("postgres://test:test@localhost/disposable", 1);
  try {
    expect(() =>
      pool.emit("error", new Error("private connection details"))
    ).not.toThrow();
    expect(log).toHaveBeenCalledWith("[db] An idle connection failed.", {
      code: undefined,
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain(
      "private connection details"
    );
  } finally {
    await pool.end();
    log.mockRestore();
  }
});
