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

  const bulletList = flags
    .map((f) => `- Sensor ${f.sensorIndex} (${f.type}, severity: ${f.severity}): ${f.message}`)
    .join('\n');

  const messages = [
    {
      role: 'system',
      content:
        'You are an HVAC monitoring assistant. You are given a list of anomalies already ' +
        'detected by statistical rules (z-score, trend slope, or flatline checks) on ' +
        'temperature sensor data. Summarize them for a service technician in 2-4 concise ' +
        'sentences: what changed, a plausible HVAC cause, and whether it warrants a site ' +
        'visit. Only use the data given to you — do not invent readings or timestamps.',
    },
    { role: 'user', content: bulletList },
  ];

  try {
    const result = await env.AI.run(MODEL, { messages });
    return Response.json({ summary: result.response ?? '' });
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
