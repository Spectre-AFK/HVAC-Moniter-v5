-- Fixes from the 2026-11-16 database review. Safe to re-run.
begin;

-- 1. A leftover unique rule on (user_id, sensor_index) ignored device_id, so a user could hold
--    "sensor 0" on only one device. The correct (user_id, device_id, sensor_index) rule stays.
alter table public.device_permissions drop constraint if exists device_permissions_user_id_sensor_index_key;
alter table public.device_permissions alter column user_id set not null;
alter table public.device_permissions alter column device_id set not null;

-- 2. Readings stored before devices reported an ID have no device_id. Nobody can be granted
--    them and they break history loading, so move them to a private archive schema (not
--    exposed through the API) instead of deleting them, then require device_id.
create schema if not exists archive;
revoke all on schema archive from public;
do $$
begin
  if to_regclass('archive.sensor_data_unassigned') is null then
    create table archive.sensor_data_unassigned as
      select * from public.sensor_data where device_id is null;
  else
    insert into archive.sensor_data_unassigned
      select * from public.sensor_data s where s.device_id is null
        and not exists (select 1 from archive.sensor_data_unassigned a where a.id = s.id);
  end if;
end $$;
delete from public.sensor_data where device_id is null;
alter table public.sensor_data alter column device_id set not null;

-- 3. Changing a rule's thresholds or switching it on/off starts its alert state fresh, so a
--    re-enabled rule cannot skip a breach email or send a surprise "back to normal" email.
create or replace function public.reset_alert_state() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if new.enabled is distinct from old.enabled
     or new.high_f is distinct from old.high_f
     or new.low_f is distinct from old.low_f then
    new.is_triggered := false;
    new.last_notified_at := null;
  end if;
  return new;
end;
$$;
revoke execute on function public.reset_alert_state() from public, anon, authenticated;
drop trigger if exists alert_rules_reset_state on public.alert_rules;
create trigger alert_rules_reset_state before update on public.alert_rules
  for each row execute function public.reset_alert_state();
update public.alert_rules set is_triggered = false, last_notified_at = null
  where not enabled and is_triggered;

-- 4 & 5. Supabase-created helpers and tables that exist only in the hosted project.
do $$
begin
  if to_regprocedure('public.handle_new_user()') is not null then
    alter function public.handle_new_user() set search_path = '';
    revoke execute on function public.handle_new_user() from public, anon, authenticated;
  end if;
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
  if to_regclass('public.profiles') is not null then
    revoke all on public.profiles from anon, authenticated;
  end if;
  if to_regclass('public.device_names') is not null then
    revoke all on public.device_names from anon;
    revoke truncate, references, trigger on public.device_names from authenticated;
  end if;
end $$;

-- 6. Evaluate auth.uid()/auth.jwt() once per query instead of once per row.
drop policy if exists device_permissions_select on public.device_permissions;
drop policy if exists device_permissions_insert on public.device_permissions;
drop policy if exists device_permissions_delete on public.device_permissions;
create policy device_permissions_select on public.device_permissions for select to authenticated
  using (user_id = (select auth.uid()) or ((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');
create policy device_permissions_insert on public.device_permissions for insert to authenticated
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');
create policy device_permissions_delete on public.device_permissions for delete to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists sensor_data_select on public.sensor_data;
create policy sensor_data_select on public.sensor_data for select to authenticated using (
  ((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin' or exists (
    select 1 from public.device_permissions dp
    where dp.user_id = (select auth.uid()) and dp.device_id = sensor_data.device_id
      and dp.sensor_index = sensor_data.sensor_index
  )
);

drop policy if exists sensor_names_select on public.sensor_names;
drop policy if exists sensor_names_insert on public.sensor_names;
drop policy if exists sensor_names_update on public.sensor_names;
create policy sensor_names_select on public.sensor_names for select to authenticated using (
  ((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin' or exists (
    select 1 from public.device_permissions dp
    where dp.user_id = (select auth.uid()) and dp.device_id = sensor_names.device_id
      and dp.sensor_index = sensor_names.sensor_index
  )
);
create policy sensor_names_insert on public.sensor_names for insert to authenticated
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');
create policy sensor_names_update on public.sensor_names for update to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin')
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists hvac_events_select on public.hvac_events;
create policy hvac_events_select on public.hvac_events for select to authenticated using (
  ((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin' or exists (
    select 1 from public.device_permissions dp
    where dp.user_id = (select auth.uid()) and dp.device_id = hvac_events.device_id
      and dp.sensor_index = hvac_events.sensor_index
  )
);

drop policy if exists alert_rules_select on public.alert_rules;
drop policy if exists alert_rules_delete on public.alert_rules;
drop policy if exists alert_rules_insert on public.alert_rules;
drop policy if exists alert_rules_update on public.alert_rules;
create policy alert_rules_select on public.alert_rules for select to authenticated
  using (user_id = (select auth.uid()));
create policy alert_rules_delete on public.alert_rules for delete to authenticated
  using (user_id = (select auth.uid()));
create policy alert_rules_insert on public.alert_rules for insert to authenticated with check (
  user_id = (select auth.uid()) and (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin' or exists (
    select 1 from public.device_permissions dp
    where dp.user_id = (select auth.uid()) and dp.device_id = alert_rules.device_id
      and dp.sensor_index = alert_rules.sensor_index
  ))
);
create policy alert_rules_update on public.alert_rules for update to authenticated
  using (user_id = (select auth.uid())) with check (
    user_id = (select auth.uid()) and (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin' or exists (
      select 1 from public.device_permissions dp
      where dp.user_id = (select auth.uid()) and dp.device_id = alert_rules.device_id
        and dp.sensor_index = alert_rules.sensor_index
    ))
  );

do $$
begin
  if to_regclass('public.device_names') is not null then
    drop policy if exists device_names_insert on public.device_names;
    drop policy if exists device_names_update on public.device_names;
    create policy device_names_insert on public.device_names for insert to authenticated
      with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');
    create policy device_names_update on public.device_names for update to authenticated
      using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin')
      with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');
  end if;
end $$;

-- 7. Every existing row already passes these checks, so enforce them on old rows too.
alter table public.alert_rules validate constraint alert_rules_threshold_required;
alter table public.alert_rules validate constraint alert_rules_threshold_order;
alter table public.alert_rules validate constraint alert_rules_threshold_finite;
alter table public.sensor_names validate constraint sensor_names_length;

commit;
