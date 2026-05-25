create extension if not exists pgcrypto;

create or replace function public.worker_secret_valid()
returns boolean
language plpgsql
stable
set search_path = public
as $$
declare
  request_headers jsonb;
begin
  begin
    request_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    return false;
  end;

  return encode(extensions.digest(coalesce(request_headers ->> 'x-worker-secret', ''), 'sha256'), 'hex')
    = '3b12833bc02203d4611e9768ebecb0814c2c07813b00c54f81a4d3e0fb981d9e';
end;
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role text not null default 'user' check (role in ('user', 'admin')),
  plan text not null default 'free',
  quota_bytes bigint not null default 104857600,
  used_bytes bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  banned_at timestamptz
);

create table if not exists public.shares (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  owner_user_id uuid references public.profiles(id) on delete set null,
  share_type text not null default 'single_html' check (share_type in ('single_html', 'static_site')),
  title text,
  description text,
  entry_path text not null default 'index.html',
  r2_prefix text not null,
  size_bytes bigint not null default 0,
  content_hash text not null,
  visibility text not null default 'public_unlisted' check (visibility in ('public_unlisted')),
  lifecycle_status text not null default 'uploading' check (lifecycle_status in ('uploading', 'scanning', 'active', 'needs_review', 'blocked', 'deleted', 'failed')),
  moderation_status text not null default 'pending' check (moderation_status in ('pending', 'clean', 'suspicious', 'blocked')),
  risk_score integer not null default 0 check (risk_score >= 0 and risk_score <= 100),
  risk_reasons jsonb not null default '[]'::jsonb,
  claim_token_hash text,
  creator_ip_hash text,
  creator_user_agent_hash text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.share_assets (
  id uuid primary key default gen_random_uuid(),
  share_id uuid not null references public.shares(id) on delete cascade,
  path text not null,
  r2_key text not null,
  content_type text not null,
  size_bytes bigint not null,
  content_hash text not null,
  created_at timestamptz not null default now(),
  unique (share_id, path)
);

create table if not exists public.share_events (
  id uuid primary key default gen_random_uuid(),
  share_id uuid references public.shares(id) on delete cascade,
  actor_user_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  ip_hash text,
  user_agent_hash text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  share_id uuid not null references public.shares(id) on delete cascade,
  reporter_user_id uuid references public.profiles(id) on delete set null,
  reason text not null,
  details text,
  status text not null default 'open' check (status in ('open', 'reviewed', 'dismissed', 'actioned')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shares_owner_created_idx on public.shares(owner_user_id, created_at desc);
create index if not exists shares_expires_idx on public.shares(expires_at) where deleted_at is null;
create index if not exists shares_moderation_idx on public.shares(moderation_status, risk_score desc);
create index if not exists shares_creator_ip_created_idx on public.shares(creator_ip_hash, created_at desc);
create index if not exists share_events_share_created_idx on public.share_events(share_id, created_at desc);
create index if not exists reports_open_idx on public.reports(status, created_at desc);

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists shares_updated_at on public.shares;
create trigger shares_updated_at
before update on public.shares
for each row execute function public.set_updated_at();

drop trigger if exists reports_updated_at on public.reports;
create trigger reports_updated_at
before update on public.reports
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

revoke execute on function public.handle_new_user() from public;
revoke execute on function public.handle_new_user() from anon;
revoke execute on function public.handle_new_user() from authenticated;

alter table public.profiles enable row level security;
alter table public.shares enable row level security;
alter table public.share_assets enable row level security;
alter table public.share_events enable row level security;
alter table public.reports enable row level security;

drop policy if exists "profiles_worker_all" on public.profiles;
create policy "profiles_worker_all"
on public.profiles for all
to anon, authenticated
using (public.worker_secret_valid())
with check (public.worker_secret_valid());

drop policy if exists "shares_worker_all" on public.shares;
create policy "shares_worker_all"
on public.shares for all
to anon, authenticated
using (public.worker_secret_valid())
with check (public.worker_secret_valid());

drop policy if exists "share_assets_worker_all" on public.share_assets;
create policy "share_assets_worker_all"
on public.share_assets for all
to anon, authenticated
using (public.worker_secret_valid())
with check (public.worker_secret_valid());

drop policy if exists "share_events_worker_all" on public.share_events;
create policy "share_events_worker_all"
on public.share_events for all
to anon, authenticated
using (public.worker_secret_valid())
with check (public.worker_secret_valid());

drop policy if exists "reports_worker_all" on public.reports;
create policy "reports_worker_all"
on public.reports for all
to anon, authenticated
using (public.worker_secret_valid())
with check (public.worker_secret_valid());

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles for select
to authenticated
using (id = auth.uid());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "shares_select_own" on public.shares;
create policy "shares_select_own"
on public.shares for select
to authenticated
using (owner_user_id = auth.uid());

drop policy if exists "share_assets_select_owned_share" on public.share_assets;
create policy "share_assets_select_owned_share"
on public.share_assets for select
to authenticated
using (
  exists (
    select 1 from public.shares
    where shares.id = share_assets.share_id
      and shares.owner_user_id = auth.uid()
  )
);

drop policy if exists "reports_select_admin" on public.reports;
create policy "reports_select_admin"
on public.reports for select
to authenticated
using (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'admin'
  )
);

drop policy if exists "share_events_select_admin" on public.share_events;
create policy "share_events_select_admin"
on public.share_events for select
to authenticated
using (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'admin'
  )
);
