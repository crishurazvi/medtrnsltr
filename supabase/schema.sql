-- MedTranslate Studio — schema Supabase
-- Rulează întregul fișier în Supabase Dashboard > SQL Editor.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  source_filename text,
  source_pdf_path text,
  page_count integer check (page_count is null or page_count > 0),
  chunk_size integer not null default 2500 check (chunk_size between 500 and 12000),
  system_prompt text not null default '',
  status text not null default 'pending' check (status in ('pending', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chunks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  position integer not null check (position >= 0),
  page_start integer,
  page_end integer,
  source_text text not null,
  translated_text text not null default '',
  status text not null default 'pending' check (status in ('pending', 'draft', 'approved')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chunks_project_position_unique unique (project_id, position),
  constraint chunks_valid_pages check (
    (page_start is null and page_end is null)
    or (page_start > 0 and page_end >= page_start)
  )
);

create table if not exists public.glossary (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  source_term text not null check (char_length(source_term) between 1 and 300),
  preferred_translation text not null check (char_length(preferred_translation) between 1 and 500),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint glossary_user_source_unique unique (user_id, source_term)
);

create index if not exists projects_user_updated_idx
  on public.projects(user_id, updated_at desc);
create index if not exists chunks_project_position_idx
  on public.chunks(project_id, position);
create index if not exists chunks_user_status_idx
  on public.chunks(user_id, status);
create index if not exists glossary_user_source_idx
  on public.glossary(user_id, source_term);

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
before update on public.projects
for each row execute function public.set_updated_at();

drop trigger if exists chunks_set_updated_at on public.chunks;
create trigger chunks_set_updated_at
before update on public.chunks
for each row execute function public.set_updated_at();

drop trigger if exists glossary_set_updated_at on public.glossary;
create trigger glossary_set_updated_at
before update on public.glossary
for each row execute function public.set_updated_at();

-- Actualizează data proiectului când un segment se schimbă.
create or replace function public.touch_parent_project()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  target_project_id uuid;
begin
  if tg_op = 'DELETE' then
    target_project_id := old.project_id;
  else
    target_project_id := new.project_id;
  end if;

  update public.projects
  set updated_at = now()
  where id = target_project_id
    and user_id = auth.uid();

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists chunks_touch_project on public.chunks;
create trigger chunks_touch_project
after insert or update or delete on public.chunks
for each row execute function public.touch_parent_project();

-- Row Level Security
alter table public.projects enable row level security;
alter table public.chunks enable row level security;
alter table public.glossary enable row level security;

-- Proiecte
drop policy if exists "projects_select_own" on public.projects;
create policy "projects_select_own"
on public.projects for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "projects_insert_own" on public.projects;
create policy "projects_insert_own"
on public.projects for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "projects_update_own" on public.projects;
create policy "projects_update_own"
on public.projects for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "projects_delete_own" on public.projects;
create policy "projects_delete_own"
on public.projects for delete
to authenticated
using (auth.uid() = user_id);

-- Segmente
drop policy if exists "chunks_select_own" on public.chunks;
create policy "chunks_select_own"
on public.chunks for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "chunks_insert_own" on public.chunks;
create policy "chunks_insert_own"
on public.chunks for insert
to authenticated
with check (
  auth.uid() = user_id
  and exists (
    select 1 from public.projects p
    where p.id = project_id and p.user_id = auth.uid()
  )
);

drop policy if exists "chunks_update_own" on public.chunks;
create policy "chunks_update_own"
on public.chunks for update
to authenticated
using (auth.uid() = user_id)
with check (
  auth.uid() = user_id
  and exists (
    select 1 from public.projects p
    where p.id = project_id and p.user_id = auth.uid()
  )
);

drop policy if exists "chunks_delete_own" on public.chunks;
create policy "chunks_delete_own"
on public.chunks for delete
to authenticated
using (auth.uid() = user_id);

-- Glosar
drop policy if exists "glossary_select_own" on public.glossary;
create policy "glossary_select_own"
on public.glossary for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "glossary_insert_own" on public.glossary;
create policy "glossary_insert_own"
on public.glossary for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "glossary_update_own" on public.glossary;
create policy "glossary_update_own"
on public.glossary for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "glossary_delete_own" on public.glossary;
create policy "glossary_delete_own"
on public.glossary for delete
to authenticated
using (auth.uid() = user_id);

-- Privilegii minime pentru Data API.
revoke all on table public.projects from anon;
revoke all on table public.chunks from anon;
revoke all on table public.glossary from anon;

grant select, insert, update, delete on table public.projects to authenticated;
grant select, insert, update, delete on table public.chunks to authenticated;
grant select, insert, update, delete on table public.glossary to authenticated;

-- Bucket privat opțional pentru PDF-urile originale.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('source-pdfs', 'source-pdfs', false, 104857600, array['application/pdf'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Politicile Storage folosesc primul folder drept user_id:
-- user-id/project-id/nume-fisier.pdf

drop policy if exists "source_pdfs_select_own" on storage.objects;
create policy "source_pdfs_select_own"
on storage.objects for select
to authenticated
using (
  bucket_id = 'source-pdfs'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "source_pdfs_insert_own" on storage.objects;
create policy "source_pdfs_insert_own"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'source-pdfs'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "source_pdfs_update_own" on storage.objects;
create policy "source_pdfs_update_own"
on storage.objects for update
to authenticated
using (
  bucket_id = 'source-pdfs'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'source-pdfs'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "source_pdfs_delete_own" on storage.objects;
create policy "source_pdfs_delete_own"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'source-pdfs'
  and (storage.foldername(name))[1] = auth.uid()::text
);
