import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const userId = '00000000-0000-4000-8000-000000000001';
const otherId = '00000000-0000-4000-8000-000000000002';
let db;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      'select (current_setting(''request.jwt.claims'', true)::jsonb ->> ''sub'')::uuid';
    create function auth.jwt() returns jsonb language sql stable as
      'select current_setting(''request.jwt.claims'', true)::jsonb';
    grant usage on schema auth, public to authenticated, anon, service_role;
    insert into auth.users values ('${userId}'), ('${otherId}');
  `);
  await db.exec(readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8'));
  await db.exec('create policy legacy_all_sensors on public.sensor_data for select to authenticated using (true)');
  await db.exec('grant all on alert_rules to public; grant update(is_triggered) on alert_rules to authenticated');
  await db.exec(readFileSync(new URL('../../supabase/migrations/20261002_monitoring_hardening.sql', import.meta.url), 'utf8'));
  await db.exec(`
    insert into sensor_data(device_id,sensor_index,temperature_c,timestamp) values ('allowed',0,20,now()),('hidden',0,22,now());
    insert into sensor_names(device_id,sensor_index,name) values ('allowed',0,'Allowed'),('hidden',0,'Hidden');
    insert into hvac_events(device_id,sensor_index,event_type,occurred_at) values ('allowed',0,'setback',now()),('hidden',0,'setback',now());
    insert into device_permissions(user_id,device_id,sensor_index) values ('${userId}','allowed',0);
  `);
}, 30_000);
afterAll(async () => { await db?.close(); });

async function asUser(sql, { role = 'authenticated', id = userId, admin = false } = {}) {
  await db.exec(`set role ${role}`);
  try {
    await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: id, app_metadata: admin ? { role: 'admin' } : {} })]);
    return await db.query(sql);
  } finally {
    await db.exec('reset role');
  }
}

describe('monitoring migration in PostgreSQL', () => {
  it.each(['sensor_data', 'sensor_names', 'hvac_events'])('scopes %s by physical sensor grant', async (table) => {
    expect((await asUser(`select device_id from ${table}`)).rows).toEqual([{ device_id: 'allowed' }]);
    expect((await asUser(`select device_id from ${table}`, { id: otherId })).rows).toEqual([]);
    expect((await asUser(`select device_id from ${table}`, { admin: true })).rows).toHaveLength(2);
  });
  it('denies anonymous reads and client ingestion', async () => {
    await expect(asUser('select * from sensor_data', { role: 'anon' })).rejects.toThrow('permission denied');
    await expect(asUser("insert into sensor_data(device_id,sensor_index,temperature_c,timestamp) values('allowed',0,20,now())")).rejects.toThrow('permission denied');
  });
  it('allows an owned rule for a granted sensor', async () => {
    await asUser(`insert into alert_rules(user_id,device_id,sensor_index,high_f) values('${userId}','allowed',0,85)`);
    expect((await asUser('select * from alert_rules')).rows).toHaveLength(1);
    expect((await asUser('select * from alert_rules', { id: otherId })).rows).toHaveLength(0);
  });
  it('blocks a forged rule for an ungranted sensor or another user', async () => {
    await expect(asUser(`insert into alert_rules(user_id,device_id,sensor_index,high_f) values('${userId}','hidden',0,85)`)).rejects.toThrow('row-level security');
    await expect(asUser(`insert into alert_rules(user_id,device_id,sensor_index,high_f) values('${otherId}','allowed',0,85)`)).rejects.toThrow('row-level security');
  });
  it('protects Worker-managed notification state', async () => {
    await expect(asUser('update alert_rules set is_triggered = true')).rejects.toThrow('permission denied');
    await expect(asUser('update alert_rules set last_notified_at = now()')).rejects.toThrow('permission denied');
  });
  it('permits configuration upserts without client lifecycle columns', async () => {
    await asUser(`insert into alert_rules(user_id,device_id,sensor_index,high_f,low_f,enabled)
      values('${userId}','allowed',0,90,65,true) on conflict(user_id,device_id,sensor_index)
      do update set high_f=excluded.high_f,low_f=excluded.low_f,enabled=excluded.enabled`);
    expect((await asUser('select high_f from alert_rules')).rows[0].high_f).toBe('90');
  });
  it('rejects reversed and non-finite thresholds', async () => {
    await expect(asUser('update alert_rules set low_f = 100, high_f = 80')).rejects.toThrow('alert_rules_threshold_order');
    await expect(asUser("update alert_rules set high_f = 'NaN'")).rejects.toThrow();
  });
  it('requires at least one threshold even for direct client writes', async () => {
    await expect(asUser('update alert_rules set high_f = null, low_f = null')).rejects.toThrow('alert_rules_threshold_required');
  });
  it('preserves trusted ingestion privileges', async () => {
    await asUser("insert into sensor_data(device_id,sensor_index,temperature_c,timestamp) values('backend-test',0,20,now())", { role: 'service_role' });
  });
  it('can be reapplied without duplicate policies or indexes', async () => {
    await db.exec(readFileSync(new URL('../../supabase/migrations/20261002_monitoring_hardening.sql', import.meta.url), 'utf8'));
    const { rows } = await db.query("select count(*)::int as count from pg_policies where policyname = 'legacy_all_sensors'");
    expect(rows[0].count).toBe(0);
  });
});
