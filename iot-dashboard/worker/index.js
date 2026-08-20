// Cloudflare Worker: serves the built SPA and a small API for AI-generated
// natural-language summaries of anomalies already flagged by plain statistics
// on the client (see src/anomalyDetection.js). The LLM never detects anomalies
// itself — it only explains ones that were already found deterministically.

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
