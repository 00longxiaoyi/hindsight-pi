import { basename, resolve } from "node:path";
import type { HindsightConfig } from "../config.js";

export interface ScopeContext {
  sessionId?: string;
  parentId?: string;
  cwd: string;
  projectName?: string;
}

const cleanPath = (cwd: string): string => resolve(cwd).replace(/\\/g, "/");
export const getBasedir = (cwd: string): string => basename(cleanPath(cwd));
export const getProjectName = (config: Pick<HindsightConfig, "projectName">, cwd: string): string => config.projectName?.trim() || getBasedir(cwd);

export const placeholderValues = (config: Pick<HindsightConfig, "projectName">, ctx: ScopeContext): Record<string, string> => {
  const cwd = cleanPath(ctx.cwd);
  const session = ctx.sessionId || "unknown";
  const parent = ctx.parentId || session;
  const basedir = getBasedir(cwd);
  const project = config.projectName?.trim() || basedir;
  return {
    "{session}": `session:${session}`,
    "{parent}": `parent:${parent}`,
    "{cwd}": `cwd:${cwd}`,
    "{basedir}": `basedir:${basedir}`,
    "{project}": `project:${project}`,
  };
};

export const expandTagPlaceholders = (tags: string[] | null | undefined, config: Pick<HindsightConfig, "projectName">, ctx: ScopeContext): string[] | undefined => {
  if (!tags) return undefined;
  const values = placeholderValues(config, ctx);
  return [...new Set(tags.map((tag) => values[tag] ?? tag).filter(Boolean))];
};

export const OBSERVATION_SCOPE_KEYWORDS = ["per_tag", "combined", "all_combinations", "shared"] as const;

/**
 * The Hindsight API only accepts observation scopes as a strategy keyword or a
 * list of scope groups (`string[][]`). A flat `string[]` (a common hand-written
 * config mistake) is rejected with a 422, so coerce it into a single group and
 * drop empty groups, which are equally invalid.
 */
export const normalizeObservationScopes = (scopes: unknown): HindsightConfig["observationScopes"] => {
  if (scopes === null || scopes === undefined) return null;
  if (typeof scopes === "string") {
    return (OBSERVATION_SCOPE_KEYWORDS as readonly string[]).includes(scopes)
      ? scopes as HindsightConfig["observationScopes"]
      : null;
  }
  if (!Array.isArray(scopes)) return null;
  if (scopes.every((scope) => typeof scope === "string")) {
    const flat = [...new Set((scopes as string[]).filter((tag) => tag.trim() !== ""))];
    return flat.length > 0 ? [flat] : null;
  }
  const groups = scopes
    .map((group) => Array.isArray(group)
      ? [...new Set(group.filter((tag): tag is string => typeof tag === "string" && tag.trim() !== ""))]
      : [])
    .filter((group) => group.length > 0);
  return groups.length > 0 ? groups : null;
};

export const buildAutomaticTags = (config: Pick<HindsightConfig, "constantTags" | "projectName">, ctx: ScopeContext, storeMethod: "auto" | "tool"): string[] => {
  const cwd = cleanPath(ctx.cwd);
  const session = ctx.sessionId || "unknown";
  const parent = ctx.parentId || session;
  return [...new Set([
    ...config.constantTags,
    `session:${session}`,
    `parent:${parent}`,
    `cwd:${cwd}`,
    `basedir:${getBasedir(cwd)}`,
    `project:${getProjectName(config, cwd)}`,
    `store_method:${storeMethod}`,
  ])];
};

export const expandObservationScopes = (config: Pick<HindsightConfig, "observationScopes" | "projectName">, ctx: ScopeContext): HindsightConfig["observationScopes"] => {
  const normalized = normalizeObservationScopes(config.observationScopes);
  if (!Array.isArray(normalized)) return normalized;
  const values = placeholderValues(config, ctx);
  return normalized.map((group) => group.map((tag) => values[tag] ?? tag));
};
