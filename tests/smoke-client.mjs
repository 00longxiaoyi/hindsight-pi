import { HindsightClient } from '@vectorize-io/hindsight-client';

const baseUrl = process.env.HINDSIGHT_BASE_URL || process.env.HINDSIGHT_API_URL || 'http://localhost:8888';
const apiKey = process.env.HINDSIGHT_API_KEY;
const bankId = process.env.HINDSIGHT_TEST_BANK_ID || 'hindsight-pi-smoke';

const client = new HindsightClient({
  baseUrl,
  ...(apiKey ? { apiKey } : {}),
});

const trim = (url) => url.replace(/\/+$/, '');
const headers = {
  'Content-Type': 'application/json',
  ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
};

const request = async (method, path, body) => {
  const response = await fetch(`${trim(baseUrl)}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, ok: response.ok, text: await response.text() };
};

try {
  const version = await request('GET', '/version');
  const features = version.ok ? (JSON.parse(version.text)?.features ?? {}) : {};
  const supportsBankConfig = features.bank_config_api === true;

  // Hindsight 0.5.5+ removed the bank profile endpoint (410); use the config
  // endpoint there and only fall back to the profile probe on older servers.
  const probe = supportsBankConfig
    ? await request('GET', `/v1/default/banks/${encodeURIComponent(bankId)}/config`)
    : await request('GET', `/v1/default/banks/${encodeURIComponent(bankId)}/profile`);

  if (probe.status === 404) {
    await client.createBank(bankId, supportsBankConfig
      ? { name: bankId, reflectMission: 'Smoke test bank for hindsight-pi' }
      : { name: bankId, background: 'Smoke test bank for hindsight-pi' });
  } else if (!probe.ok) {
    throw new Error(`bank probe failed: ${probe.status} ${probe.text.slice(0, 200)}`);
  }

  await client.retainBatch(bankId, [{
    content: 'Smoke test memory from hindsight-pi extension scaffold.',
    context: 'manual smoke test',
    metadata: { source: 'hindsight-pi-smoke' },
    tags: ['harness:pi', 'smoke:test'],
    observation_scopes: [['harness:pi']],
    document_id: 'hindsight-pi-smoke-session',
    update_mode: 'append',
    timestamp: new Date().toISOString(),
  }], { async: false });

  const result = await client.recall(bankId, 'smoke test memory', { budget: 'low', maxTokens: 256 });
  // Leave the bank as we found it.
  const cleanup = await request('DELETE', `/v1/default/banks/${encodeURIComponent(bankId)}/documents/hindsight-pi-smoke-session`);
  console.log(JSON.stringify({
    ok: true,
    baseUrl,
    bankId,
    serverApiVersion: version.ok ? JSON.parse(version.text).api_version : 'unknown',
    bankConfigApi: supportsBankConfig,
    resultCount: result?.results?.length ?? 0,
    cleanupStatus: cleanup.status,
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, baseUrl, bankId, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exit(1);
}
