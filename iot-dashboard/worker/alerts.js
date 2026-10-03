import { detectHvacPatterns } from '../src/cycleDetection.js';
import { convertCtoF, sensorKey, sensorLabel } from '../src/sensors.js';
import { adminHeaders, fetchRemote, getRows, getPagedRows } from './supabase.js';
import { validateThresholds } from '../src/alertThresholds.js';

const MAX_READING_AGE_MS = 30 * 60_000;
const COMPANY_NAME = 'Accurate Air Conditioning';
const COMPANY_PHONE = '(520) 230-5453';
const COMPANY_EMAIL = 'contact@aaronjauregui.com';

export const escapeHtml = (text) => String(text).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function writeRows(env, path, method, body, prefer = 'return=minimal') {
  const response = await fetchRemote(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: { ...adminHeaders(env), 'Content-Type': 'application/json', Prefer: prefer },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Database ${method} failed for ${path.split('?')[0]} (${response.status}).`);
}

export async function detectAndLogHvacEvents(env) {
  const cutoff = new Date(Date.now() - 48 * 60 * 60_000).toISOString();
  const recent = await getPagedRows(env,
    `sensor_data?select=device_id,sensor_index,timestamp&timestamp=gte.${encodeURIComponent(cutoff)}&order=timestamp.desc,device_id.asc,sensor_index.asc`);
  const sensors = new Map(recent.map(row => [sensorKey(row.device_id, row.sensor_index), row]));
  let failures = 0;
  for (const { device_id, sensor_index } of sensors.values()) {
    try {
      const rows = await getRows(env, `sensor_data?device_id=eq.${encodeURIComponent(device_id)}&sensor_index=eq.${sensor_index}&order=timestamp.desc&limit=200&select=temperature_c,timestamp`);
      const readingsDesc = rows.map(row => ({ timestamp: row.timestamp, tempF: convertCtoF(row.temperature_c) }));
      const patterns = detectHvacPatterns([{ key: sensorKey(device_id, sensor_index), label: '', readingsDesc }]);
      for (const flag of patterns) {
        if (flag.type !== 'setback') continue;
        await writeRows(env, 'hvac_events?on_conflict=device_id,sensor_index,event_type,occurred_at', 'POST', {
          device_id, sensor_index, event_type: 'setback', occurred_at: flag.occurredAt,
          amplitude_f: flag.amplitudeF, duration_minutes: flag.durationMinutes, typical_amplitude_f: flag.typicalAmplitudeF,
        }, 'resolution=ignore-duplicates,return=minimal');
      }
    } catch (error) {
      failures++;
      console.error(JSON.stringify({ event: 'hvac_event_failure', device_id, sensor_index, message: error.message }));
    }
  }
  if (failures) throw new Error(`${failures} sensors failed HVAC event processing.`);
}

async function userCanReadSensor(rule, env) {
  const response = await fetchRemote(`${env.SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(rule.user_id)}`, {
    headers: adminHeaders(env),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Could not resolve alert owner (${response.status}).`);
  const user = await response.json();
  if (user.app_metadata?.role === 'admin') return user;
  const grants = await getRows(env, `device_permissions?user_id=eq.${encodeURIComponent(rule.user_id)}&device_id=eq.${encodeURIComponent(rule.device_id)}&sensor_index=eq.${rule.sensor_index}&select=id&limit=1`);
  return grants.length ? user : null;
}

export async function evaluateRule(rule, env, now = Date.now()) {
  const user = await userCanReadSensor(rule, env);
  if (!user) {
    console.warn(JSON.stringify({ event: 'alert_owner_access_revoked', rule_id: rule.id }));
    return;
  }
  const rows = await getRows(env, `sensor_data?device_id=eq.${encodeURIComponent(rule.device_id)}&sensor_index=eq.${rule.sensor_index}&order=timestamp.desc&limit=1&select=temperature_c,timestamp`);
  if (rows.length === 0) {
    console.warn(JSON.stringify({ event: 'alert_sensor_has_no_reading', rule_id: rule.id }));
    return;
  }
  const latest = rows[0];
  const timestamp = Date.parse(latest.timestamp);
  if (!Number.isFinite(timestamp) || latest.temperature_c === null || !Number.isFinite(Number(latest.temperature_c))) {
    throw new Error('Invalid sensor reading for alert evaluation.');
  }
  if (now - timestamp > MAX_READING_AGE_MS || timestamp > now + 300_000) {
    console.warn(JSON.stringify({ event: 'alert_reading_stale', rule_id: rule.id, timestamp: latest.timestamp }));
    return;
  }
  const { high, low } = validateThresholds(rule.high_f, rule.low_f);
  const tempF = convertCtoF(latest.temperature_c);
  const direction = high !== null && tempF > high ? 'above' : low !== null && tempF < low ? 'below' : 'cleared';
  if ((direction !== 'cleared') === Boolean(rule.is_triggered)) return;
  if (!env.RESEND_API_KEY || !env.ALERT_FROM_EMAIL) throw new Error('Alert email configuration is missing.');
  if (!user.email) throw new Error('Alert owner has no email address.');
  const names = await getRows(env, `sensor_names?device_id=eq.${encodeURIComponent(rule.device_id)}&sensor_index=eq.${rule.sensor_index}&select=name&limit=1`);
  const label = sensorLabel({ [sensorKey(rule.device_id, rule.sensor_index)]: names[0]?.name }, rule.device_id, rule.sensor_index);
  const cleared = direction === 'cleared';
  const subject = cleared ? `Alert cleared: ${label}` : `Alert: ${label} is ${direction} threshold`;
  const text = cleared
    ? `${label} is back to ${tempF.toFixed(1)}\u00b0F, within your configured range.`
    : `${label} is reading ${tempF.toFixed(1)}\u00b0F, ${direction} your ${direction === 'above' ? high : low}\u00b0F threshold.`;
  const html = `<div style="font-family:Segoe UI,sans-serif;max-width:480px;margin:auto">
    <h2 style="background:#d97706;color:white;padding:20px">${escapeHtml(COMPANY_NAME)}</h2>
    <p style="color:${cleared ? '#059669' : '#dc2626'}">${cleared ? 'Back to normal' : 'Threshold breached'}</p>
    <h1>${escapeHtml(label)}</h1><p>${escapeHtml(text)}</p>
    <p style="color:#64748b">${escapeHtml(COMPANY_NAME)} &middot; ${escapeHtml(COMPANY_PHONE)} &middot; ${escapeHtml(COMPANY_EMAIL)}</p></div>`;
  // The provider key identifies this transition and reading across cron retries.
  const idempotencyKey = `hvac-${rule.id}-${direction}-${timestamp}`;
  let response;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      response = await fetchRemote('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ from: env.ALERT_FROM_EMAIL, to: user.email, subject, text, html }),
      });
    } catch (error) {
      if (attempt === 1) throw error;
      console.warn(JSON.stringify({ event: 'alert_email_retry', rule_id: rule.id, message: error.message }));
      await new Promise(resolve => setTimeout(resolve, 1000));
      continue;
    }
    if (response.ok || response.status < 500 || attempt === 1) break;
    await response.body?.cancel();
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (!response.ok) throw new Error(`Email provider rejected alert (${response.status}).`);
  await response.body?.cancel();
  await writeRows(env, `alert_rules?id=eq.${encodeURIComponent(rule.id)}`, 'PATCH', {
    is_triggered: !cleared, last_notified_at: new Date(now).toISOString(),
  });
  console.log(JSON.stringify({ event: 'alert_transition_sent', rule_id: rule.id, direction }));
}

export async function checkAlertRules(env) {
  const rules = await getPagedRows(env, 'alert_rules?enabled=eq.true&select=*&order=id.asc');
  let failures = 0;
  for (const rule of rules) {
    try {
      await evaluateRule(rule, env);
    } catch (error) {
      failures++;
      console.error(JSON.stringify({ event: 'alert_rule_failure', rule_id: rule.id, message: error.message }));
    }
  }
  if (failures) throw new Error(`${failures} alert rules failed evaluation.`);
}
