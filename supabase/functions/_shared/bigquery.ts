/**
 * BigQuery REST API utility for Edge Functions.
 *
 * Uses GCP Service Account JSON key (stored as GCP_SERVICE_ACCOUNT_JSON secret)
 * to generate JWT tokens and call BigQuery directly.
 *
 * Strategy: DELETE all rows for organization_id, then INSERT new rows.
 */

// ─── JWT Generation ─────────────────────────────────────────

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  project_id: string;
  token_uri: string;
}

function base64url(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function strToUint8(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

/**
 * Import a PEM private key into a CryptoKey for RS256 signing.
 */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const pemBody = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');

  const binaryDer = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));

  return crypto.subtle.importKey(
    'pkcs8',
    binaryDer.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

/**
 * Create a signed JWT for Google OAuth2.
 */
async function createSignedJwt(
  sa: ServiceAccountKey,
  scopes: string[],
  lifetimeSec = 3600
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: sa.client_email,
    sub: sa.client_email,
    aud: sa.token_uri,
    iat: now,
    exp: now + lifetimeSec,
    scope: scopes.join(' '),
  };

  const headerB64 = base64url(strToUint8(JSON.stringify(header)));
  const payloadB64 = base64url(strToUint8(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await importPrivateKey(sa.private_key);
  const sigBytes = new Uint8Array(
    await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, strToUint8(signingInput))
  );
  const sigB64 = base64url(sigBytes);

  return `${signingInput}.${sigB64}`;
}

/**
 * Exchange a signed JWT for an access token via Google token endpoint.
 */
async function getAccessToken(sa: ServiceAccountKey): Promise<string> {
  const jwt = await createSignedJwt(sa, [
    'https://www.googleapis.com/auth/bigquery',
  ]);

  const resp = await fetch(sa.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Token exchange failed (${resp.status}): ${text}`);
  }

  const data = await resp.json();
  return data.access_token;
}

// ─── Token cache (per-isolate) ──────────────────────────────

let cachedToken: string | null = null;
let cachedTokenExpiry = 0;

async function getToken(sa: ServiceAccountKey): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedTokenExpiry > now + 60_000) {
    return cachedToken;
  }
  cachedToken = await getAccessToken(sa);
  cachedTokenExpiry = now + 3500_000; // ~58 min
  return cachedToken;
}

// ─── Public API ─────────────────────────────────────────────

export const BQ_DATASET = 'roofing_saas';
export const BQ_TABLE = 'master_products_current';

/**
 * Load service account key from env.
 */
export function loadServiceAccount(): ServiceAccountKey {
  const raw = Deno.env.get('GCP_SERVICE_ACCOUNT_JSON');
  if (!raw) throw new Error('GCP_SERVICE_ACCOUNT_JSON secret not configured');
  return JSON.parse(raw) as ServiceAccountKey;
}

/**
 * Execute a BigQuery query (DML or SELECT).
 */
export async function bqQuery(
  sa: ServiceAccountKey,
  query: string,
  params?: Record<string, string | number | boolean>
): Promise<{ rows: Record<string, unknown>[]; totalRows: number }> {
  const token = await getToken(sa);
  const projectId = sa.project_id;

  const body: Record<string, unknown> = {
    query,
    useLegacySql: false,
    maxResults: 50000,
  };

  if (params) {
    body.parameterMode = 'NAMED';
    body.queryParameters = Object.entries(params).map(([name, value]) => ({
      name,
      parameterType: {
        type: typeof value === 'number'
          ? (Number.isInteger(value) ? 'INT64' : 'FLOAT64')
          : typeof value === 'boolean'
            ? 'BOOL'
            : 'STRING',
      },
      parameterValue: { value: String(value) },
    }));
  }

  const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`BigQuery query failed (${resp.status}): ${text.substring(0, 500)}`);
  }

  const result = await resp.json();
  const schema = result.schema?.fields || [];
  const rawRows = result.rows || [];

  const rows = rawRows.map((row: { f: { v: unknown }[] }) => {
    const obj: Record<string, unknown> = {};
    schema.forEach((field: { name: string; type: string }, i: number) => {
      const val = row.f[i]?.v;
      if (val === null || val === undefined) {
        obj[field.name] = null;
      } else if (field.type === 'FLOAT' || field.type === 'FLOAT64') {
        obj[field.name] = parseFloat(val as string);
      } else if (field.type === 'INTEGER' || field.type === 'INT64') {
        obj[field.name] = parseInt(val as string, 10);
      } else if (field.type === 'BOOLEAN' || field.type === 'BOOL') {
        obj[field.name] = val === 'true';
      } else {
        obj[field.name] = val;
      }
    });
    return obj;
  });

  return { rows, totalRows: parseInt(result.totalRows || '0', 10) };
}

/**
 * Stream INSERT rows into BigQuery using the insertAll (streaming) API.
 * Batches rows to avoid 10MB request limit.
 */
export async function bqInsertRows(
  sa: ServiceAccountKey,
  rows: Record<string, unknown>[],
  batchSize = 500
): Promise<{ inserted: number; errors: string[] }> {
  const token = await getToken(sa);
  const projectId = sa.project_id;
  const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/datasets/${BQ_DATASET}/tables/${BQ_TABLE}/insertAll`;

  let inserted = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const body = {
      skipInvalidRows: true,
      ignoreUnknownValues: true,
      rows: batch.map((row, idx) => ({
        insertId: `row_${i + idx}_${Date.now()}`,
        json: row,
      })),
    };

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text();
      errors.push(`Batch ${i}-${i + batch.length}: HTTP ${resp.status}: ${text.substring(0, 200)}`);
      continue;
    }

    const result = await resp.json();
    if (result.insertErrors?.length) {
      const batchErrors = result.insertErrors.map(
        (e: { index: number; errors: { reason: string; message: string }[] }) =>
          `Row ${i + e.index}: ${e.errors.map((x: { message: string }) => x.message).join(', ')}`
      );
      errors.push(...batchErrors);
      inserted += batch.length - result.insertErrors.length;
    } else {
      inserted += batch.length;
    }
  }

  return { inserted, errors };
}

/**
 * Delete all rows for an organization from the master table.
 */
export async function bqDeleteOrganization(
  sa: ServiceAccountKey,
  organizationId: string
): Promise<{ deleted: number }> {
  const query = `DELETE FROM \`${sa.project_id}.${BQ_DATASET}.${BQ_TABLE}\` WHERE organization_id = @org_id`;
  const result = await bqQuery(sa, query, { org_id: organizationId });
  return { deleted: result.totalRows };
}

/**
 * Count rows for an organization.
 */
export async function bqCountRows(
  sa: ServiceAccountKey,
  organizationId: string
): Promise<number> {
  const query = `SELECT COUNT(*) as cnt FROM \`${sa.project_id}.${BQ_DATASET}.${BQ_TABLE}\` WHERE organization_id = @org_id`;
  const result = await bqQuery(sa, query, { org_id: organizationId });
  return (result.rows[0]?.cnt as number) || 0;
}
