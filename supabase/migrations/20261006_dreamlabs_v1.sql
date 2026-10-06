-- Dream Labs Solutions: storage schema v1
--
-- Safe to run more than once. Run the whole file in the Supabase SQL Editor.
--
-- This app can share a Supabase project with tetra-household. Everything it
-- creates is prefixed dl_ (tables dl_subscribers, dl_accounts, dl_activations,
-- dl_settings; function dl_record_tv_login; schema dl_private). Nothing that
-- belongs to tetra-household (activations, app_settings, cookie_pool,
-- subscribers, tetra_*) is read, changed or moved by this file.
--
-- * RLS is enabled on every table with NO policies, and anon/authenticated
--   lose all privileges, so only the service role (server side) can read or
--   write.
-- * No passwords are stored in the database. The admin password and the Gmail
--   app passwords live in Vercel environment variables.

create schema if not exists dl_private;
revoke all on schema dl_private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers (private schema: not exposed through the Supabase API)
-- ---------------------------------------------------------------------------

-- 10-digit Indian mobile: strips non-digits, a leading 91 (12 digits) or 0 (11 digits).
create or replace function dl_private.norm_mobile(p text) returns text
language sql immutable as $$
  select case
    when d ~ '^[0-9]{10}$' then d
    when d ~ '^91[0-9]{10}$' then right(d, 10)
    when d ~ '^0[0-9]{10}$' then right(d, 10)
    else null
  end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x
$$;

-- Identity of the exact address Netflix writes to. Gmail ignores dots in the
-- name part, so dots are dropped; the +tag is kept because Netflix treats
-- name+4@gmail.com and name+5@gmail.com as different accounts.
-- (lib/emails.ts aliasKey() must stay in sync with this.)
create or replace function dl_private.email_key(p text) returns text
language plpgsql immutable as $$
declare
  e   text := lower(btrim(coalesce(p, '')));
  loc text;
  dom text;
  base text;
  tag  text;
begin
  if e = '' then return null; end if;
  if position('@' in e) = 0 then return e; end if;
  loc := split_part(e, '@', 1);
  dom := split_part(e, '@', 2);
  if dom in ('gmail.com', 'googlemail.com') then
    base := split_part(loc, '+', 1);
    tag  := case when position('+' in loc) > 0 then substr(loc, position('+' in loc)) else '' end;
    return replace(base, '.', '') || tag || '@gmail.com';
  end if;
  return loc || '@' || dom;
end $$;

create or replace function dl_private.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- Netflix accounts whose browser cookies are used to sign TVs in. An account is
-- matched to customers by its account_email (the customer's Netflix ID).
create table if not exists public.dl_accounts (
  id                   text primary key default ('dl-acc-' || gen_random_uuid()),
  profile_name         text not null default 'Netflix Account',
  account_label        text,
  account_email        text,
  user_agent           text not null default '',
  device_metadata      jsonb not null default '{}'::jsonb,
  cookies              jsonb not null default '[]'::jsonb check (jsonb_typeof(cookies) = 'array'),
  status               text not null default 'unknown'
                       check (status in ('live', 'expiring_soon', 'expired', 'needs_reimport', 'unverified', 'unknown')),
  earliest_expiry      timestamptz,
  last_checked_at      timestamptz,
  last_refreshed_at    timestamptz,
  last_result          text,
  last_detail          text not null default '',
  consecutive_failures integer not null default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
comment on table public.dl_accounts is 'dreamlabs-v1';
create index if not exists dl_accounts_email_key_idx on public.dl_accounts (dl_private.email_key(account_email));

-- One row per customer mobile number. netflix_email is the customer's Netflix
-- ID: it decides which Gmail inbox the household link is read from and which
-- dl_accounts row signs their TV in.
create table if not exists public.dl_subscribers (
  id                text primary key default ('dl-sub-' || gen_random_uuid()),
  mobile            text not null unique check (mobile ~ '^[0-9]{10}$'),
  netflix_email     text not null check (netflix_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  expiry_date       date,
  is_blocked        boolean not null default false,
  tv_quota_reset_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
comment on table public.dl_subscribers is 'dreamlabs-v1';
create index if not exists dl_subscribers_email_key_idx on public.dl_subscribers (dl_private.email_key(netflix_email));

create table if not exists public.dl_activations (
  id            bigint generated always as identity primary key,
  subscriber_id text references public.dl_subscribers (id) on delete set null,
  mobile        text not null,
  netflix_email text,
  action        text not null check (action in ('tv_login', 'household_update')),
  code          text,
  ip            text,
  status        text not null check (status in ('success', 'failed', 'rate_limited', 'blocked')),
  account_id    text references public.dl_accounts (id) on delete set null,
  notes         text,
  created_at    timestamptz not null default now()
);
comment on table public.dl_activations is 'dreamlabs-v1';
create index if not exists dl_activations_created_idx on public.dl_activations (created_at desc);
create index if not exists dl_activations_subscriber_idx on public.dl_activations (subscriber_id, action, created_at desc);
create index if not exists dl_activations_mobile_idx on public.dl_activations (mobile, created_at desc);

create table if not exists public.dl_settings (
  id                      text primary key default 'default' check (id = 'default'),
  company_name            text not null default 'Dream Labs Solutions',
  support_whatsapp        text not null default '919991483279',
  max_tv_logins_per_month integer not null default 2 check (max_tv_logins_per_month >= 1),
  log_retention_days      integer not null default 180 check (log_retention_days >= 31),
  updated_at              timestamptz not null default now()
);
comment on table public.dl_settings is 'dreamlabs-v1';
insert into public.dl_settings (id) values ('default') on conflict (id) do nothing;

drop trigger if exists touch_updated_at on public.dl_accounts;
create trigger touch_updated_at before update on public.dl_accounts
  for each row execute function dl_private.touch_updated_at();
drop trigger if exists touch_updated_at on public.dl_subscribers;
create trigger touch_updated_at before update on public.dl_subscribers
  for each row execute function dl_private.touch_updated_at();
drop trigger if exists touch_updated_at on public.dl_settings;
create trigger touch_updated_at before update on public.dl_settings
  for each row execute function dl_private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- TV login: atomic eligibility check + monthly limit + account lookup by the
-- customer's Netflix ID + activation log, in one transaction with the
-- subscriber row locked, so concurrent requests cannot exceed the limit.
-- Months are calendar months in India time (Asia/Kolkata).
-- ---------------------------------------------------------------------------

create or replace function public.dl_record_tv_login(p_mobile text, p_code text, p_ip text)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  s            public.dl_subscribers%rowtype;
  acc          public.dl_accounts%rowtype;
  v_max        integer;
  v_used       integer;
  v_today      date := (now() at time zone 'Asia/Kolkata')::date;
  v_month_from timestamptz := date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
begin
  select max_tv_logins_per_month into v_max from public.dl_settings where id = 'default';
  v_max := coalesce(v_max, 2);

  select * into s from public.dl_subscribers where mobile = p_mobile for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found', 'used', 0, 'max', v_max);
  end if;

  if s.is_blocked then
    insert into public.dl_activations (subscriber_id, mobile, netflix_email, action, code, ip, status, notes)
    values (s.id, s.mobile, s.netflix_email, 'tv_login', p_code, p_ip, 'blocked', 'Customer is blocked');
    return jsonb_build_object('ok', false, 'reason', 'blocked', 'used', 0, 'max', v_max);
  end if;

  if s.expiry_date is not null and s.expiry_date < v_today then
    insert into public.dl_activations (subscriber_id, mobile, netflix_email, action, code, ip, status, notes)
    values (s.id, s.mobile, s.netflix_email, 'tv_login', p_code, p_ip, 'failed', 'Subscription expired');
    return jsonb_build_object('ok', false, 'reason', 'expired', 'used', 0, 'max', v_max,
                              'expiry_date', s.expiry_date);
  end if;

  select count(*) into v_used from public.dl_activations
   where subscriber_id = s.id and action = 'tv_login' and status = 'success'
     and created_at >= greatest(v_month_from, coalesce(s.tv_quota_reset_at, v_month_from));

  if v_used >= v_max then
    insert into public.dl_activations (subscriber_id, mobile, netflix_email, action, code, ip, status, notes)
    values (s.id, s.mobile, s.netflix_email, 'tv_login', p_code, p_ip, 'rate_limited', 'Monthly TV login limit reached');
    return jsonb_build_object('ok', false, 'reason', 'monthly_limit', 'used', v_used, 'max', v_max);
  end if;

  -- The customer's account is fixed: the vault entry whose email is their Netflix ID.
  select * into acc from public.dl_accounts
   where dl_private.email_key(account_email) = dl_private.email_key(s.netflix_email)
   order by case when status in ('live', 'expiring_soon') then 0
                 when status in ('unverified', 'unknown') then 1
                 else 2 end,
            updated_at desc
   limit 1;
  if not found then
    insert into public.dl_activations (subscriber_id, mobile, netflix_email, action, code, ip, status, notes)
    values (s.id, s.mobile, s.netflix_email, 'tv_login', p_code, p_ip, 'failed', 'No cookies in the vault for this Netflix ID');
    return jsonb_build_object('ok', false, 'reason', 'no_account', 'used', v_used, 'max', v_max);
  end if;

  if acc.status in ('expired', 'needs_reimport') then
    insert into public.dl_activations (subscriber_id, mobile, netflix_email, action, code, ip, status, account_id, notes)
    values (s.id, s.mobile, s.netflix_email, 'tv_login', p_code, p_ip, 'failed', acc.id, 'Linked account needs fresh cookies');
    return jsonb_build_object('ok', false, 'reason', 'account_unavailable', 'used', v_used, 'max', v_max);
  end if;

  insert into public.dl_activations (subscriber_id, mobile, netflix_email, action, code, ip, status, account_id)
  values (s.id, s.mobile, s.netflix_email, 'tv_login', p_code, p_ip, 'success', acc.id);

  return jsonb_build_object(
    'ok', true,
    'used', v_used + 1,
    'max', v_max,
    'account_id', acc.id,
    'account_label', coalesce(acc.account_label, acc.profile_name),
    'account_email', acc.account_email
  );
end $$;

-- ---------------------------------------------------------------------------
-- Lock down: RLS on, no policies, no anon/authenticated access.
-- ---------------------------------------------------------------------------

alter table public.dl_accounts    enable row level security;
alter table public.dl_subscribers enable row level security;
alter table public.dl_activations enable row level security;
alter table public.dl_settings    enable row level security;

revoke all on public.dl_accounts, public.dl_subscribers, public.dl_activations, public.dl_settings
  from public, anon, authenticated;
grant all on public.dl_accounts, public.dl_subscribers, public.dl_activations, public.dl_settings
  to service_role;
grant usage, select on sequence public.dl_activations_id_seq to service_role;

revoke all on function public.dl_record_tv_login(text, text, text) from public, anon, authenticated;
grant execute on function public.dl_record_tv_login(text, text, text) to service_role;

revoke all on all functions in schema dl_private from public, anon, authenticated;
grant usage on schema dl_private to service_role;
grant execute on all functions in schema dl_private to service_role;

-- Final check: every row returned should show rls_enabled = true and anon_access = false.
select c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       has_table_privilege('anon', c.oid, 'select') as anon_access,
       (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('dl_accounts', 'dl_subscribers', 'dl_activations', 'dl_settings')
order by 1;
