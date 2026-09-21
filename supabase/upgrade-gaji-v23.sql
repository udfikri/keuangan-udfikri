-- Jalankan sekali di Supabase SQL Editor sebelum memakai penggajian v23.
alter table public.salaries
  add column if not exists attendance_status text not null default 'hadir',
  add column if not exists allowance numeric(14,2) not null default 0,
  add column if not exists overtime numeric(14,2) not null default 0,
  add column if not exists deduction numeric(14,2) not null default 0,
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists updated_by uuid references auth.users(id);

alter table public.salary_withdrawals
  add column if not exists payment_method text not null default 'cash',
  add column if not exists reference_number text,
  add column if not exists created_by uuid references auth.users(id);

do $$ begin
  alter table public.salaries add constraint salaries_attendance_status_check
    check (attendance_status in ('hadir','setengah_hari','izin','sakit','libur_dibayar','libur_tidak_dibayar','alpa'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.salary_withdrawals add constraint salary_withdrawals_payment_method_check
    check (payment_method in ('cash','transfer','qris'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.salaries add constraint salaries_components_nonnegative
    check (allowance >= 0 and overtime >= 0 and deduction >= 0);
exception when duplicate_object then null; end $$;

-- Karyawan hanya membaca barisnya sendiri; admin/staff tetap mengikuti profil aktif.
drop policy if exists "authenticated_access" on public.salaries;
drop policy if exists "salary_role_access" on public.salaries;
create policy "salary_role_access" on public.salaries for all to authenticated
using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.active = true and
    (p.role in ('superadmin','admin','staff') or p.employee_id = salaries.employee_id))
)
with check (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.active = true and p.role in ('superadmin','admin','staff'))
);

drop policy if exists "authenticated_access" on public.salary_withdrawals;
drop policy if exists "withdrawal_role_access" on public.salary_withdrawals;
create policy "withdrawal_role_access" on public.salary_withdrawals for all to authenticated
using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.active = true and
    (p.role in ('superadmin','admin','staff') or p.employee_id = salary_withdrawals.employee_id))
)
with check (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.active = true and p.role in ('superadmin','admin','staff'))
);
