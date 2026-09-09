-- Jalankan seluruh file ini di Supabase SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.settings (
  id smallint primary key default 1 check (id = 1),
  store_name text not null default 'UD Fikri',
  active_date date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  daily_salary numeric(14,2) not null default 60000 check (daily_salary >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.sales_imports (
  id uuid primary key default gen_random_uuid(),
  report_date date not null unique,
  file_name text,
  product_sales numeric(14,2) not null default 0,
  source_total_sales numeric(14,2) not null default 0,
  shipping numeric(14,2) not null default 0,
  transactions numeric(14,2) not null default 0,
  items numeric(14,2) not null default 0,
  discount numeric(14,2) not null default 0,
  gross_profit numeric(14,2) not null default 0,
  capital numeric(14,2) not null default 0,
  imported_at timestamptz not null default now()
);

create table if not exists public.import_products (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.sales_imports(id) on delete cascade,
  report_date date not null,
  product text not null,
  sales numeric(14,2) not null default 0,
  transactions numeric(14,2) not null default 0,
  items numeric(14,2) not null default 0,
  discount numeric(14,2) not null default 0,
  profit numeric(14,2) not null default 0,
  capital numeric(14,2) not null default 0
);

create table if not exists public.salaries (
  id uuid primary key default gen_random_uuid(),
  salary_date date not null,
  employee_id uuid not null references public.employees(id),
  employee_name text not null,
  present boolean not null default true,
  base_salary numeric(14,2) not null default 0,
  bonus numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  notes text,
  updated_at timestamptz not null default now(),
  unique (salary_date, employee_id)
);

create table if not exists public.salary_withdrawals (
  id uuid primary key default gen_random_uuid(),
  withdrawal_date date not null,
  employee_id uuid not null references public.employees(id),
  employee_name text not null,
  amount numeric(14,2) not null check (amount > 0),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null,
  expense_type text not null default 'operational' check (expense_type in ('operational','employee')),
  employee_id uuid references public.employees(id),
  employee_name text,
  category text not null,
  description text,
  amount numeric(14,2) not null check (amount > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.allocation_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  rule_type text not null check (rule_type in ('fixed','percent')),
  value numeric(14,2) not null default 0 check (value >= 0),
  active boolean not null default true,
  sort_order integer not null default 99,
  created_at timestamptz not null default now()
);

create table if not exists public.daily_reports (
  id uuid primary key default gen_random_uuid(),
  report_date date not null unique,
  file_name text,
  product_sales numeric(14,2) not null default 0,
  capital numeric(14,2) not null default 0,
  gross_profit numeric(14,2) not null default 0,
  transactions numeric(14,2) not null default 0,
  items numeric(14,2) not null default 0,
  shipping numeric(14,2) not null default 0,
  salary numeric(14,2) not null default 0,
  expenses numeric(14,2) not null default 0,
  fixed_allocations numeric(14,2) not null default 0,
  profit_to_share numeric(14,2) not null default 0,
  percentage_allocations numeric(14,2) not null default 0,
  owner_result numeric(14,2) not null default 0,
  allocation_json jsonb not null default '[]'::jsonb,
  saved_at timestamptz not null default now()
);

create index if not exists idx_import_products_date on public.import_products(report_date);
create index if not exists idx_salaries_date on public.salaries(salary_date);
create index if not exists idx_salaries_employee on public.salaries(employee_id);
create index if not exists idx_withdrawals_employee on public.salary_withdrawals(employee_id);
create index if not exists idx_expenses_date on public.expenses(expense_date);

insert into public.settings (id, store_name, active_date)
values (1, 'UD Fikri', current_date)
on conflict (id) do nothing;

insert into public.employees (name, daily_salary)
select seed.name, seed.salary
from (values ('Heri', 60000::numeric), ('Alfi', 60000::numeric)) as seed(name, salary)
where not exists (select 1 from public.employees);

insert into public.allocation_rules (name, rule_type, value, sort_order)
select seed.name, seed.rule_type, seed.value, seed.sort_order
from (values
  ('Tabungan Toko', 'fixed', 150000::numeric, 1),
  ('Maintenance', 'fixed', 25000::numeric, 2),
  ('Dana Darurat', 'percent', 20::numeric, 3),
  ('Kas Operasional', 'percent', 30::numeric, 4),
  ('Keuntungan Pemilik', 'percent', 50::numeric, 5)
) as seed(name, rule_type, value, sort_order)
where not exists (select 1 from public.allocation_rules);

alter table public.settings enable row level security;
alter table public.employees enable row level security;
alter table public.sales_imports enable row level security;
alter table public.import_products enable row level security;
alter table public.salaries enable row level security;
alter table public.salary_withdrawals enable row level security;
alter table public.expenses enable row level security;
alter table public.allocation_rules enable row level security;
alter table public.daily_reports enable row level security;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'settings','employees','sales_imports','import_products','salaries',
    'salary_withdrawals','expenses','allocation_rules','daily_reports'
  ] loop
    execute format('drop policy if exists "authenticated_access" on public.%I', table_name);
    execute format(
      'create policy "authenticated_access" on public.%I for all to authenticated using (true) with check (true)',
      table_name
    );
  end loop;
end $$;
