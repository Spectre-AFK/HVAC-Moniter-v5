export async function insertReadings(rows, { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY }, fetchImpl = fetch) {
  const res = await fetchImpl(`${SUPABASE_URL}/rest/v1/sensor_data`, {
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`Supabase insert failed (${res.status}): ${await res.text()}`);
}
export function describeBrokerUrl(value) {
  const url = new URL(value);
  if (!url.host) throw new TypeError('The broker URL needs a hostname.');
  return `${url.protocol}//${url.host}`;
}
