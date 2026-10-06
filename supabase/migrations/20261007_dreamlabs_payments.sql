-- Dream Labs Solutions: online purchase (PayPur) schema
--
-- Run AFTER 20261006_dreamlabs_v1.sql. Safe to run more than once, and it only
-- adds dl_* objects, so it does not touch tetra-household.
--
-- * dl_settings gets the PayPur Gateway Key / Salt, which the admin console
--   saves from Settings. They are readable only with the service role (RLS is
--   on, anon/authenticated have no access) and the admin console only ever
--   shows the last 4 characters of the key and never the salt.
-- * dl_orders records every purchase attempt: who, which plan, the amount, the
--   PayPur transaction and whether it was paid.

alter table public.dl_settings add column if not exists paypur_key  text;
alter table public.dl_settings add column if not exists paypur_salt text;

create table if not exists public.dl_orders (
  order_id       text primary key,
  mobile         text not null check (mobile ~ '^[0-9]{10}$'),
  customer_name  text not null default '',
  customer_email text not null default '',
  plan_id        text not null,
  plan_label     text not null,
  amount         numeric(10, 2) not null check (amount > 0),
  status         text not null default 'created'
                 check (status in ('created', 'pending', 'paid', 'failed')),
  txn_id         text,
  gateway_status text,
  notes          text,
  ip             text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  paid_at        timestamptz
);
comment on table public.dl_orders is 'dreamlabs-v1';
create index if not exists dl_orders_created_idx on public.dl_orders (created_at desc);
create index if not exists dl_orders_mobile_idx on public.dl_orders (mobile, created_at desc);
create index if not exists dl_orders_txn_idx on public.dl_orders (txn_id);
-- One PayPur transaction can only ever pay one order (stops a single payment being replayed on several orders).
create unique index if not exists dl_orders_paid_txn_uniq on public.dl_orders (txn_id)
  where status = 'paid' and txn_id is not null;

drop trigger if exists touch_updated_at on public.dl_orders;
create trigger touch_updated_at before update on public.dl_orders
  for each row execute function dl_private.touch_updated_at();

alter table public.dl_orders enable row level security;
revoke all on public.dl_orders from public, anon, authenticated;
grant all on public.dl_orders to service_role;

-- Final check: dl_orders must show rls_enabled = true and anon_access = false.
select c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       has_table_privilege('anon', c.oid, 'select') as anon_access,
       (select count(*) from information_schema.columns
         where table_schema = 'public' and table_name = 'dl_settings' and column_name in ('paypur_key', 'paypur_salt')) as settings_paypur_columns
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'dl_orders';
