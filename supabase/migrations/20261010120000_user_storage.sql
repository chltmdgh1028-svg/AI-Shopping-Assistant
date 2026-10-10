create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  profile jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.preferences (
  user_id uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  preferences jsonb not null,
  schema_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.analysis_history (
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  id text not null,
  result jsonb not null,
  analyzed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists analysis_history_user_analyzed_at_idx
  on public.analysis_history (user_id, analyzed_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists preferences_set_updated_at on public.preferences;
create trigger preferences_set_updated_at
before update on public.preferences
for each row execute function public.set_updated_at();

drop trigger if exists analysis_history_set_updated_at on public.analysis_history;
create trigger analysis_history_set_updated_at
before update on public.analysis_history
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.preferences enable row level security;
alter table public.analysis_history enable row level security;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
on public.profiles for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their own profile" on public.profiles;
create policy "Users can insert their own profile"
on public.profiles for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
on public.profiles for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own profile" on public.profiles;
create policy "Users can delete their own profile"
on public.profiles for delete
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can read their own preferences" on public.preferences;
create policy "Users can read their own preferences"
on public.preferences for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their own preferences" on public.preferences;
create policy "Users can insert their own preferences"
on public.preferences for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own preferences" on public.preferences;
create policy "Users can update their own preferences"
on public.preferences for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own preferences" on public.preferences;
create policy "Users can delete their own preferences"
on public.preferences for delete
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can read their own analysis history" on public.analysis_history;
create policy "Users can read their own analysis history"
on public.analysis_history for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their own analysis history" on public.analysis_history;
create policy "Users can insert their own analysis history"
on public.analysis_history for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own analysis history" on public.analysis_history;
create policy "Users can update their own analysis history"
on public.analysis_history for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own analysis history" on public.analysis_history;
create policy "Users can delete their own analysis history"
on public.analysis_history for delete
to authenticated
using ((select auth.uid()) = user_id);
