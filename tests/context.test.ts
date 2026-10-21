import { describe, expect, it } from "vitest";
import { clearCachedContext, countCachedContext, formatLastRecallInspection, getLastRecallState, refreshContextForPrompt, renderCachedContext } from "../extensions/context.js";

describe("context helpers", () => {
  it("stores the exact last recall result set for inspection", async () => {
    clearCachedContext();
    const handles = {
      bankId: "bank-1",
      config: {
        workspace: "pi",
        searchBudget: "mid",
        contextTokens: 512,
        logging: false,
        globalBankId: undefined,
      },
      linked: [],
      client: {
        recall: async () => ({
          results: [
            { text: "User prefers compact status output", type: "observation", document_id: "doc-1", context: "preferences", tags: ["session:s1"] },
            { text: "User asked for fresh recall each turn", type: "experience", document_id: "doc-1" },
          ],
        }),
      },
    } as any;

    await refreshContextForPrompt(handles, "what should i remember?");

    expect(countCachedContext()).toBe(2);
    expect(renderCachedContext()).toContain("<hindsight_memories>");
    expect(getLastRecallState().query).toBe("what should i remember?");
    expect(formatLastRecallInspection()).toContain("User prefers compact status output");
    expect(formatLastRecallInspection()).toContain("document_id: doc-1");
  });

  it("filters low-value meta recall results", async () => {
    clearCachedContext();
    const handles = {
      bankId: "bank-1",
      config: {
        workspace: "pi",
        searchBudget: "mid",
        contextTokens: 512,
        logging: false,
        globalBankId: undefined,
      },
      linked: [],
      client: {
        recall: async () => ({
          results: [
            { text: "Visible recall state: banner like memory context loaded.", type: "experience", document_id: "doc-noise" },
            { text: "Stable project goal: ship Hindsight-pi architecture v2.", type: "world", document_id: "doc-keep" },
          ],
        }),
      },
    } as any;

    await refreshContextForPrompt(handles, "Current durable user preferences, stable repo facts, active project goals, and important coding constraints for this workspace.");

    expect(countCachedContext()).toBe(1);
    expect(formatLastRecallInspection()).toContain("ship Hindsight-pi architecture v2");
    expect(formatLastRecallInspection()).not.toContain("Visible recall state");
  });

  it("passes auto recall tags and tag match to recall", async () => {
    clearCachedContext();
    const seen: any[] = [];
    const handles = {
      bankId: "bank-1",
      config: {
        workspace: "pi",
        searchBudget: "mid",
        contextTokens: 512,
        logging: false,
        globalBankId: undefined,
        autoRecallTags: ["{project}"],
        autoRecallTagsMatch: "any_strict",
        projectName: "hindsight-pi",
      },
      linked: [],
      client: {
        recall: async (_bankId: string, _query: string, options: any) => {
          seen.push(options);
          return { results: [{ text: "Project-specific fact", type: "observation" }] };
        },
      },
    } as any;

    await refreshContextForPrompt(handles, "project query", { cwd: "/tmp/elsewhere", sessionId: "s1" });

    expect(seen[0].tags).toEqual(["project:hindsight-pi"]);
    expect(seen[0].tagsMatch).toBe("any_strict");
  });

  it("skips gracefully when recall query is too long", async () => {
    clearCachedContext();
    const seen: string[] = [];
    const handles = {
      bankId: "bank-1",
      config: {
        workspace: "pi",
        searchBudget: "mid",
        contextTokens: 512,
        logging: false,
        globalBankId: undefined,
      },
      linked: [],
      client: {
        recall: async (_bankId: string, query: string) => {
          seen.push(query);
          throw new Error(`Query too long: exceeds maximum of 500`);
        },
      },
    } as any;

    await refreshContextForPrompt(handles, "x".repeat(2400));

    expect(seen.length).toBe(1);
    expect(countCachedContext()).toBe(0);
    expect(renderCachedContext()).toBeNull();
    expect(getLastRecallState().errorReason).toBe("query-too-long");
  });

  it("clears last recall inspection state", () => {
    clearCachedContext();
    expect(formatLastRecallInspection()).toContain("No Hindsight recall has been loaded yet");
  });
});

