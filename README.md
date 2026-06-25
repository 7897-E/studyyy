# studyyy

A Next.js + Supabase Notion-style study workspace.

## What is included

- Next.js App Router with TypeScript and Tailwind
- Supabase magic-link authentication
- Automatic default workspace creation
- Supabase-backed pages
- Notion-like sidebar and page editor
- BlockNote editor with the built-in `/` menu for headings, lists, quotes, tables, files, and other Notion-like blocks
- OpenRouter key kept out of the browser through Supabase secrets
- SQL migration in `supabase/migrations/0001_initial_schema.sql`

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create a Supabase project.

3. Run the SQL script in Supabase SQL Editor:

```text
supabase/migrations/0001_initial_schema.sql
```

If you already created the database before classes existed, run at least:

```sql
alter table public.pages
add column if not exists class_name text not null default 'Unsorted';

create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, name)
);

alter table public.classes enable row level security;

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
```

4. Copy `.env.local.example` to `.env.local` and fill in:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your-key
```

5. Add the OpenRouter key as a Supabase Edge Function secret. This is the Supabase storage location for secrets; do not put this key in browser env vars or normal RLS tables.

```bash
supabase secrets set OPENROUTER_API_KEY=sk-or-your-key
```

Optional model override:

```bash
supabase secrets set OPENROUTER_MODEL=openrouter/owl-alpha
```

6. Deploy the function:

```bash
supabase functions deploy format-notes
```

7. Run the app:

```bash
npm run dev
```

Open `http://localhost:3000`.
