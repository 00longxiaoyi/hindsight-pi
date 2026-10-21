import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearHandles,
  clearServerCapabilities,
  ensureBank,
  getBankInsights,
  getServerCapabilities,
} from "../extensions/client.js";

const BASE_URL = "http://hindsight.test:8888";

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

interface Route {
  method: string;
  path: string;
  status: number;
  body?: unknown;
}

const stubFetch = (routes: Route[]): string[] => {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: any, init: any = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    calls.push(`${method} ${url.pathname}`);
    const route = routes.find((candidate) => candidate.method === method && candidate.path === url.pathname);
    if (!route) return jsonResponse(500, { detail: `unexpected ${method} ${url.pathname}` });
    return jsonResponse(route.status, route.body ?? {});
  }));
  return calls;
};

const NEW_SERVER_VERSION = {
  api_version: "1.0.0",
  features: { bank_config_api: true, observations: true },
};

const LEGACY_SERVER_VERSION = {
  api_version: "0.4.0",
  features: { observations: true },
};

const bankSetup = (autoCreateBank = true) => ({ autoCreateBank, workspace: "pi-workspace", baseUrl: BASE_URL, apiKey: undefined });

const fakeClient = () => ({ createBank: vi.fn(async (_bankId: string, _options: any) => ({})) });

beforeEach(() => {
  clearHandles();
  clearServerCapabilities();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("server capabilities", () => {
  it("detects the bank config API from /version", async () => {
    stubFetch([{ method: "GET", path: "/version", status: 200, body: NEW_SERVER_VERSION }]);
    const capabilities = await getServerCapabilities(BASE_URL);
    expect(capabilities.apiVersion).toBe("1.0.0");
    expect(capabilities.supportsBankConfig).toBe(true);
    expect(capabilities.capabilitiesKnown).toBe(true);
  });

  it("treats a server without /version as legacy", async () => {
    stubFetch([{ method: "GET", path: "/version", status: 404, body: { detail: "Not Found" } }]);
    const capabilities = await getServerCapabilities(BASE_URL);
    expect(capabilities.supportsBankConfig).toBe(false);
    expect(capabilities.capabilitiesKnown).toBe(false);
  });

  it("caches capabilities per base url", async () => {
    const calls = stubFetch([{ method: "GET", path: "/version", status: 200, body: NEW_SERVER_VERSION }]);
    await getServerCapabilities(BASE_URL);
    await getServerCapabilities(BASE_URL);
    expect(calls).toEqual(["GET /version"]);
  });
});

describe("ensureBank on current Hindsight (bank config API)", () => {
  it("does not create a bank that already exists", async () => {
    const calls = stubFetch([
      { method: "GET", path: "/version", status: 200, body: NEW_SERVER_VERSION },
      { method: "GET", path: "/v1/default/banks/lazycat-clash-party/config", status: 200, body: { bank_id: "lazycat-clash-party", config: {} } },
    ]);
    const client = fakeClient();
    await ensureBank(client, "lazycat-clash-party", bankSetup());
    expect(client.createBank).not.toHaveBeenCalled();
    expect(calls).not.toContain("GET /v1/default/banks/lazycat-clash-party/profile");
  });

  it("creates a missing bank with the current reflectMission field", async () => {
    stubFetch([
      { method: "GET", path: "/version", status: 200, body: NEW_SERVER_VERSION },
      { method: "GET", path: "/v1/default/banks/fresh-bank/config", status: 404, body: { detail: "Bank 'fresh-bank' not found" } },
    ]);
    const client = fakeClient();
    await ensureBank(client, "fresh-bank", bankSetup());
    expect(client.createBank).toHaveBeenCalledWith("fresh-bank", expect.objectContaining({ name: "fresh-bank" }));
    expect(client.createBank.mock.calls[0][1]).not.toHaveProperty("background");
  });

  it("throws when the bank is missing and autoCreateBank is off", async () => {
    stubFetch([
      { method: "GET", path: "/version", status: 200, body: NEW_SERVER_VERSION },
      { method: "GET", path: "/v1/default/banks/fresh-bank/config", status: 404, body: { detail: "Bank 'fresh-bank' not found" } },
    ]);
    await expect(ensureBank(fakeClient(), "fresh-bank", bankSetup(false))).rejects.toThrow(/does not exist/);
  });

  it("survives a create race", async () => {
    stubFetch([
      { method: "GET", path: "/version", status: 200, body: NEW_SERVER_VERSION },
      { method: "GET", path: "/v1/default/banks/fresh-bank/config", status: 404, body: { detail: "Bank 'fresh-bank' not found" } },
    ]);
    const client = { createBank: vi.fn(async (_bankId: string, _options: any) => { throw new Error("409 Conflict: bank already exists"); }) };
    await expect(ensureBank(client, "fresh-bank", bankSetup())).resolves.toBeUndefined();
  });
});

describe("ensureBank fallbacks", () => {
  it("does not treat a route-level 404 as a missing bank", async () => {
    const calls = stubFetch([
      { method: "GET", path: "/version", status: 404, body: { detail: "Not Found" } },
      { method: "GET", path: "/v1/default/banks/odd-bank/profile", status: 404, body: { detail: "Not Found" } },
      { method: "GET", path: "/v1/default/banks/odd-bank/config", status: 404, body: { detail: "Not Found" } },
      { method: "GET", path: "/v1/default/banks", status: 200, body: { banks: [{ bank_id: "odd-bank" }] } },
    ]);
    const client = fakeClient();
    await ensureBank(client, "odd-bank", bankSetup());
    expect(client.createBank).not.toHaveBeenCalled();
    expect(calls).toContain("GET /v1/default/banks");
  });

  it("never upserts a bank when no probe can answer", async () => {
    stubFetch([
      { method: "GET", path: "/version", status: 500, body: { detail: "boom" } },
      { method: "GET", path: "/v1/default/banks/odd-bank/profile", status: 500, body: { detail: "boom" } },
      { method: "GET", path: "/v1/default/banks/odd-bank/config", status: 500, body: { detail: "boom" } },
      { method: "GET", path: "/v1/default/banks", status: 500, body: { detail: "boom" } },
    ]);
    const client = fakeClient();
    await expect(ensureBank(client, "odd-bank", bankSetup())).resolves.toBeUndefined();
    expect(client.createBank).not.toHaveBeenCalled();
  });
});

describe("ensureBank on legacy Hindsight", () => {
  it("uses the profile endpoint and skips creation", async () => {
    const calls = stubFetch([
      { method: "GET", path: "/version", status: 404, body: { detail: "Not Found" } },
      { method: "GET", path: "/v1/default/banks/legacy-bank/profile", status: 200, body: { bank_id: "legacy-bank" } },
    ]);
    const client = fakeClient();
    await ensureBank(client, "legacy-bank", bankSetup());
    expect(client.createBank).not.toHaveBeenCalled();
    expect(calls).toContain("GET /v1/default/banks/legacy-bank/profile");
  });

  it("falls back to the config endpoint when the profile endpoint is gone", async () => {
    stubFetch([
      { method: "GET", path: "/version", status: 404, body: { detail: "Not Found" } },
      { method: "GET", path: "/v1/default/banks/half-new/profile", status: 410, body: { detail: "The bank profile endpoints have been removed." } },
      { method: "GET", path: "/v1/default/banks/half-new/config", status: 200, body: { bank_id: "half-new", config: {} } },
    ]);
    const client = fakeClient();
    await expect(ensureBank(client, "half-new", bankSetup())).resolves.toBeUndefined();
    expect(client.createBank).not.toHaveBeenCalled();
  });

  it("creates a missing bank with the legacy background alias", async () => {
    stubFetch([
      { method: "GET", path: "/version", status: 404, body: { detail: "Not Found" } },
      { method: "GET", path: "/v1/default/banks/legacy-bank/profile", status: 404, body: { detail: "Bank not found" } },
    ]);
    const client = fakeClient();
    await ensureBank(client, "legacy-bank", bankSetup());
    expect(client.createBank.mock.calls[0][1]).toHaveProperty("background");
  });
});

describe("getBankInsights", () => {
  const bankRoutes: Route[] = [
    { method: "GET", path: "/v1/default/banks/lazycat-clash-party/directives", status: 200, body: { items: [{}, {}] } },
    { method: "GET", path: "/v1/default/banks/lazycat-clash-party/mental-models", status: 200, body: { items: [{}] } },
    { method: "GET", path: "/v1/default/banks/lazycat-clash-party/documents", status: 200, body: { items: [{}, {}, {}], total: 12, limit: 3 } },
    { method: "GET", path: "/v1/default/banks/lazycat-clash-party/entities", status: 200, body: [{}, {}, {}] },
    {
      method: "GET",
      path: "/v1/default/banks",
      status: 200,
      body: {
        banks: [
          { bank_id: "other-bank", name: "Other" },
          { bank_id: "lazycat-clash-party", name: "Clash Party", mission: "list mission", fact_count: 3006, disposition: { skepticism: 4 } },
        ],
      },
    },
    {
      method: "GET",
      path: "/v1/default/banks/lazycat-clash-party/config",
      status: 200,
      body: { bank_id: "lazycat-clash-party", config: { reflect_mission: "config mission", disposition_empathy: 5 } },
    },
  ];

  it("maps bank config and bank list into a profile", async () => {
    stubFetch([{ method: "GET", path: "/version", status: 200, body: NEW_SERVER_VERSION }, ...bankRoutes]);
    const insights = await getBankInsights(BASE_URL, undefined, "lazycat-clash-party");
    expect(insights.profile).toEqual({
      bank_id: "lazycat-clash-party",
      name: "Clash Party",
      background: "config mission",
      disposition: { skepticism: 4, literalism: undefined, empathy: 5 },
    });
    expect(insights.factCount).toBe(3006);
    expect(insights.directivesCount).toBe(2);
    expect(insights.mentalModelsCount).toBe(1);
    expect(insights.documentsCount).toBe(12);
    expect(insights.entitiesCount).toBe(3);
    expect(insights.apiVersion).toBe("1.0.0");
  });

  it("never probes the removed bank profile endpoint on current servers", async () => {
    const calls = stubFetch([{ method: "GET", path: "/version", status: 200, body: NEW_SERVER_VERSION }, ...bankRoutes]);
    await getBankInsights(BASE_URL, undefined, "lazycat-clash-party");
    expect(calls.some((call) => call.endsWith("/profile"))).toBe(false);
    expect(calls.some((call) => call === "GET /v1/default/banks/lazycat-clash-party")).toBe(false);
  });

  it("degrades to null profile when the server exposes nothing", async () => {
    stubFetch([{ method: "GET", path: "/version", status: 200, body: LEGACY_SERVER_VERSION }]);
    const insights = await getBankInsights(BASE_URL, undefined, "missing-bank");
    expect(insights.profile).toBeNull();
    expect(insights.factCount).toBeNull();
  });
});
