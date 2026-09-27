// Cloudflare Worker: serves the built SPA, a small API for AI-generated natural-language
// summaries of anomalies already flagged by plain statistics on the client (see
// src/anomalyDetection.js), and a Cron Trigger that emails users when a sensor crosses a
// threshold they set in the Alerts panel (see src/AlertSettings.jsx).

const MAX_FLAGS = 50;
// llama-3.1-8b-instruct (non "-fast") was deprecated 2026-05-30; this variant is current.
const MODEL = '@cf/meta/llama-3.1-8b-instruct-fast';

// Kept in sync with src/App.jsx's COMPANY_* constants for consistent branding in alert emails.
const COMPANY_NAME = 'Accurate Air Conditioning';
const COMPANY_PHONE = '(520) 230-5453';
const COMPANY_EMAIL = 'contact@aaronjauregui.com';
const BRAND_COLOR = '#d97706'; // amber-600, matches the dashboard's accent color

// Best-effort per-user rate limit for /api/anomaly-summary: this Map lives in the isolate's
// memory, so it resets on cold start and isn't shared across isolates/regions. That's fine
// here — the goal is just to stop accidental spam loops from burning Workers AI quota, not
// to provide an exact distributed limit.
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 10;
const rateLimitBuckets = new Map();

function isRateLimited(userId) {
  const now = Date.now();
  const recent = (rateLimitBuckets.get(userId) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX_REQUESTS) {
    rateLimitBuckets.set(userId, recent);
    return true;
  }
  recent.push(now);
  rateLimitBuckets.set(userId, recent);
  return false;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/anomaly-summary' && request.method === 'POST') {
      return handleAnomalySummary(request, env);
    }

    if (url.pathname === '/api/health' && request.method === 'GET') {
      return handleHealthCheck(request, env);
    }

    if (url.pathname === '/api/admin/users' && request.method === 'GET') {
      return handleAdminUsers(request, env, url);
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(checkAlertRules(env));
  },
};

async function handleAnomalySummary(request, env) {
  const user = await getAuthenticatedUser(request, env);
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (isRateLimited(user.id)) {
    return Response.json({ error: 'Too many requests, please slow down.' }, { status: 429 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { flags } = body;
  if (!Array.isArray(flags) || flags.length === 0) {
    return Response.json({ error: 'flags array is required' }, { status: 400 });
  }
  if (flags.length > MAX_FLAGS) {
    return Response.json({ error: 'Too many flags' }, { status: 400 });
  }

  const FLAG_TYPE_LABELS = {
    zscore: 'outlier reading',
    'trend-short': 'short-term trend (recent readings)',
    'trend-long': 'long-term trend (extended history)',
    flatline: 'flatline / stuck sensor',
  };

  const bulletList = flags
    .map((f) => `- Sensor ${f.sensorIndex} (${FLAG_TYPE_LABELS[f.type] ?? f.type}, severity: ${f.severity}): ${f.message}`)
    .join('\n');

  const messages = [
    {
      role: 'system',
      content:
        'You are an HVAC monitoring assistant that writes calm, neutral, strictly data-grounded ' +
        'summaries for a service technician. You are given a list of anomalies already detected ' +
        'by statistical rules (z-score, trend slope, or flatline checks) — you did not detect ' +
        'these yourself and must not invent new ones or exaggerate them.\n\n' +
        'Rules:\n' +
        '- Reference only the specific numbers given (rate, degrees, hours, z-score). Do not use ' +
        "escalating words like 'severe', 'critical', 'urgent', 'drastic', or 'high rate' — state " +
        'the actual figure instead and let the reader judge.\n' +
        '- You may name at most one plausible HVAC explanation per anomaly, always hedged ' +
        "(e.g. 'could indicate', 'may suggest') — never state a cause as settled fact.\n" +
        "- Only recommend a site visit if a flag's severity is 'high'. For 'medium' severity, say " +
        "it's worth continued monitoring rather than urgent action.\n" +
        "- If a sensor has both a short-term and long-term trend, say whether the recent change " +
        "matches its longer pattern or is a new deviation from it.\n" +
        '- 2-3 concise, neutral sentences. No exclamation marks.',
    },
    { role: 'user', content: bulletList },
  ];

  try {
    const result = await env.AI.run(MODEL, { messages, max_tokens: 512, temperature: 0.3 });
    console.log('Workers AI raw result:', JSON.stringify(result));
    const summary = typeof result === 'string' ? result : (result?.response ?? '');
    return Response.json({ summary });
  } catch (err) {
    console.error('Workers AI request failed:', err);
    return Response.json({ error: 'AI summary failed' }, { status: 502 });
  }
}

// Admin-only: reports which secrets required for alerts/AI summaries are configured, without
// revealing their values, so a missing wrangler secret shows up here instead of only in
// `wrangler tail` logs the next time the cron silently no-ops.
async function handleHealthCheck(request, env) {
  const user = await getAuthenticatedUser(request, env);
  if (!user || user?.app_metadata?.role !== 'admin') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return Response.json({
    ai: { workersAiBinding: Boolean(env.AI) },
    alerts: {
      supabaseServiceRoleKey: Boolean(env.SUPABASE_SERVICE_ROLE_KEY),
      resendApiKey: Boolean(env.RESEND_API_KEY),
      alertFromEmail: Boolean(env.ALERT_FROM_EMAIL),
    },
  });
}

const MAX_USER_SEARCH_RESULTS = 20;
const MAX_USER_ID_LOOKUPS = 50;

// Admin-only: looks up Supabase users for the AdminPanel's grant form, either by email
// substring (?query=) or by a batch of known ids (?ids=a,b,c) to resolve ids already stored
// in device_permissions back to a display email. Uses the service role key because the
// Admin Users API isn't reachable with the anon key.
async function handleAdminUsers(request, env, url) {
  const user = await getAuthenticatedUser(request, env);
  if (!user || user?.app_metadata?.role !== 'admin') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ error: 'SUPABASE_SERVICE_ROLE_KEY is not configured' }, { status: 503 });
  }

  const idsParam = url.searchParams.get('ids');
  if (idsParam) {
    const ids = [...new Set(idsParam.split(',').map((id) => id.trim()).filter(Boolean))].slice(0, MAX_USER_ID_LOOKUPS);
    const users = await Promise.all(
      ids.map(async (id) => {
        const res = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${id}`, { headers: supabaseAdminHeaders(env) });
        if (!res.ok) return null;
        const u = await res.json();
        return u?.id ? { id: u.id, email: u.email ?? null } : null;
      })
    );
    return Response.json({ users: users.filter(Boolean) });
  }

  const query = (url.searchParams.get('query') || '').trim().toLowerCase();
  if (query.length < 2) {
    return Response.json({ error: 'query must be at least 2 characters' }, { status: 400 });
  }

  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users?per_page=200`, {
    headers: supabaseAdminHeaders(env),
  });
  if (!res.ok) {
    console.error('Failed to list users:', await res.text());
    return Response.json({ error: 'Failed to search users' }, { status: 502 });
  }

  const body = await res.json();
  const users = (body?.users ?? [])
    .filter((u) => u.email?.toLowerCase().includes(query))
    .slice(0, MAX_USER_SEARCH_RESULTS)
    .map((u) => ({ id: u.id, email: u.email }));

  return Response.json({ users });
}

// Verifies the bearer token against Supabase Auth rather than trusting the client.
async function getAuthenticatedUser(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;

  try {
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: env.SUPABASE_ANON_KEY,
      },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Server-side helper for calling Supabase's REST/Admin APIs with the service role key, which
// bypasses Row Level Security. Only used here, in the Cron Trigger — never exposed to the client.
function supabaseAdminHeaders(env) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  };
}

// Runs on a schedule (see wrangler.jsonc "triggers"): checks every enabled alert_rules row
// against that sensor's latest reading and emails the rule's owner when a threshold is crossed.
async function checkAlertRules(env) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('SUPABASE_SERVICE_ROLE_KEY is not set; skipping alert check.');
    return;
  }

  const rulesRes = await fetch(`${env.SUPABASE_URL}/rest/v1/alert_rules?enabled=eq.true&select=*`, {
    headers: supabaseAdminHeaders(env),
  });
  if (!rulesRes.ok) {
    console.error('Failed to fetch alert rules:', await rulesRes.text());
    return;
  }

  const rules = await rulesRes.json();
  for (const rule of rules) {
    try {
      await evaluateRule(rule, env);
    } catch (err) {
      console.error(`Failed to evaluate alert rule ${rule.id}:`, err);
    }
  }
}

async function evaluateRule(rule, env) {
  const dataRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/sensor_data?device_id=eq.${encodeURIComponent(rule.device_id)}` +
      `&sensor_index=eq.${rule.sensor_index}&order=timestamp.desc&limit=1&select=temperature_c,timestamp`,
    { headers: supabaseAdminHeaders(env) }
  );
  if (!dataRes.ok) {
    console.error(`Failed to fetch latest reading for rule ${rule.id}:`, await dataRes.text());
    return;
  }

  const [latest] = await dataRes.json();
  if (!latest) return;

  const tempF = (latest.temperature_c * 9) / 5 + 32;
  const breachedHigh = rule.high_f != null && tempF > rule.high_f;
  const breachedLow = rule.low_f != null && tempF < rule.low_f;
  const isBreached = breachedHigh || breachedLow;

  if (isBreached && !rule.is_triggered) {
    await sendAlertEmail(rule, { tempF, direction: breachedHigh ? 'above' : 'below' }, env);
    await updateRuleState(rule.id, { is_triggered: true, last_notified_at: new Date().toISOString() }, env);
  } else if (!isBreached && rule.is_triggered) {
    await sendAlertEmail(rule, { tempF, direction: 'cleared' }, env);
    await updateRuleState(rule.id, { is_triggered: false, last_notified_at: new Date().toISOString() }, env);
  }
}

async function updateRuleState(id, patch, env) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/alert_rules?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...supabaseAdminHeaders(env), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) console.error(`Failed to update alert rule ${id}:`, await res.text());
}

async function getUserEmail(userId, env) {
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    headers: supabaseAdminHeaders(env),
  });
  if (!res.ok) return null;
  const user = await res.json();
  return user?.email ?? null;
}

// Mirrors the "Sensor N · Device XXXX" fallback format used in src/App.jsx's sensorLabel().
async function getSensorLabel(deviceId, sensorIndex, env) {
  const shortDeviceId = deviceId ? deviceId.slice(-4).toUpperCase() : '????';
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/sensor_names?device_id=eq.${encodeURIComponent(deviceId)}` +
      `&sensor_index=eq.${sensorIndex}&select=name&limit=1`,
    { headers: supabaseAdminHeaders(env) }
  );
  const [row] = res.ok ? await res.json() : [];
  const name = row?.name?.trim() || `Sensor ${sensorIndex}`;
  return `${name} · Device ${shortDeviceId}`;
}

// Retries a transient failure (network error or 5xx) once after a short delay so a single
// blip in the Resend API doesn't silently drop an alert the user is relying on.
async function fetchWithRetry(url, options, retries = 1, delayMs = 1000) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.ok || res.status < 500 || attempt >= retries) return res;
    } catch (err) {
      if (attempt >= retries) throw err;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

async function sendAlertEmail(rule, { tempF, direction }, env) {
  if (!env.RESEND_API_KEY || !env.ALERT_FROM_EMAIL) {
    console.error('RESEND_API_KEY or ALERT_FROM_EMAIL is not set; skipping alert email.');
    return;
  }

  const email = await getUserEmail(rule.user_id, env);
  if (!email) {
    console.error(`No email found for user ${rule.user_id}; skipping alert.`);
    return;
  }

  const sensorLabel = await getSensorLabel(rule.device_id, rule.sensor_index, env);
  const isCleared = direction === 'cleared';
  const subject = isCleared ? `Alert cleared: ${sensorLabel}` : `Alert: ${sensorLabel} is ${direction} threshold`;
  const threshold = direction === 'above' ? rule.high_f : rule.low_f;
  const text = isCleared
    ? `${sensorLabel} is back to ${tempF.toFixed(1)}\u00b0F, within your configured range.`
    : `${sensorLabel} is reading ${tempF.toFixed(1)}\u00b0F, which is ${direction} your ${threshold}\u00b0F threshold.`;

  const statusColor = isCleared ? '#059669' : '#dc2626'; // emerald-600 / red-600
  const statusText = isCleared ? 'Back to normal' : 'Threshold breached';
  const detailRow = isCleared
    ? ''
    : `<tr><td style="padding:4px 0;color:#64748b;font-size:14px;">Threshold</td>` +
      `<td style="padding:4px 0;color:#0f172a;font-size:14px;text-align:right;">${threshold}\u00b0F (${direction})</td></tr>`;

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;">
      <div style="background:${BRAND_COLOR};padding:20px 24px;border-radius:12px 12px 0 0;">
        <span style="color:#fff;font-size:18px;font-weight:700;">${COMPANY_NAME}</span>
      </div>
      <div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;padding:24px;">
        <p style="margin:0 0 4px;color:${statusColor};font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:0.05em;">${statusText}</p>
        <h1 style="margin:0 0 16px;color:#0f172a;font-size:20px;">${sensorLabel}</h1>
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:4px 0;color:#64748b;font-size:14px;">Current reading</td>
              <td style="padding:4px 0;color:#0f172a;font-size:14px;text-align:right;font-weight:600;">${tempF.toFixed(1)}\u00b0F</td></tr>
          ${detailRow}
        </table>
        <p style="margin:20px 0 0;color:#64748b;font-size:13px;">${text}</p>
      </div>
      <p style="text-align:center;color:#94a3b8;font-size:12px;margin-top:16px;">
        ${COMPANY_NAME} &middot; ${COMPANY_PHONE} &middot; ${COMPANY_EMAIL}
      </p>
    </div>`;

  const res = await fetchWithRetry('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: env.ALERT_FROM_EMAIL, to: email, subject, text, html }),
  });
  if (!res.ok) console.error('Failed to send alert email:', await res.text());
}

