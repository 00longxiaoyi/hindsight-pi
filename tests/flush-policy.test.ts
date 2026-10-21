import { describe, expect, it } from "vitest";
import { shouldFlushOn } from "../extensions/flush-policy.js";
import { FlushRunner } from "../extensions/flush-runner.js";

const decide = (frequency: Parameters<typeof shouldFlushOn>[0]["frequency"], event: Parameters<typeof shouldFlushOn>[0]["event"], turnsSinceLastFlush = 1) =>
  shouldFlushOn({ frequency, event, turnsSinceLastFlush });

describe("flush policy", () => {
  it("flushes on the turn boundary by default", () => {
    expect(decide("turn", "turn")).toBe(true);
    expect(decide("turn", "message")).toBe(false);
  });

  it("falls back to turn semantics for unknown frequencies", () => {
    expect(decide("nonsense" as any, "turn")).toBe(true);
    expect(decide("nonsense" as any, "message")).toBe(false);
  });

  it("only flushes every message in async mode", () => {
    expect(decide("async", "message")).toBe(true);
    expect(decide("async", "turn")).toBe(false);
  });

  it("never flushes mid-session in session mode", () => {
    expect(decide("session", "message")).toBe(false);
    expect(decide("session", "turn")).toBe(false);
  });

  it("flushes every N turns for numeric frequencies", () => {
    expect(decide(3, "turn", 2)).toBe(false);
    expect(decide(3, "turn", 3)).toBe(true);
    expect(decide(3, "message", 3)).toBe(false);
  });

  it("always flushes on a session boundary", () => {
    for (const frequency of ["turn", "session", "async", 5] as const) {
      expect(decide(frequency, "boundary", 0)).toBe(true);
    }
  });
});

const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

describe("flush runner", () => {
  it("coalesces requests made while a flush is in flight", async () => {
    const gate = deferred();
    let runs = 0;
    const runner = new FlushRunner(async () => { runs += 1; await gate.promise; });

    runner.request();
    runner.request();
    runner.request();
    expect(runner.runCount).toBe(1);

    const idle = runner.whenIdle();
    gate.resolve();
    await idle;

    // One run for the in-flight batch plus exactly one trailing run.
    expect(runs).toBe(2);
    expect(runner.runCount).toBe(2);
  });

  it("reports task errors without rejecting the trigger", async () => {
    const errors: unknown[] = [];
    const runner = new FlushRunner(async () => { throw new Error("upload failed"); }, (error) => errors.push(error));

    runner.request();
    await runner.whenIdle();

    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe("upload failed");
  });

  it("keeps running after a failure so the next trigger retries", async () => {
    let attempts = 0;
    const runner = new FlushRunner(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("first attempt fails");
    }, () => {});

    runner.request();
    await runner.whenIdle();
    runner.request();
    await runner.whenIdle();

    expect(attempts).toBe(2);
  });

  it("resolves whenIdle immediately when nothing was requested", async () => {
    const runner = new FlushRunner(async () => { throw new Error("should not run"); });
    await expect(runner.whenIdle()).resolves.toBeUndefined();
    expect(runner.runCount).toBe(0);
  });
});
