// Cloudflare Worker: serves the built SPA, a small API for AI-generated natural-language
// summaries of anomalies already flagged by plain statistics on the client (see
// src/anomalyDetection.js), and a Cron Trigger that emails users when a sensor crosses a
// threshold they set in the Alerts panel (see src/AlertSettings.jsx).

const MAX_FLAGS = 50;
// llama-3.1-8b-instruct (non "-fast") was deprecated 2026-05-30; this variant is current.
const MODEL = '@cf/meta/llama-3.1-8b-instruct-fast';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/anomaly-summary' && request.method === 'POST') {
      return handleAnomalySummary(request, env);
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

  const sensorLabel = `device ${rule.device_id}, sensor ${rule.sensor_index}`;
  const subject =
    direction === 'cleared'
      ? `HVAC Alert cleared: ${sensorLabel}`
      : `HVAC Alert: ${sensorLabel} is ${direction} threshold`;
  const text =
    direction === 'cleared'
      ? `${sensorLabel} is back to ${tempF.toFixed(1)}\u00b0F, within your configured range.`
      : `${sensorLabel} is reading ${tempF.toFixed(1)}\u00b0F, which is ${direction} your ` +
        `${direction === 'above' ? rule.high_f : rule.low_f}\u00b0F threshold.`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: env.ALERT_FROM_EMAIL, to: email, subject, text }),
  });
  if (!res.ok) console.error('Failed to send alert email:', await res.text());
}

