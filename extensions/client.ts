import { HindsightClient } from "@vectorize-io/hindsight-client";
import type { HindsightConfig, ResolvedLinkedHostConfig } from "./config.js";
import { deriveBankId } from "./session.js";

export interface LinkedHostHandle {
  name: string;
  client: any;
  bankId: string;
  config: ResolvedLinkedHostConfig;
}

export interface BankInsights {
  profile: {
    bank_id: string;
    name?: string;
    background?: string;
    disposition?: { skepticism?: number; literalism?: number; empathy?: number };
  } | null;
  directivesCount: number | null;
  mentalModelsCount: number | null;
  documentsCount: number | null;
  entitiesCount: number | null;
  factCount: number | null;
  apiVersion?: string;
}

export const EMPTY_BANK_INSIGHTS: BankInsights = {
  profile: null,
  directivesCount: null,
  mentalModelsCount: null,
  documentsCount: null,
  entitiesCount: null,
  factCount: null,
};

export interface HindsightHandles {
  client: any;
  bankId: string;
  config: HindsightConfig;
  linked: LinkedHostHandle[];
}

/**
 * What the connected Hindsight server actually supports.
 *
 * Hindsight 0.5.5+ replaced the bank profile endpoint (`GET .../banks/{id}` and
 * `GET .../banks/{id}/profile`, now 405/410) with the bank config endpoint
 * (`GET/PATCH .../banks/{id}/config`). Capabilities are read from `/version` so
 * the extension can talk to both generations without guessing from error text.
 */
export interface ServerCapabilities {
  reachable: boolean;
  apiVersion?: string;
  features: Record<string, unknown>;
  /** Bank config endpoint (`GET .../banks/{id}/config`) is available. */
  supportsBankConfig: boolean;
  /** `/version` answered with a feature map, so `supportsBankConfig` is trustworthy. */
  capabilitiesKnown: boolean;
}

let cachedHandles: HindsightHandles | null = null;
const cachedCapabilities = new Map<string, ServerCapabilities>();

export const getHandles = (): HindsightHandles | null => cachedHandles;
export const clearHandles = (): void => {
  cachedHandles = null;
  cachedCapabilities.clear();
};

export const clearServerCapabilities = (): void => { cachedCapabilities.clear(); };

const trimBaseUrl = (baseUrl: string): string => baseUrl.replace(/\/+$/, "");

const authHeaders = (apiKey?: string): Record<string, string> => ({
  "Content-Type": "application/json",
  ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
});

interface ApiResult {
  status: number;
  ok: boolean;
  data: any;
}

const apiRequest = async (
  baseUrl: string,
  apiKey: string | undefined,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<ApiResult> => {
  const response = await fetch(`${trimBaseUrl(baseUrl)}${path}`, {
    method,
    headers: authHeaders(apiKey),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { status: response.status, ok: response.ok, data };
};

export const getServerCapabilities = async (baseUrl: string, apiKey?: string): Promise<ServerCapabilities> => {
  const cacheKey = `${trimBaseUrl(baseUrl)}|${apiKey ?? ""}`;
  const cached = cachedCapabilities.get(cacheKey);
  if (cached) return cached;

  let capabilities: ServerCapabilities = {
    reachable: false,
    features: {},
    supportsBankConfig: false,
    capabilitiesKnown: false,
  };

  try {
    const version = await apiRequest(baseUrl, apiKey, "GET", "/version");
    if (version.ok && version.data && typeof version.data === "object") {
      const features = (version.data.features ?? {}) as Record<string, unknown>;
      capabilities = {
        reachable: true,
        apiVersion: typeof version.data.api_version === "string" ? version.data.api_version : undefined,
        features,
        supportsBankConfig: features.bank_config_api === true,
        capabilitiesKnown: Object.keys(features).length > 0,
      };
    } else if (version.status >= 200 && version.status < 500) {
      // Server answers, but exposes no /version (older deployments).
      capabilities = { ...capabilities, reachable: true };
    }
  } catch {
    // Unreachable server: bootstrap will surface the real connection error.
  }

  cachedCapabilities.set(cacheKey, capabilities);
  return capabilities;
};

const isConflictError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return /409|already exists|conflict/i.test(message);
};

type BankProbe = "exists" | "missing" | "unknown";

const bankPath = (bankId: string): string => `/v1/default/banks/${encodeURIComponent(bankId)}`;

const detailText = (data: any): string => {
  if (typeof data === "string") return data;
  return String(data?.detail ?? data?.message ?? "");
};

/**
 * 200 => exists, 404 "Bank 'x' not found" => missing.
 *
 * A 404 with the generic `Not Found` body means the route itself is absent
 * (older/newer server), not that the bank is missing, so it stays `unknown`.
 * 405/410/501 mean the endpoint was removed and the other probe gets a turn.
 */
const respondToProbe = (result: ApiResult): BankProbe => {
  if (result.ok) return "exists";
  if (result.status === 404) {
    const detail = detailText(result.data).trim();
    if (detail && !/^not found$/i.test(detail)) return "missing";
  }
  return "unknown";
};

const probeBankConfig = async (baseUrl: string, apiKey: string | undefined, bankId: string): Promise<BankProbe> =>
  respondToProbe(await apiRequest(baseUrl, apiKey, "GET", `${bankPath(bankId)}/config`));

const probeBankProfile = async (baseUrl: string, apiKey: string | undefined, bankId: string): Promise<BankProbe> =>
  respondToProbe(await apiRequest(baseUrl, apiKey, "GET", `${bankPath(bankId)}/profile`));

/** Works on every Hindsight generation and never touches bank state. */
const probeBankList = async (baseUrl: string, apiKey: string | undefined, bankId: string): Promise<BankProbe> => {
  const result = await apiRequest(baseUrl, apiKey, "GET", `/v1/default/banks?q=${encodeURIComponent(bankId)}&limit=100`);
  if (!result.ok) return "unknown";
  const entries = Array.isArray(result.data?.banks) ? result.data.banks
    : Array.isArray(result.data?.items) ? result.data.items
      : Array.isArray(result.data) ? result.data
        : [];
  if (entries.length === 0) return result.data ? "missing" : "unknown";
  return entries.some((entry: any) => entry?.bank_id === bankId) ? "exists" : "missing";
};

const probeBank = async (
  baseUrl: string,
  apiKey: string | undefined,
  bankId: string,
  capabilities: ServerCapabilities,
): Promise<BankProbe> => {
  const order = capabilities.supportsBankConfig ? [probeBankConfig, probeBankProfile] : [probeBankProfile, probeBankConfig];
  for (const probe of order) {
    const result = await probe(baseUrl, apiKey, bankId);
    if (result !== "unknown") return result;
  }
  return probeBankList(baseUrl, apiKey, bankId);
};

export interface BankSetupConfig {
  autoCreateBank: boolean;
  workspace: string;
  baseUrl: string;
  apiKey?: string;
}

const createBank = async (
  client: any,
  bankId: string,
  config: Pick<BankSetupConfig, "workspace">,
  capabilities: ServerCapabilities,
): Promise<void> => {
  const mission = `Persistent coding memory for pi workspace ${config.workspace}`;
  try {
    await client.createBank(bankId, {
      name: bankId,
      // `reflectMission` is the current field; `background` is the pre-0.5 alias.
      ...(capabilities.supportsBankConfig ? { reflectMission: mission } : { background: mission }),
    });
  } catch (error) {
    // The bank endpoint is an upsert, but a race (two sessions booting at once)
    // can still surface a conflict; treat that as success.
    if (!isConflictError(error)) throw error;
  }
};

export const ensureBank = async (client: any, bankId: string, config: BankSetupConfig): Promise<void> => {
  const capabilities = await getServerCapabilities(config.baseUrl, config.apiKey);
  const probe = await probeBank(config.baseUrl, config.apiKey, bankId, capabilities);

  if (probe === "exists") return;

  if (probe === "missing" && !config.autoCreateBank) {
    throw new Error(`Hindsight bank "${bankId}" does not exist and autoCreateBank is disabled.`);
  }

  if (probe === "unknown") {
    // No probe worked, so we cannot tell whether the bank exists. Creating a
    // bank is an upsert that would overwrite an existing mission, so doing it
    // blind is worse than letting the next call report the real problem.
    return;
  }

  await createBank(client, bankId, config, capabilities);
};

const buildClient = (baseUrl: string, apiKey?: string): any => new HindsightClient({
  baseUrl,
  ...(apiKey ? { apiKey } : {}),
});

const apiGet = async (baseUrl: string, apiKey: string | undefined, path: string): Promise<any | null> => {
  const result = await apiRequest(baseUrl, apiKey, "GET", path);
  if (result.ok) return result.data;
  if (result.status === 404) return null;
  throw new Error(`GET ${path} failed: ${result.status}`);
};

const inferCount = (value: any): number | null => {
  if (!value) return null;
  // `total` is the full count; `items` may be capped by a default page size.
  if (typeof value.total === "number") return value.total;
  if (typeof value.count === "number") return value.count;
  if (Array.isArray(value)) return value.length;
  if (Array.isArray(value.items)) return value.items.length;
  if (Array.isArray(value.data)) return value.data.length;
  return null;
};

const pick = <T>(...candidates: Array<T | null | undefined>): T | undefined =>
  candidates.find((candidate) => candidate !== null && candidate !== undefined) ?? undefined;

const findBankEntry = (list: any, bankId: string): any | null => {
  const entries = Array.isArray(list?.banks) ? list.banks : Array.isArray(list) ? list : [];
  return entries.find((entry: any) => entry?.bank_id === bankId) ?? null;
};

export const getBankInsights = async (baseUrl: string, apiKey: string | undefined, bankId: string): Promise<BankInsights> => {
  const capabilities = await getServerCapabilities(baseUrl, apiKey);
  const [directives, mentalModels, documents, entities, bankList, bankConfig] = await Promise.allSettled([
    apiGet(baseUrl, apiKey, `${bankPath(bankId)}/directives`),
    apiGet(baseUrl, apiKey, `${bankPath(bankId)}/mental-models`),
    apiGet(baseUrl, apiKey, `${bankPath(bankId)}/documents`),
    apiGet(baseUrl, apiKey, `${bankPath(bankId)}/entities`),
    apiGet(baseUrl, apiKey, `/v1/default/banks?q=${encodeURIComponent(bankId)}&limit=100`),
    apiGet(baseUrl, apiKey, `${bankPath(bankId)}/config`).catch(() => null),
  ]);

  // Older servers only expose the profile endpoint; newer ones answer 410 there.
  const legacyProfile = capabilities.supportsBankConfig
    ? null
    : await apiGet(baseUrl, apiKey, bankPath(bankId)).catch(() => null);

  const settled = <T>(result: PromiseSettledResult<T>): T | null =>
    result.status === "fulfilled" ? result.value : null;

  const config = (settled(bankConfig)?.config ?? {}) as Record<string, any>;
  const entry = findBankEntry(settled(bankList), bankId);

  const disposition = {
    skepticism: pick<number>(config.disposition_skepticism, entry?.disposition?.skepticism),
    literalism: pick<number>(config.disposition_literalism, entry?.disposition?.literalism),
    empathy: pick<number>(config.disposition_empathy, entry?.disposition?.empathy),
  };
  const hasDisposition = Object.values(disposition).some((value) => typeof value === "number");

  const profile = entry || legacyProfile || Object.keys(config).length > 0
    ? {
        bank_id: bankId,
        name: pick(entry?.name, legacyProfile?.name) ?? bankId,
        background: pick(config.reflect_mission, entry?.mission, legacyProfile?.background),
        ...(hasDisposition ? { disposition } : {}),
      }
    : null;

  return {
    profile,
    directivesCount: inferCount(settled(directives)),
    mentalModelsCount: inferCount(settled(mentalModels)),
    documentsCount: inferCount(settled(documents)),
    entitiesCount: inferCount(settled(entities)),
    factCount: typeof entry?.fact_count === "number" ? entry.fact_count : null,
    apiVersion: capabilities.apiVersion,
  };
};

export const bootstrap = async (config: HindsightConfig, cwd: string): Promise<HindsightHandles> => {
  const client = buildClient(config.baseUrl, config.apiKey);
  const bankId = await deriveBankId(cwd, config.bankStrategy, config);
  await ensureBank(client, bankId, config);
  if (config.globalBankId && config.globalBankId !== bankId) {
    await ensureBank(client, config.globalBankId, config);
  }

  const linked: LinkedHostHandle[] = [];
  for (const linkedConfig of config.linkedHostConfigs) {
    const linkedClient = buildClient(linkedConfig.baseUrl, linkedConfig.apiKey);
    const linkedBankId = linkedConfig.bankId ?? await deriveBankId(cwd, linkedConfig.bankStrategy, {
      ...config,
      baseUrl: linkedConfig.baseUrl,
      apiKey: linkedConfig.apiKey,
      bankId: linkedConfig.bankId,
      bankStrategy: linkedConfig.bankStrategy,
      workspace: linkedConfig.workspace,
      peerName: linkedConfig.peerName,
      aiPeer: linkedConfig.aiPeer,
      linkedHosts: [],
      linkedHostConfigs: [],
    });
    await ensureBank(linkedClient, linkedBankId, {
      autoCreateBank: config.autoCreateBank,
      workspace: linkedConfig.workspace,
      baseUrl: linkedConfig.baseUrl,
      apiKey: linkedConfig.apiKey,
    });
    linked.push({ name: linkedConfig.name, client: linkedClient, bankId: linkedBankId, config: linkedConfig });
  }

  cachedHandles = { client, bankId, config, linked };
  return cachedHandles;
};
