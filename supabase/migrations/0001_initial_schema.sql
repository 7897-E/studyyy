create extension if not exists "pgcrypto";

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  parent_page_id uuid references public.pages(id) on delete cascade,
  title text not null default 'Untitled',
  class_name text not null default 'Unsorted',
  icon text,
  content jsonb not null default '{"blocks":[]}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.format_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete set null,
  page_id uuid references public.pages(id) on delete set null,
  input_length integer not null default 0,
  output_length integer not null default 0,
  model text not null,
  created_at timestamptz not null default now()
);

alter table public.pages
add column if not exists class_name text not null default 'Unsorted';

create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  color text not null default '#78716c',
  created_at timestamptz not null default now(),
  unique (workspace_id, name)
);

alter table public.classes
add column if not exists color text not null default '#78716c';

create table if not exists public.ai_provider_settings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null default 'openrouter',
  model text not null default 'openrouter/owl-alpha',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider)
);

create table if not exists public.admin_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_chat_threads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  title text not null default 'New chat',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.ai_chat_threads(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

insert into public.admin_users (email)
values ('reyeemia1@gmail.com')
on conflict (email) do nothing;

insert into public.admin_settings (key, value)
values ('chat_model', '{"provider":"openrouter","model":"openrouter/owl-alpha"}'::jsonb)
on conflict (key) do nothing;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_workspaces_updated_at on public.workspaces;
create trigger set_workspaces_updated_at
before update on public.workspaces
for each row execute function public.set_updated_at();

drop trigger if exists set_pages_updated_at on public.pages;
create trigger set_pages_updated_at
before update on public.pages
for each row execute function public.set_updated_at();

drop trigger if exists set_ai_provider_settings_updated_at on public.ai_provider_settings;
create trigger set_ai_provider_settings_updated_at
before update on public.ai_provider_settings
for each row execute function public.set_updated_at();

alter table public.workspaces enable row level security;
alter table public.pages enable row level security;
alter table public.classes enable row level security;
alter table public.format_requests enable row level security;
alter table public.ai_provider_settings enable row level security;
alter table public.admin_users enable row level security;

drop policy if exists "Owners can manage workspaces" on public.workspaces;
create policy "Owners can manage workspaces"
on public.workspaces for all
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists "Owners can manage pages" on public.pages;
create policy "Owners can manage pages"
on public.pages for all
using (
  workspace_id in (
    select id from public.workspaces where owner_id = auth.uid()
  )
)
with check (
  workspace_id in (
    select id from public.workspaces where owner_id = auth.uid()
  )
);

drop policy if exists "Owners can manage classes" on public.classes;
create policy "Owners can manage classes"
on public.classes for all
using (
  workspace_id in (
    select id from public.workspaces where owner_id = auth.uid()
  )
)
with check (
  workspace_id in (
    select id from public.workspaces where owner_id = auth.uid()
  )
);

drop policy if exists "Owners can view format request logs" on public.format_requests;
create policy "Owners can view format request logs"
on public.format_requests for select
using (
  workspace_id in (
    select id from public.workspaces where owner_id = auth.uid()
  )
);

drop policy if exists "Owners can manage ai provider settings" on public.ai_provider_settings;
create policy "Owners can manage ai provider settings"
on public.ai_provider_settings for all
using (
  workspace_id in (
    select id from public.workspaces where owner_id = auth.uid()
  )
)
with check (
  workspace_id in (
    select id from public.workspaces where owner_id = auth.uid()
  )
);

-- Edge functions can write logs with the service role key. Browser clients should not insert logs directly.
-- Store OPENROUTER_API_KEY in Supabase Edge Function secrets, not in a public/RLS table:
-- supabase secrets set OPENROUTER_API_KEY=sk-or-your-key
-- Optional model override:
-- supabase secrets set OPENROUTER_MODEL=openrouter/owl-alpha

do $$
begin
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pages'
  ) then
    alter publication supabase_realtime add table public.pages;
  end if;

  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'workspaces'
  ) then
    alter publication supabase_realtime add table public.workspaces;
  end if;

  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'classes'
  ) then
    alter publication supabase_realtime add table public.classes;
  end if;
end $$;
