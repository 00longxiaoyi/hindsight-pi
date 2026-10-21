import { describe, expect, it } from "vitest";
import { buildAutomaticTags, expandObservationScopes, expandTagPlaceholders, getProjectName } from "../extensions/retain/tags.js";

describe("retain tags and scopes", () => {
  const config = { constantTags: ["harness:pi"], projectName: "stable-project", observationScopes: [["{project}"], ["{cwd}"]] } as any;
  const ctx = { cwd: "/tmp/somewhere/project", sessionId: "s1", parentId: "p1" };

  it("expands project independent of cwd", () => {
    expect(getProjectName(config, ctx.cwd)).toBe("stable-project");
    expect(expandTagPlaceholders(["{project}", "user:me"], config, ctx)).toEqual(["project:stable-project", "user:me"]);
  });

  it("builds automatic retain tags", () => {
    expect(buildAutomaticTags(config, ctx, "auto")).toEqual(expect.arrayContaining([
      "harness:pi",
      "session:s1",
      "parent:p1",
      "project:stable-project",
      "store_method:auto",
    ]));
  });

  it("expands observation scopes at queue time", () => {
    const scopes = expandObservationScopes(config, ctx) as string[][];
    expect(scopes[0]).toEqual(["project:stable-project"]);
    expect(scopes[1][0]).toMatch(/cwd:.*\/tmp\/somewhere\/project$/);
  });
});

describe("observation scope normalization", () => {
  const ctx = { cwd: "/tmp/somewhere/project", sessionId: "s1", parentId: "p1" };

  it("wraps a flat tag list into a single scope group", () => {
    const config = { constantTags: [], projectName: "p", observationScopes: ["{project}", "user:me"] } as any;
    expect(expandObservationScopes(config, ctx)).toEqual([["project:p", "user:me"]]);
  });

  it("drops empty groups and dedupes tags", () => {
    const config = { constantTags: [], projectName: "p", observationScopes: [[], ["{project}", "{project}"], ["  "]] } as any;
    expect(expandObservationScopes(config, ctx)).toEqual([["project:p"]]);
  });

  it("returns null when nothing usable is configured", () => {
    const config = { constantTags: [], projectName: "p", observationScopes: [] } as any;
    expect(expandObservationScopes(config, ctx)).toBeNull();
  });

  it("passes strategy keywords through unchanged", () => {
    for (const strategy of ["per_tag", "combined", "all_combinations", "shared"]) {
      const config = { constantTags: [], projectName: "p", observationScopes: strategy } as any;
      expect(expandObservationScopes(config, ctx)).toBe(strategy);
    }
  });

  it("drops unknown strategy keywords instead of sending them to the API", () => {
    const config = { constantTags: [], projectName: "p", observationScopes: "all" } as any;
    expect(expandObservationScopes(config, ctx)).toBeNull();
  });
});
