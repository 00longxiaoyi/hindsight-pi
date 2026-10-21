import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HindsightHandles } from "../extensions/client.js";
import { flushSessionQueue } from "../extensions/flush-session.js";
import { getFlushState, resetFlushState } from "../extensions/flush-state.js";
import { appendQueueRecord, queuePath, readQueueRecords } from "../extensions/queue.js";

let dir: string;
let oldRoot: string | undefined;

beforeEach(() => {
  oldRoot = process.env.HINDSIGHT_QUEUE_ROOT;
  dir = mkdtempSync(join(tmpdir(), "hindsight-flush-"));
  process.env.HINDSIGHT_QUEUE_ROOT = dir;
  resetFlushState();
});

afterEach(() => {
  if (oldRoot === undefined) delete process.env.HINDSIGHT_QUEUE_ROOT;
  else process.env.HINDSIGHT_QUEUE_ROOT = oldRoot;
  rmSync(dir, { recursive: true, force: true });
});

const makeHandles = (retainBatch: (bankId: string, items: any[], options?: any) => Promise<unknown>): { handles: HindsightHandles; calls: any[] } => {
  const calls: any[] = [];
  const handles = {
    bankId: "bank-1",
    config: { workspace: "pi", writeFrequency: "turn", saveMessages: true, logging: false },
    client: {
      retainBatch: async (bankId: string, items: any[], options?: any) => {
        calls.push({ bankId, items, options });
        return retainBatch(bankId, items, options);
      },
    },
  } as unknown as HindsightHandles;
  return { handles, calls };
};

const queuedRecord = (sessionId: string, content = "hello") => {
  appendQueueRecord({
    sessionId,
    bankId: "bank-1",
    content,
    context: "pi: session",
    tags: ["harness:pi", `session:${sessionId}`],
    metadata: { source: "pi", kind: "session-message" },
    timestamp: "2026-10-21T08:00:00Z",
    document_id: sessionId,
    update_mode: "append",
    observation_scopes: [["harness:pi"]],
  });
};

describe("flushSessionQueue", () => {
  it("does nothing when the queue is empty", async () => {
    const { handles, calls } = makeHandles(async () => ({}));

    const result = await flushSessionQueue(handles, "s1");

    expect(result.flushed).toBe(0);
    expect(calls).toHaveLength(0);
    expect(getFlushState().lastFlushAt).toBeNull();
  });

  it("uploads queued records with their document id and scopes, then deletes the queue", async () => {
    const { handles, calls } = makeHandles(async () => ({ success: true }));
    queuedRecord("s1", "first");
    queuedRecord("s1", "second");

    const result = await flushSessionQueue(handles, "s1");

    expect(result.flushed).toBe(2);
    expect(calls).toHaveLength(1);
    expect(calls[0].bankId).toBe("bank-1");
    expect(calls[0].options).toEqual({ async: false });
    expect(calls[0].items.map((item: any) => item.content)).toEqual(["first", "second"]);
    expect(calls[0].items[0]).toMatchObject({
      document_id: "s1",
      update_mode: "append",
      observation_scopes: [["harness:pi"]],
    });
    expect(existsSync(queuePath("s1"))).toBe(false);
    expect(getFlushState().lastFlushError).toBeNull();
    expect(getFlushState().lastFlushAt).not.toBeNull();
  });

  it("keeps the queue and records the error when the upload fails", async () => {
    const { handles } = makeHandles(async () => { throw new Error("boom"); });
    queuedRecord("s1");

    await expect(flushSessionQueue(handles, "s1")).rejects.toThrow("boom");

    expect(readQueueRecords("s1").records).toHaveLength(1);
    expect(getFlushState().lastFlushError).toBe("boom");
  });

  it("only flushes the requested session", async () => {
    const { handles, calls } = makeHandles(async () => ({}));
    queuedRecord("s1");
    queuedRecord("s2");

    await flushSessionQueue(handles, "s1");

    expect(calls[0].items).toHaveLength(1);
    expect(readQueueRecords("s2").records).toHaveLength(1);
  });
});
