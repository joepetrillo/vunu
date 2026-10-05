import { afterEach, describe, expect, it, vi } from "vitest";

const send = vi.hoisted(() => vi.fn());
vi.mock("resend", () => ({
  Resend: class {
    emails = { send };
  },
}));

async function sender(env: { RESEND_API_KEY?: string; VERCEL_ENV?: string }) {
  vi.resetModules();
  vi.doMock("$app/env/private", () => ({
    RESEND_API_KEY: undefined,
    VERCEL_ENV: undefined,
    ...env,
  }));
  return import("./email.ts");
}

afterEach(() => {
  vi.restoreAllMocks();
  send.mockReset();
});

describe("sign-in email delivery", () => {
  it.each(["production", "preview"])(
    "fails closed without a key in %s",
    async (VERCEL_ENV) => {
      const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
      await expect(sender({ VERCEL_ENV })).rejects.toThrow(/RESEND_API_KEY/);
      expect(log).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    }
  );

  it("allows terminal delivery locally", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { sendSignInCode } = await sender({});
    await sendSignInCode("test@example.test", "123456");

    expect(log).toHaveBeenCalledWith(
      "[email] Sign-in code for test@example.test: 123456"
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("awaits delivery and allows an intentional resend of the same code", async () => {
    const delivery = Promise.withResolvers<{
      data: { id: string };
      error: null;
    }>();
    send.mockReturnValueOnce(delivery.promise);
    const { sendSignInCode } = await sender({ RESEND_API_KEY: "re_mock" });
    let finished = false;
    const pending = sendSignInCode("test@example.test", "123456").then(() => {
      finished = true;
    });
    await Promise.resolve();
    expect(finished).toBe(false);
    delivery.resolve({ data: { id: "mock-email" }, error: null });
    await pending;
    expect(finished).toBe(true);

    send.mockResolvedValue({ data: { id: "mock-email" }, error: null });
    await sendSignInCode("test@example.test", "123456");

    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledWith({
      from: "Vunu <hello@vunu.app>",
      to: "test@example.test",
      subject: "123456 is your Vunu sign-in code",
      text: "Your Vunu sign-in code is 123456. It expires in 5 minutes.\n\nIf you didn't try to sign in, you can ignore this email.",
    });
  });

  it("rejects returned provider errors without exposing provider message content", async () => {
    send.mockResolvedValue({
      data: null,
      error: {
        name: "validation_error",
        message: "private recipient/code details",
      },
    });
    const { sendSignInCode } = await sender({ RESEND_API_KEY: "re_mock" });

    await expect(sendSignInCode("test@example.test", "123456")).rejects.toThrow(
      "Resend failed to send the sign-in code (validation_error)."
    );
  });

  it("doesn't retry a transport failure with an uncertain delivery outcome", async () => {
    send.mockRejectedValue(new Error("transport failed"));
    const { sendSignInCode } = await sender({ RESEND_API_KEY: "re_mock" });
    await expect(sendSignInCode("test@example.test", "123456")).rejects.toThrow(
      "transport failed"
    );
    expect(send).toHaveBeenCalledTimes(1);
  });
});
