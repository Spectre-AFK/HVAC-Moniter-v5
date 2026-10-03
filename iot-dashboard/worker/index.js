import { handleApi } from './api.js';
import { checkAlertRules, detectAndLogHvacEvents } from './alerts.js';
import { HttpError } from './supabase.js';

export default {
  async fetch(request, env) {
    if (!new URL(request.url).pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      const response = await handleApi(request, env);
      response.headers.set('Cache-Control', 'no-store');
      response.headers.set('X-Content-Type-Options', 'nosniff');
      return response;
    } catch (error) {
      console.error(JSON.stringify({ event: 'api_failure', status: error instanceof HttpError ? error.status : 500, message: error.message }));
      return Response.json({ error: error instanceof HttpError ? error.message : 'Internal server error.' }, {
        status: error instanceof HttpError ? error.status : 500,
        headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
      });
    }
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(checkAlertRules(env));
    ctx.waitUntil(detectAndLogHvacEvents(env));
  },
};
