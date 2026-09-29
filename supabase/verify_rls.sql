-- Run this in the Supabase SQL editor to confirm Row Level Security is actually enabled
-- and configured as documented in ../README.md, rather than assuming the setup SQL was run.
--
-- Expected result for every row below: rls_enabled = true.
-- If any table shows false, run the corresponding "enable row level security" + policy
-- SQL from README.md (Admin Access / Restricting Sensor Visibility / Naming Sensors /
-- Sensor Alerts sections) before relying on this app with real users.

select
  pg_class.relname as table_name,
  pg_class.relrowsecurity as rls_enabled
from pg_class
join pg_namespace on pg_namespace.oid = pg_class.relnamespace
where pg_namespace.nspname = 'public'
  and pg_class.relname in ('sensor_data', 'device_permissions', 'sensor_names', 'alert_rules', 'hvac_events')
order by pg_class.relname;

-- Lists every policy actually attached to those tables, so you can compare against the
-- policy names/definitions in README.md (e.g. "device_permissions_select", "alert_rules_insert").
-- A table with rls_enabled = true but zero rows here means all access is blocked (fail-closed) --
-- not a security problem, but likely means a policy is missing and the app will look "broken".
--
-- Pay special attention to any `sensor_data` policy with cmd = 'INSERT' and roles including
-- 'anon' or 'authenticated': ingestion (node-red/mqtt-bridge) writes with the service_role key,
-- which bypasses RLS, so sensor_data shouldn't need an anon/authenticated insert policy at all
-- — one existing anyway would mean anyone holding the (public) anon key could write arbitrary
-- readings directly via the REST API, bypassing MQTT entirely. The same logic applies to
-- `hvac_events`: only worker/index.js's Cron Trigger (service_role key) should ever write to it.
select
  tablename as table_name,
  policyname,
  cmd as command,
  roles,
  qual as using_expression,
  with_check as with_check_expression
from pg_policies
where schemaname = 'public'
  and tablename in ('sensor_data', 'device_permissions', 'sensor_names', 'alert_rules', 'hvac_events')
order by tablename, cmd, policyname;
