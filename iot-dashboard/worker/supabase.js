export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function fetchRemote(url, options = {}) {
  try {
    return await globalThis.fetch(url, { ...options, signal: options.signal ?? AbortSignal.timeout(15_000) });
  } catch (error) {
    console.error(JSON.stringify({ event: 'upstream_transport_failure', message: error.message }));
    throw new HttpError(502, 'An upstream service is unavailable.');
  }
}

export function adminHeaders(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new HttpError(503, 'Supabase backend configuration is missing.');
  }
  return { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
}

export async function getAuthenticatedUser(request, env) {
  const token = request.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new HttpError(401, 'Unauthorized');
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) throw new HttpError(503, 'Authentication is not configured.');
  const response = await fetchRemote(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (response.status === 401 || response.status === 403) throw new HttpError(401, 'Unauthorized');
  if (!response.ok) throw new HttpError(502, 'Authentication service is unavailable.');
  const user = await response.json();
  if (!user || typeof user.id !== 'string') throw new HttpError(502, 'Invalid authentication response.');
  return user;
}

export async function getRows(env, path) {
  const response = await fetchRemote(`${env.SUPABASE_URL}/rest/v1/${path}`, { headers: adminHeaders(env) });
  if (!response.ok) {
    console.error(JSON.stringify({ event: 'database_read_failure', status: response.status, resource: path.split('?')[0] }));
    throw new HttpError(502, 'Database read failed.');
  }
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new HttpError(502, 'Invalid database response.');
  return rows;
}

export async function getPagedRows(env, path) {
  const rows = [];
  while (rows.length < 10_000) {
    const page = await getRows(env, `${path}${path.includes('?') ? '&' : '?'}limit=500&offset=${rows.length}`);
    if (page.length === 0) return rows;
    rows.push(...page);
  }
  throw new HttpError(503, `Maximum of 10,000 ${path.split('?')[0]} rows reached; scheduled processing is incomplete.`);
}
