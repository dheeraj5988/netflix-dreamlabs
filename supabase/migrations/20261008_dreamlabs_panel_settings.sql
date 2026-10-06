-- Dream Labs Solutions: settings managed from the admin panel
--
-- Run AFTER 20261006_dreamlabs_v1.sql and 20261007_dreamlabs_payments.sql.
-- Safe to run more than once. It only adds dl_* objects, so it does not touch
-- tetra-household.
--
-- * dl_mailboxes: the Gmail inboxes (address + Google app password) that were
--   GMAIL_USER_n / GMAIL_APP_PASSWORD_n in Vercel. Added and removed from
--   Admin > Settings > Gmail Inboxes. The app password is write-only in the
--   admin panel (never shown again) and, if SETTINGS_ENCRYPTION_KEY is set in
--   Vercel, stored encrypted.
-- * dl_settings: the site URL, how far back to look for the Netflix email and
--   the plan list (labels, durations, prices) move here too.
-- * dl_orders keeps the plan duration so Activate can work out the expiry even
--   after a plan is renamed or removed.

-- Same Gmail-inbox identity as lib/emails.ts mailboxKey(): dots and +tag are ignored for Gmail.
create or replace function dl_private.mailbox_key(p text) returns text
language plpgsql immutable as $$
declare
  e   text := lower(btrim(coalesce(p, '')));
  loc text;
  dom text;
begin
  if e = '' then return null; end if;
  if position('@' in e) = 0 then return e; end if;
  loc := split_part(e, '@', 1);
  dom := split_part(e, '@', 2);
  if dom in ('gmail.com', 'googlemail.com') then
    return replace(split_part(loc, '+', 1), '.', '') || '@gmail.com';
  end if;
  return loc || '@' || dom;
end $$;

revoke all on function dl_private.mailbox_key(text) from public, anon, authenticated;
grant execute on function dl_private.mailbox_key(text) to service_role;

create table if not exists public.dl_mailboxes (
  id                text primary key default ('dl-mbx-' || gen_random_uuid()),
  gmail_user        text not null check (gmail_user ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  app_password      text not null,
  label             text not null default '',
  last_test_at      timestamptz,
  last_test_ok      boolean,
  last_test_message text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
comment on table public.dl_mailboxes is 'dreamlabs-v1';
create unique index if not exists dl_mailboxes_key_uniq on public.dl_mailboxes (dl_private.mailbox_key(gmail_user));

drop trigger if exists touch_updated_at on public.dl_mailboxes;
create trigger touch_updated_at before update on public.dl_mailboxes
  for each row execute function dl_private.touch_updated_at();

alter table public.dl_mailboxes enable row level security;
revoke all on public.dl_mailboxes from public, anon, authenticated;
grant all on public.dl_mailboxes to service_role;

alter table public.dl_settings
  add column if not exists site_url text;
alter table public.dl_settings
  add column if not exists household_lookback_minutes integer not null default 30
  check (household_lookback_minutes between 5 and 120);
alter table public.dl_settings
  add column if not exists plans jsonb not null default
  '[{"id":"3m","label":"3 Months","months":3,"price":449,"enabled":true},{"id":"6m","label":"6 Months","months":6,"price":798,"enabled":true},{"id":"12m","label":"1 Year","months":12,"price":1498,"enabled":true}]'::jsonb
  check (jsonb_typeof(plans) = 'array');

alter table public.dl_orders add column if not exists plan_months integer;
update public.dl_orders
   set plan_months = case plan_id when '3m' then 3 when '6m' then 6 when '12m' then 12 end
 where plan_months is null;

-- Final check: dl_mailboxes must show rls_enabled = true and anon_access = false.
select c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       has_table_privilege('anon', c.oid, 'select') as anon_access,
       (select count(*) from information_schema.columns
         where table_schema = 'public' and table_name = 'dl_settings'
           and column_name in ('site_url', 'household_lookback_minutes', 'plans')) as settings_new_columns
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'dl_mailboxes';
