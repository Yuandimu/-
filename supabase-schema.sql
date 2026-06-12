create table if not exists public.department_app_state (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

alter table public.department_app_state enable row level security;

create policy "authenticated users can read shared state"
on public.department_app_state
for select
to authenticated
using (true);

create policy "authenticated users can create shared state"
on public.department_app_state
for insert
to authenticated
with check (auth.uid() = updated_by);

create policy "authenticated users can update shared state"
on public.department_app_state
for update
to authenticated
using (true)
with check (auth.uid() = updated_by);

alter publication supabase_realtime add table public.department_app_state;
