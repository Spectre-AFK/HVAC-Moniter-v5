-- Review and apply after the base tables in README.md exist.
-- Replaces ALL policies on these five monitoring tables; unrelated tables are untouched.
begin;

do $$
declare policy_row record;
begin
  for policy_row in
    select tablename, policyname from pg_policies
    where schemaname = 'public'
      and tablename in ('sensor_data', 'device_permissions', 'sensor_names', 'alert_rules', 'hvac_events')
  loop
    execute format('drop policy %I on public.%I', policy_row.policyname, policy_row.tablename);
  end loop;
end $$;

alter table public.sensor_data enable row level security;
alter table public.device_permissions enable row level security;
alter table public.sensor_names enable row level security;
alter table public.alert_rules enable row level security;
alter table public.hvac_events enable row level security;

revoke all on public.sensor_data, public.device_permissions, public.sensor_names,
  public.alert_rules, public.hvac_events from public, anon, authenticated;
revoke insert (is_triggered, last_notified_at), update (is_triggered, last_notified_at)
  on public.alert_rules from public, anon, authenticated;
grant select on public.sensor_data, public.device_permissions, public.sensor_names,
  public.alert_rules, public.hvac_events to authenticated;
grant insert, delete on public.device_permissions to authenticated;
grant insert, update on public.sensor_names to authenticated;
grant delete on public.alert_rules to authenticated;
grant insert (user_id, device_id, sensor_index, high_f, low_f, enabled) on public.alert_rules to authenticated;
grant update (user_id, device_id, sensor_index, high_f, low_f, enabled) on public.alert_rules to authenticated;

create policy device_permissions_select on public.device_permissions for select to authenticated
  using (user_id = auth.uid() or auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');
create policy device_permissions_insert on public.device_permissions for insert to authenticated
  with check (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');
create policy device_permissions_delete on public.device_permissions for delete to authenticated
  using (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

create policy sensor_data_select on public.sensor_data for select to authenticated using (
  auth.jwt() -> 'app_metadata' ->> 'role' = 'admin' or exists (
    select 1 from public.device_permissions dp
    where dp.user_id = auth.uid() and dp.device_id = sensor_data.device_id
      and dp.sensor_index = sensor_data.sensor_index
  )
);
create policy sensor_names_select on public.sensor_names for select to authenticated using (
  auth.jwt() -> 'app_metadata' ->> 'role' = 'admin' or exists (
    select 1 from public.device_permissions dp
    where dp.user_id = auth.uid() and dp.device_id = sensor_names.device_id
      and dp.sensor_index = sensor_names.sensor_index
  )
);
create policy sensor_names_insert on public.sensor_names for insert to authenticated
  with check (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');
create policy sensor_names_update on public.sensor_names for update to authenticated
  using (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin')
  with check (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');
create policy hvac_events_select on public.hvac_events for select to authenticated using (
  auth.jwt() -> 'app_metadata' ->> 'role' = 'admin' or exists (
    select 1 from public.device_permissions dp
    where dp.user_id = auth.uid() and dp.device_id = hvac_events.device_id
      and dp.sensor_index = hvac_events.sensor_index
  )
);
create policy alert_rules_select on public.alert_rules for select to authenticated using (user_id = auth.uid());
create policy alert_rules_delete on public.alert_rules for delete to authenticated using (user_id = auth.uid());
create policy alert_rules_insert on public.alert_rules for insert to authenticated with check (
  user_id = auth.uid() and (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin' or exists (
    select 1 from public.device_permissions dp
    where dp.user_id = auth.uid() and dp.device_id = alert_rules.device_id
      and dp.sensor_index = alert_rules.sensor_index
  ))
);
create policy alert_rules_update on public.alert_rules for update to authenticated
  using (user_id = auth.uid()) with check (
    user_id = auth.uid() and (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin' or exists (
      select 1 from public.device_permissions dp
      where dp.user_id = auth.uid() and dp.device_id = alert_rules.device_id
        and dp.sensor_index = alert_rules.sensor_index
    ))
  );

alter table public.alert_rules drop constraint if exists alert_rules_threshold_required;
alter table public.alert_rules add constraint alert_rules_threshold_required
  check (high_f is not null or low_f is not null) not valid;
alter table public.alert_rules drop constraint if exists alert_rules_threshold_order;
alter table public.alert_rules add constraint alert_rules_threshold_order
  check (low_f is null or high_f is null or low_f < high_f) not valid;
alter table public.alert_rules drop constraint if exists alert_rules_threshold_finite;
alter table public.alert_rules add constraint alert_rules_threshold_finite check (
  (high_f is null or high_f::text not in ('NaN', 'Infinity', '-Infinity')) and
  (low_f is null or low_f::text not in ('NaN', 'Infinity', '-Infinity'))
) not valid;
alter table public.sensor_names drop constraint if exists sensor_names_length;
alter table public.sensor_names add constraint sensor_names_length
  check (length(trim(name)) between 1 and 100) not valid;

create unique index if not exists device_permissions_user_sensor_unique
  on public.device_permissions (user_id, device_id, sensor_index);
create index if not exists sensor_data_sensor_time on public.sensor_data (device_id, sensor_index, timestamp desc);
create index if not exists sensor_data_time on public.sensor_data (timestamp desc);
create index if not exists hvac_events_sensor_time on public.hvac_events (device_id, sensor_index, occurred_at desc);
commit;
