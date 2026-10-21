import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queuePath, readQueueRecords } from "../extensions/queue.js";

/**
 * These tests drive the real extension entry point through pi's event bus.
 *
 * The regression they guard against (commit 538c735) was invisible to unit
 * tests: `WriteScheduler.onTurnEnd` kept passing its own tests while nothing
 * called it. So here we assert on *event wiring*: queues written by
 * `message_end` must actually reach the server on `agent_end`.
 */

const state = vi.hoisted(() => ({
  handles: null as any,
  retainBatch: vi.fn(async (_bankId: string, _items: any[], _options?: any) => ({ success: true })),
}));

vi.mock("../extensions/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../extensions/client.js")>();
  return {
    ...actual,
    bootstrap: async (config: any) => {
      state.handles = {
        bankId: "bank-1",
        config,
        linked: [],
        client: { retainBatch: state.retainBatch, recall: async () => ({ results: [] }) },
      };
      return state.handles;
    },
    clearHandles: () => { state.handles = null; },
    getHandles: () => state.handles,
  };
});

// Imported after the mock so the extension picks up the stubbed client.
const { default: hindsightMemory } = await import("../extensions/index.js");

let dir: string;
let oldRoot: string | undefined;
let oldFrequency: string | undefined;

beforeEach(() => {
  state.handles = null;
  state.retainBatch.mockClear();
  oldRoot = process.env.HINDSIGHT_QUEUE_ROOT;
  oldFrequency = process.env.HINDSIGHT_WRITE_FREQUENCY;
  delete process.env.HINDSIGHT_WRITE_FREQUENCY;
  dir = mkdtempSync(join(tmpdir(), "hindsight-wiring-"));
  process.env.HINDSIGHT_QUEUE_ROOT = join(dir, "queues");
});

afterEach(() => {
  if (oldRoot === undefined) delete process.env.HINDSIGHT_QUEUE_ROOT;
  else process.env.HINDSIGHT_QUEUE_ROOT = oldRoot;
  if (oldFrequency === undefined) delete process.env.HINDSIGHT_WRITE_FREQUENCY;
  else process.env.HINDSIGHT_WRITE_FREQUENCY = oldFrequency;
  rmSync(dir, { recursive: true, force: true });
});

const writeProjectConfig = (writeFrequency: string): void => {
  mkdirSync(join(dir, ".hindsight"), { recursive: true });
  writeFileSync(join(dir, ".hindsight", "config.json"), JSON.stringify({
    enabled: true,
    baseUrl: "http://127.0.0.1:1",
    bankId: "bank-1",
    bankStrategy: "manual",
    host: { pi: { writeFrequency, saveMessages: true } },
  }, null, 2));
};

const createPi = () => {
  const handlers = new Map<string, Array<(event: any, ctx: any) => unknown>>();
  const pi = {
    on: (event: string, handler: (event: any, ctx: any) => unknown) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    registerCommand: () => {},
    registerTool: () => {},
    registerMessageRenderer: () => {},
    setSessionName: () => {},
    sendMessage: () => {},
    async emit(event: string, payload: any, ctx: any) {
      for (const handler of handlers.get(event) ?? []) await handler(payload, ctx);
    },
  };
  return pi;
};

const createCtx = (sessionId: string) => ({
  cwd: dir,
  ui: { setStatus: () => {}, notify: () => {} },
  sessionManager: {
    getSessionId: () => sessionId,
    getSessionFile: () => null,
    getSessionName: () => "wiring",
    getEntries: () => [],
    getHeader: () => ({ timestamp: "2026-10-21T08:00:00.000Z" }),
  },
});

const userMessage = (text: string) => ({ message: { role: "user", content: [{ type: "text", text }] } });

const waitFor = async (predicate: () => boolean, label: string): Promise<void> => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > 2000) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

const boot = async (writeFrequency: string, sessionId = "s1") => {
  writeProjectConfig(writeFrequency);
  const pi = createPi();
  hindsightMemory(pi as any);
  const ctx = createCtx(sessionId);
  await pi.emit("session_start", { reason: "startup" }, ctx);
  await waitFor(() => state.handles !== null, "extension initialization");
  return { pi, ctx };
};

describe("retain flush wiring", () => {
  it("flushes queued messages on agent_end in the default turn mode", async () => {
    const { pi, ctx } = await boot("turn");

    await pi.emit("message_end", userMessage("remember that the bank lives on 192.168.3.247"), ctx);
    expect(readQueueRecords("s1").records).toHaveLength(1);
    expect(state.retainBatch).not.toHaveBeenCalled();

    await pi.emit("agent_end", {}, ctx);

    await waitFor(() => state.retainBatch.mock.calls.length === 1, "turn flush");
    const [bankId, items, options] = state.retainBatch.mock.calls[0];
    expect(bankId).toBe("bank-1");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ document_id: "s1", update_mode: "append" });
    expect(options).toEqual({ async: false });
    expect(readQueueRecords("s1").records).toHaveLength(0);
  });

  it("keeps the queue on agent_end in session mode and flushes at shutdown", async () => {
    const { pi, ctx } = await boot("session");

    await pi.emit("message_end", userMessage("remember this only at the end of the session"), ctx);
    await pi.emit("agent_end", {}, ctx);
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(state.retainBatch).not.toHaveBeenCalled();
    expect(readQueueRecords("s1").records).toHaveLength(1);

    await pi.emit("session_shutdown", { reason: "quit" }, ctx);

    expect(state.retainBatch).toHaveBeenCalledTimes(1);
    expect(readQueueRecords("s1").records).toHaveLength(0);
  });

  it("flushes after every message in async mode", async () => {
    const { pi, ctx } = await boot("async");

    await pi.emit("message_end", userMessage("first message that should be uploaded immediately"), ctx);

    await waitFor(() => state.retainBatch.mock.calls.length === 1, "message flush");
    expect(readQueueRecords("s1").records).toHaveLength(0);
  });

  it("batches numeric frequencies until enough turns have elapsed", async () => {
    const { pi, ctx } = await boot("2");

    await pi.emit("message_end", userMessage("turn one records a durable preference"), ctx);
    await pi.emit("agent_end", {}, ctx);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(state.retainBatch).not.toHaveBeenCalled();

    await pi.emit("message_end", userMessage("turn two records another durable preference"), ctx);
    await pi.emit("agent_end", {}, ctx);

    await waitFor(() => state.retainBatch.mock.calls.length === 1, "batch flush");
    expect(state.retainBatch.mock.calls[0][1]).toHaveLength(2);
    expect(readQueueRecords("s1").records).toHaveLength(0);
  });

  it("can still flush manually through the queue on shutdown when initialization failed", async () => {
    writeProjectConfig("turn");
    const pi = createPi();
    hindsightMemory(pi as any);
    const ctx = createCtx("s9");
    // No session_start: handles stay null, so message_end queues nothing.
    await pi.emit("message_end", userMessage("nothing is queued without a connection"), ctx);
    await pi.emit("session_shutdown", { reason: "quit" }, ctx);

    expect(state.retainBatch).not.toHaveBeenCalled();
    expect(readQueueRecords("s9").records).toHaveLength(0);
    expect(queuePath("s9")).toContain("s9.auto.jsonl");
  });
});
