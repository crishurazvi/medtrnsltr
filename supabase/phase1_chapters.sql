-- MedTranslate Studio — Faza 1: Capitole și concepte
-- Rulează integral în Supabase Dashboard > SQL Editor.
-- Fișierul este idempotent și poate fi rulat peste schema existentă.

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

create table if not exists public.chapters (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  summary text not null default '',
  position integer not null check (position >= 0),
  page_start integer,
  page_end integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chapters_project_position_unique unique (project_id, position),
  constraint chapters_valid_pages check (
    (page_start is null and page_end is null)
    or (page_start > 0 and page_end >= page_start)
  )
);

create table if not exists public.concepts (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  summary text not null default '',
  position integer not null check (position >= 0),
  page_start integer,
  page_end integer,
  source_chunk_ids uuid[] not null default '{}'::uuid[],
  tags text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint concepts_chapter_position_unique unique (chapter_id, position),
  constraint concepts_valid_pages check (
    (page_start is null and page_end is null)
    or (page_start > 0 and page_end >= page_start)
  )
);

create index if not exists chapters_project_position_idx
  on public.chapters(project_id, position);
create index if not exists chapters_user_updated_idx
  on public.chapters(user_id, updated_at desc);
create index if not exists concepts_project_position_idx
  on public.concepts(project_id, position);
create index if not exists concepts_chapter_position_idx
  on public.concepts(chapter_id, position);
create index if not exists concepts_user_updated_idx
  on public.concepts(user_id, updated_at desc);
create index if not exists concepts_source_chunks_gin_idx
  on public.concepts using gin(source_chunk_ids);
create index if not exists concepts_tags_gin_idx
  on public.concepts using gin(tags);

drop trigger if exists chapters_set_updated_at on public.chapters;
create trigger chapters_set_updated_at
before update on public.chapters
for each row execute function public.set_updated_at();

drop trigger if exists concepts_set_updated_at on public.concepts;
create trigger concepts_set_updated_at
before update on public.concepts
for each row execute function public.set_updated_at();

drop trigger if exists chapters_touch_project on public.chapters;
create trigger chapters_touch_project
after insert or update or delete on public.chapters
for each row execute function public.touch_parent_project();

drop trigger if exists concepts_touch_project on public.concepts;
create trigger concepts_touch_project
after insert or update or delete on public.concepts
for each row execute function public.touch_parent_project();

alter table public.chapters enable row level security;
alter table public.concepts enable row level security;

-- Capitole
drop policy if exists "chapters_select_own" on public.chapters;
create policy "chapters_select_own"
on public.chapters for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "chapters_insert_own" on public.chapters;
create policy "chapters_insert_own"
on public.chapters for insert
to authenticated
with check (
  auth.uid() = user_id
  and exists (
    select 1 from public.projects p
    where p.id = project_id and p.user_id = auth.uid()
  )
);

drop policy if exists "chapters_update_own" on public.chapters;
create policy "chapters_update_own"
on public.chapters for update
to authenticated
using (auth.uid() = user_id)
with check (
  auth.uid() = user_id
  and exists (
    select 1 from public.projects p
    where p.id = project_id and p.user_id = auth.uid()
  )
);

drop policy if exists "chapters_delete_own" on public.chapters;
create policy "chapters_delete_own"
on public.chapters for delete
to authenticated
using (auth.uid() = user_id);

-- Concepte
drop policy if exists "concepts_select_own" on public.concepts;
create policy "concepts_select_own"
on public.concepts for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "concepts_insert_own" on public.concepts;
create policy "concepts_insert_own"
on public.concepts for insert
to authenticated
with check (
  auth.uid() = user_id
  and exists (
    select 1 from public.projects p
    where p.id = project_id and p.user_id = auth.uid()
  )
  and exists (
    select 1 from public.chapters c
    where c.id = chapter_id
      and c.project_id = project_id
      and c.user_id = auth.uid()
  )
);

drop policy if exists "concepts_update_own" on public.concepts;
create policy "concepts_update_own"
on public.concepts for update
to authenticated
using (auth.uid() = user_id)
with check (
  auth.uid() = user_id
  and exists (
    select 1 from public.projects p
    where p.id = project_id and p.user_id = auth.uid()
  )
  and exists (
    select 1 from public.chapters c
    where c.id = chapter_id
      and c.project_id = project_id
      and c.user_id = auth.uid()
  )
);

drop policy if exists "concepts_delete_own" on public.concepts;
create policy "concepts_delete_own"
on public.concepts for delete
to authenticated
using (auth.uid() = user_id);

revoke all on table public.chapters from anon;
revoke all on table public.concepts from anon;
grant select, insert, update, delete on table public.chapters to authenticated;
grant select, insert, update, delete on table public.concepts to authenticated;

-- Înlocuiește atomic structura unui proiect. Dacă o inserare eșuează,
-- vechea structură rămâne intactă deoarece funcția rulează într-o tranzacție.
create or replace function public.replace_project_knowledge(
  p_project_id uuid,
  p_structure jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  chapter_item jsonb;
  concept_item jsonb;
  chapter_ordinality bigint;
  concept_ordinality bigint;
  new_chapter_id uuid;
begin
  if current_user_id is null then
    raise exception 'Autentificare necesară.';
  end if;

  if not exists (
    select 1
    from public.projects p
    where p.id = p_project_id
      and p.user_id = current_user_id
  ) then
    raise exception 'Proiectul nu există sau nu aparține utilizatorului curent.';
  end if;

  if jsonb_typeof(coalesce(p_structure -> 'chapters', '[]'::jsonb)) <> 'array' then
    raise exception 'Structura capitolelor trebuie să fie un array JSON.';
  end if;

  delete from public.chapters
  where project_id = p_project_id
    and user_id = current_user_id;

  for chapter_item, chapter_ordinality in
    select value, ordinality
    from jsonb_array_elements(coalesce(p_structure -> 'chapters', '[]'::jsonb))
      with ordinality
  loop
    insert into public.chapters (
      project_id,
      user_id,
      title,
      summary,
      position,
      page_start,
      page_end
    ) values (
      p_project_id,
      current_user_id,
      left(coalesce(nullif(trim(chapter_item ->> 'title'), ''), 'Capitol fără titlu'), 300),
      left(coalesce(chapter_item ->> 'summary', ''), 5000),
      chapter_ordinality - 1,
      nullif(chapter_item ->> 'page_start', '')::integer,
      nullif(chapter_item ->> 'page_end', '')::integer
    )
    returning id into new_chapter_id;

    for concept_item, concept_ordinality in
      select value, ordinality
      from jsonb_array_elements(coalesce(chapter_item -> 'concepts', '[]'::jsonb))
        with ordinality
    loop
      insert into public.concepts (
        chapter_id,
        project_id,
        user_id,
        title,
        summary,
        position,
        page_start,
        page_end,
        source_chunk_ids,
        tags
      ) values (
        new_chapter_id,
        p_project_id,
        current_user_id,
        left(coalesce(nullif(trim(concept_item ->> 'title'), ''), 'Concept fără titlu'), 300),
        left(coalesce(concept_item ->> 'summary', ''), 5000),
        concept_ordinality - 1,
        nullif(concept_item ->> 'page_start', '')::integer,
        nullif(concept_item ->> 'page_end', '')::integer,
        coalesce(
          array(
            select c.id
            from jsonb_array_elements_text(
              coalesce(concept_item -> 'source_chunk_ids', '[]'::jsonb)
            ) as source_id(value)
            join public.chunks c
              on c.id = source_id.value::uuid
             and c.project_id = p_project_id
             and c.user_id = current_user_id
          ),
          '{}'::uuid[]
        ),
        coalesce(
          array(
            select left(trim(tag.value), 80)
            from jsonb_array_elements_text(
              coalesce(concept_item -> 'tags', '[]'::jsonb)
            ) as tag(value)
            where trim(tag.value) <> ''
            limit 12
          ),
          '{}'::text[]
        )
      );
    end loop;
  end loop;

  update public.projects
  set updated_at = now()
  where id = p_project_id
    and user_id = current_user_id;
end;
$$;

revoke all on function public.replace_project_knowledge(uuid, jsonb) from public;
grant execute on function public.replace_project_knowledge(uuid, jsonb) to authenticated;
