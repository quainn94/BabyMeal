-- BabyMeal v0.3 cloud schema
-- Supabase Dashboard > SQL Editor > New query 에 전체 붙여넣고 Run 하세요.

create extension if not exists pgcrypto;

create table if not exists public.ingredients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 100),
  category text not null default '기타',
  storage_place text not null default '냉장'
    check (storage_place in ('상온','냉장','냉동')),
  quantity numeric(10,2) not null default 1 check (quantity >= 0),
  unit text not null default '개' check (char_length(unit) between 1 and 20),
  expiry_date date,
  depleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.menus (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  ingredients_text text not null default '',
  reaction text not null default '반응 미기록',
  memo text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.meal_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  meal_date date not null,
  meal_slot text not null check (meal_slot in ('아침','점심','간식','저녁')),
  menu_name text not null check (char_length(trim(menu_name)) between 1 and 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shopping_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  done boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists ingredients_set_updated_at on public.ingredients;
create trigger ingredients_set_updated_at before update on public.ingredients
for each row execute function public.set_updated_at();

drop trigger if exists menus_set_updated_at on public.menus;
create trigger menus_set_updated_at before update on public.menus
for each row execute function public.set_updated_at();

drop trigger if exists meal_plans_set_updated_at on public.meal_plans;
create trigger meal_plans_set_updated_at before update on public.meal_plans
for each row execute function public.set_updated_at();

drop trigger if exists shopping_items_set_updated_at on public.shopping_items;
create trigger shopping_items_set_updated_at before update on public.shopping_items
for each row execute function public.set_updated_at();

alter table public.ingredients enable row level security;
alter table public.menus enable row level security;
alter table public.meal_plans enable row level security;
alter table public.shopping_items enable row level security;

drop policy if exists "ingredients_select_own" on public.ingredients;
drop policy if exists "ingredients_insert_own" on public.ingredients;
drop policy if exists "ingredients_update_own" on public.ingredients;
drop policy if exists "ingredients_delete_own" on public.ingredients;
create policy "ingredients_select_own" on public.ingredients
for select to authenticated using ((select auth.uid()) = user_id);
create policy "ingredients_insert_own" on public.ingredients
for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "ingredients_update_own" on public.ingredients
for update to authenticated using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy "ingredients_delete_own" on public.ingredients
for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "menus_select_own" on public.menus;
drop policy if exists "menus_insert_own" on public.menus;
drop policy if exists "menus_update_own" on public.menus;
drop policy if exists "menus_delete_own" on public.menus;
create policy "menus_select_own" on public.menus
for select to authenticated using ((select auth.uid()) = user_id);
create policy "menus_insert_own" on public.menus
for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "menus_update_own" on public.menus
for update to authenticated using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy "menus_delete_own" on public.menus
for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "plans_select_own" on public.meal_plans;
drop policy if exists "plans_insert_own" on public.meal_plans;
drop policy if exists "plans_update_own" on public.meal_plans;
drop policy if exists "plans_delete_own" on public.meal_plans;
create policy "plans_select_own" on public.meal_plans
for select to authenticated using ((select auth.uid()) = user_id);
create policy "plans_insert_own" on public.meal_plans
for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "plans_update_own" on public.meal_plans
for update to authenticated using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy "plans_delete_own" on public.meal_plans
for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "shopping_select_own" on public.shopping_items;
drop policy if exists "shopping_insert_own" on public.shopping_items;
drop policy if exists "shopping_update_own" on public.shopping_items;
drop policy if exists "shopping_delete_own" on public.shopping_items;
create policy "shopping_select_own" on public.shopping_items
for select to authenticated using ((select auth.uid()) = user_id);
create policy "shopping_insert_own" on public.shopping_items
for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "shopping_update_own" on public.shopping_items
for update to authenticated using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy "shopping_delete_own" on public.shopping_items
for delete to authenticated using ((select auth.uid()) = user_id);

create index if not exists ingredients_user_id_idx on public.ingredients(user_id);
create index if not exists menus_user_id_idx on public.menus(user_id);
create index if not exists meal_plans_user_date_idx on public.meal_plans(user_id, meal_date);
create index if not exists shopping_user_id_idx on public.shopping_items(user_id);

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.ingredients to authenticated;
grant select, insert, update, delete on public.menus to authenticated;
grant select, insert, update, delete on public.meal_plans to authenticated;
grant select, insert, update, delete on public.shopping_items to authenticated;

-- Postgres Changes 기반 간단한 실시간 동기화
do $$
begin
  alter publication supabase_realtime add table public.ingredients;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.menus;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.meal_plans;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.shopping_items;
exception when duplicate_object then null;
end $$;
