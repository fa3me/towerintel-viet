-- TowerIntel Vietnam — profiles + RLS (replace YOUR_OWNER_EMAIL with the same email as VITE_OWNER_EMAIL)

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  approved_view boolean not null default false,
  approved_download boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Users can read their own row
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

-- Users can insert their own profile (signup / upsert)
create policy "profiles_insert_own"
  on public.profiles for insert
  with check (auth.uid() = id);

-- No self-service updates to approval flags (only owner policies below).

-- Owner: replace email below before running
create policy "profiles_owner_select_all"
  on public.profiles for select
  using (lower(auth.jwt() ->> 'email') = lower('YOUR_OWNER_EMAIL'));

create policy "profiles_owner_update_all"
  on public.profiles for update
  using (lower(auth.jwt() ->> 'email') = lower('YOUR_OWNER_EMAIL'));

-- Optional: auto-create profile on signup (Supabase may already use a similar trigger)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, approved_view, approved_download)
  values (new.id, new.email, false, false)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
