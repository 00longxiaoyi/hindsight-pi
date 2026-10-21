# Hindsight API Notes

Status: verified from public Hindsight docs and SDK guide on 2026-04-19.

> The `## Bank APIs` section below documents the **pre-0.5.5** surface and is kept
> for history. Read ["Server compatibility: Hindsight 0.5.5+ (API 1.0)"](#server-compatibility-hindsight-055-api-10)
> at the end of this file for what the extension actually calls today.

Primary sources:
- `https://docs.hindsight.vectorize.io/typescript-sdk`
- `https://docs.hindsight.vectorize.io/retain`
- `https://docs.hindsight.vectorize.io/recall`
- `https://docs.hindsight.vectorize.io/reflect`
- `https://docs.hindsight.vectorize.io/memory-banks`
- `https://hindsight.vectorize.io/`

## Package and Client

Verified:

```ts
import { HindsightClient } from '@vectorize-io/hindsight-client';

const client = new HindsightClient({
  baseUrl: 'https://api.hindsight.vectorize.io',
  apiKey: 'your-api-key',
});
```

Also documented:
- local/self-hosted API commonly runs at `http://<your-hindsight-host>:8888`
- cloud uses API key auth
- Node/TypeScript package: `@vectorize-io/hindsight-client`

## Core Concepts Relevant to pi Extension

Hindsight is bank-centered, not peer/session-centered.

Verified memory operations:
- `retain` — store new content in bank
- `recall` — retrieve raw memories from bank
- `reflect` — synthesize answer over bank memories

Verified memory model:
- world facts
- experience
- observations
- mental models

Verified retrieval system:
- semantic
- keyword / BM25
- graph / entity relationships
- temporal

## Verified TypeScript SDK Surface

## Bank APIs

Verified examples:

```ts
const bank = await client.createBank('customer-support-agent', {
  name: 'Customer Support Agent',
  background: 'This agent handles customer inquiries for an e-commerce platform',
  disposition: {
    skepticism: 3,
    literalism: 2,
    empathy: 4,
  },
});

// current servers (>= 0.5.5): the profile endpoint is gone
const bankConfig = await client.getBankConfig('my-assistant'); // { bank_id, config, overrides }
```

Verified response/interface snippets from docs:

```ts
interface BankProfileResponse {
  bank_id: string;
  name?: string;
  background?: string;
  disposition?: {
    skepticism: number;
    literalism: number;
    empathy: number;
  };
}
```

Extension relevance:
- `createBank` useful for bootstrap when configured bank does not exist yet
- `getBankConfig` (replaces `getBankProfile`) useful for `/hindsight:status` and `/hindsight:doctor`
- `background` is best fit for durable bank purpose / mission
- disposition traits exist, but MVP should treat them as optional config, not required runtime behavior

## Retain APIs

Verified examples:

```ts
await client.retain(
  'my-assistant',
  'The user prefers concise responses and dark mode.'
);

await client.retain(
  'my-assistant',
  'Customer reported a bug with the checkout process.',
  {
    context: 'Support ticket conversation',
    timestamp: new Date(),
    metadata: {
      ticketId: 'TKT-12345',
      priority: 'high',
    },
  }
);

await client.retainBatch('my-assistant', [
  { content: 'User is based in Pacific timezone' },
  { content: 'User prefers email over phone calls' },
], { async: true });
```

Verified retain request fields from docs:
- `bank_id` / first positional bank argument
- `content`
- optional `context`
- optional `timestamp`
- optional `metadata`
- batch retain supported
- async batch retain supported

Extension relevance:
- use `retain` or `retainBatch` after `agent_end`
- attach metadata for source, role, cwd, session key, branch, model, tool usage summary when available
- keep uploaded content natural-language and chunked by message or turn

## Recall APIs

Verified examples:

```ts
const result = await client.recall(
  'my-assistant',
  'What communication preferences does the user have?'
);

const result = await client.recall(
  'my-assistant',
  'project deadlines',
  {
    maxTokens: 4096,
    budget: 'mid',
  }
);

const observations = await client.recall(
  'my-assistant',
  'user preferences',
  {
    types: ['observation'],
  }
);
```

Verified recall options from docs:
- `budget`: `low | mid | high`
- `maxTokens`
- `types`
- `includeEntities`
- `maxEntityTokens`
- `trace`
- `query_timestamp` mentioned in endpoint docs
- result limiting and scoring are described in recall docs, but exact TypeScript option names for `limit` / `min_score` are not confirmed in SDK guide snippets

Verified response/interface snippets from docs:

```ts
interface RecallResponse {
  results: RecallResult[];
  entities?: Entity[];
  trace?: TraceInfo;
  chunks?: Chunk[];
}

interface RecallResult {
  text: string;
  type: 'world' | 'experience' | 'observation';
}
```

Extension relevance:
- primary low-cost context source for prompt injection
- primary basis for `hindsight_search` tool
- should prefer recall for raw facts and concise context assembly

## Reflect APIs

Verified examples:

```ts
const response = await client.reflect(
  'my-assistant',
  'What should I know about this customer before our call?'
);

const response = await client.reflect(
  'my-assistant',
  'What are their main pain points?',
  {
    context: "We're preparing for a product review meeting",
    budget: 'high',
  }
);
```

Verified reflect options from docs:
- `context`
- `budget`: `low | mid | high`
- `max_tokens` / max token control documented at endpoint level
- `response_schema`

Verified response/interface snippets from docs:

```ts
interface ReflectResponse {
  text: string;
  based_on: BasedOnItem[];
  structured_output?: Record<string, unknown>;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
}
```

Extension relevance:
- use for higher-cost synthesis tool like `hindsight_context`
- avoid every-turn reflect in MVP; too expensive and likely slower than recall-driven injection
- good fit for explicit user request, deep context synthesis, or `/hindsight:sync` refresh of mental models later

## Mental Model APIs

Verified from SDK guide:

```ts
await client.createMentalModel('my-assistant', 'User Profile', 'What do we know about this user?');
await client.listMentalModels('my-assistant');
await client.getMentalModel('my-assistant', 'mm_abc123');
await client.refreshMentalModel('my-assistant', 'mm_abc123');
await client.updateMentalModel('my-assistant', 'mm_abc123', {
  name: 'Updated Profile',
  sourceQuery: "What are the user's key preferences?",
  trigger: { refreshAfterConsolidation: true },
});
await client.deleteMentalModel('my-assistant', 'mm_abc123');
```

Verified use:
- precomputed reflections for repeated queries
- optional auto-refresh after consolidation

Extension decision:
- do not require mental models for MVP bootstrap
- design config so they can be added later for stable summaries like user profile or project summary

## Deployment and Auth Notes

Verified:
- Cloud API works with `baseUrl` + `apiKey`
- Self-host/local can run with Docker at `http://<your-hindsight-host>:8888`
- Hindsight UI commonly at `http://localhost:9999`
- local deployment requires upstream LLM provider keys for Hindsight backend itself

Implications for pi extension:
- extension only talks to Hindsight API, not directly to Hindsight's internal LLM provider
- config must support cloud and local base URLs
- config should allow `apiKey` omission for local instances that do not require auth, but this is environment-dependent and should be checked in doctor command

## Verified vs Proposed for Implementation

Verified enough to depend on directly in MVP:
- `HindsightClient`
- `createBank`
- `getBankConfig` (bank profile endpoints were removed in 0.5.5+)
- `retain`
- `retainBatch`
- `recall`
- `reflect`
- mental model CRUD/refresh methods
- cloud/local `baseUrl` configuration

Not sufficiently confirmed from current docs, so treat as optional or inspect package before coding:
- exact SDK names for every recall filter beyond examples
- exact error class hierarchy
- exact pagination options for all list methods beyond documented examples
- whether `createBank` is idempotent or needs explicit existence check first

## Design Consequences for Hindsight-pi

1. Replace Honcho peer/session abstraction with deterministic bank ID strategy.
2. Use `retain` / `retainBatch` for post-turn uploads.
3. Use `recall` for injected context and raw search tool.
4. Use `reflect` for explicit synthesis tool, not default per-turn injection.
5. Keep mental models as later optimization, not MVP dependency.

## Server compatibility: Hindsight 0.5.5+ (API 1.0)

Verified against a live deployment (`/version` -> `api_version: 1.0.0`,
`features.bank_config_api: true`) on 2026-10-21.

Endpoints the extension used to call are gone or changed shape. The current API:

| Operation | Before | Now |
|---|---|---|
| Probe bank exists | `GET /v1/default/banks/{bank_id}` / `.../profile` | `GET /v1/default/banks/{bank_id}/config` (profile answers **410 Gone**, plain bank GET answers **405**) |
| Create bank | `POST /v1/default/banks` | `PUT /v1/default/banks/{bank_id}` (create-or-update; `background` is a deprecated alias for `reflect_mission`) |
| Bank profile fields | `name`, `background`, `disposition` | read from `GET .../config` (`disposition_skepticism`, `disposition_literalism`, `disposition_empathy`, `reflect_mission`); display `name`/`fact_count` come from `GET /v1/default/banks` |
| Recall | `POST .../memories/recall` | unchanged |
| Retain batch | `POST .../memories` | unchanged |

### Error signatures worth knowing

- `410 {"detail":"The bank profile endpoints have been removed..."}` — old profile
  endpoint on a new server. Never treat this as "bank missing".
- `405 {"detail":"Method Not Allowed"}` — `GET /v1/default/banks/{bank_id}` is no
  longer readable.
- `404 {"detail":"Bank 'x' not found"}` — the route exists and the bank is absent.
- `404 {"detail":"Not Found"}` — the **route** is absent (older server), not the bank.
- `422` on retain with `"observation_scopes"` — scopes must be a strategy keyword
  (`per_tag`, `combined`, `all_combinations`, `shared`) or a list of tag groups
  (`string[][]`). A flat `string[]` is rejected.

### How this extension adapts

`extensions/client.ts` probes capabilities once per base URL:

1. `GET /version` -> `features.bank_config_api` decides whether to probe with
   `.../config` (current) or `.../profile` (legacy).
2. If that probe returns an "unknown" answer (405/410/501, or a route-level 404),
   the other generation's probe runs.
3. If both are unknown, `GET /v1/default/banks?q=<bank_id>` is used as a
   non-destructive last resort.
4. Bank creation only happens when a probe positively reports the bank missing,
   so an unreachable or unfamiliar server can never overwrite an existing bank's
   `reflect_mission`.
5. Observation scopes are normalized to `string[][]` before they reach the API.

`@vectorize-io/hindsight-client` is pinned at `^1.0.0`; the 1.0.0 SDK keeps every
method this extension uses and marks `getBankProfile` as removed server-side.
