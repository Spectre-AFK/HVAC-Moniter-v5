-- Applied directly in Supabase on 2026-11-16; recorded here so the repo matches production.
-- Lets the public portfolio site read the "Computer Room" probe (device E5B4, sensor 0) only.
-- Signed-out visitors cannot see any other sensor.
drop policy if exists "Public read" on public.sensor_data;
drop policy if exists "Public read portfolio sensor" on public.sensor_data;
create policy "Public read portfolio sensor" on public.sensor_data
  for select to anon
  using (device_id = '20E7C8ECE5B4' and sensor_index = 0);
grant select on public.sensor_data to anon;
