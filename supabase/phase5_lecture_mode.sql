-- MedTranslate Studio — Faza 5: Lecture Mode paginat și editabil
-- Rulează integral în Supabase Dashboard > SQL Editor după Fazele 1–3.
-- Script idempotent: poate fi rulat din nou.

create table if not exists public.lecture_sections (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  section_key text not null,
  position integer not null default 0,
  title text not null default 'Secțiune fără titlu',
  heading_level smallint not null default 0,
  source_markdown text not null default '',
  source_chunk_ids uuid[] not null default '{}'::uuid[],
  source_fingerprint text not null default '',
  content_edited text not null default '',
  editor_format text not null default 'html',
  manual_revision integer not null default 0,
  editor_updated_at timestamptz,
  source_changed boolean not null default false,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id, section_key),
  constraint lecture_sections_position_check check (position >= 0),
  constraint lecture_sections_heading_level_check check (heading_level between 0 and 6),
  constraint lecture_sections_revision_check check (manual_revision >= 0),
  constraint lecture_sections_editor_format_check check (editor_format = 'html')
);

create index if not exists lecture_sections_project_position_idx
  on public.lecture_sections(project_id, is_archived, position);
create index if not exists lecture_sections_user_updated_idx
  on public.lecture_sections(user_id, updated_at desc);

alter table public.lecture_sections enable row level security;

-- Politicile sunt recreate explicit pentru ca scriptul să rămână predictibil.
drop policy if exists "lecture_sections_select_own" on public.lecture_sections;
drop policy if exists "lecture_sections_insert_own" on public.lecture_sections;
drop policy if exists "lecture_sections_update_own" on public.lecture_sections;
drop policy if exists "lecture_sections_delete_own" on public.lecture_sections;

create policy "lecture_sections_select_own"
  on public.lecture_sections for select
  to authenticated
  using (user_id = auth.uid());

create policy "lecture_sections_insert_own"
  on public.lecture_sections for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.projects p
      where p.id = project_id and p.user_id = auth.uid()
    )
  );

create policy "lecture_sections_update_own"
  on public.lecture_sections for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "lecture_sections_delete_own"
  on public.lecture_sections for delete
  to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on public.lecture_sections to authenticated;

create or replace function public.sync_project_lecture_sections(
  p_project_id uuid,
  p_sections jsonb
)
returns setof public.lecture_sections
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  item jsonb;
  item_key text;
  item_title text;
  item_position integer;
  item_heading_level integer;
  item_source_markdown text;
  item_fingerprint text;
  validated_chunk_ids uuid[];
  incoming_keys text[] := '{}'::text[];
begin
  if current_user_id is null then
    raise exception 'Autentificare necesară.';
  end if;

  if not exists (
    select 1 from public.projects p
    where p.id = p_project_id and p.user_id = current_user_id
  ) then
    raise exception 'Proiectul nu există sau nu aparține utilizatorului curent.';
  end if;

  if jsonb_typeof(coalesce(p_sections, '[]'::jsonb)) <> 'array' then
    raise exception 'Secțiunile Lecture Mode trebuie să fie un array JSON.';
  end if;

  for item in select value from jsonb_array_elements(coalesce(p_sections, '[]'::jsonb))
  loop
    item_key := left(coalesce(nullif(trim(item ->> 'section_key'), ''), gen_random_uuid()::text), 180);
    item_title := left(coalesce(nullif(trim(item ->> 'title'), ''), 'Secțiune fără titlu'), 300);
    item_position := greatest(coalesce(nullif(item ->> 'position', '')::integer, 0), 0);
    item_heading_level := least(6, greatest(coalesce(nullif(item ->> 'heading_level', '')::integer, 0), 0));
    item_source_markdown := coalesce(item ->> 'source_markdown', '');
    item_fingerprint := left(coalesce(item ->> 'source_fingerprint', ''), 160);

    if octet_length(item_source_markdown) > 5000000 then
      raise exception 'O secțiune Lecture Mode depășește limita de dimensiune.';
    end if;

    select coalesce(array(
      select c.id
      from jsonb_array_elements_text(coalesce(item -> 'source_chunk_ids', '[]'::jsonb)) raw(value)
      join public.chunks c
        on c.id = raw.value::uuid
       and c.project_id = p_project_id
       and c.user_id = current_user_id
    ), '{}'::uuid[])
    into validated_chunk_ids;

    incoming_keys := array_append(incoming_keys, item_key);

    insert into public.lecture_sections (
      project_id, user_id, section_key, position, title, heading_level,
      source_markdown, source_chunk_ids, source_fingerprint, is_archived,
      created_at, updated_at
    ) values (
      p_project_id, current_user_id, item_key, item_position, item_title, item_heading_level,
      item_source_markdown, validated_chunk_ids, item_fingerprint, false,
      now(), now()
    )
    on conflict (project_id, section_key) do update
    set
      position = excluded.position,
      title = excluded.title,
      heading_level = excluded.heading_level,
      source_markdown = excluded.source_markdown,
      source_chunk_ids = excluded.source_chunk_ids,
      source_changed = public.lecture_sections.manual_revision > 0
        and public.lecture_sections.source_fingerprint <> excluded.source_fingerprint,
      source_fingerprint = excluded.source_fingerprint,
      is_archived = false,
      updated_at = now()
    where public.lecture_sections.user_id = current_user_id;
  end loop;

  update public.lecture_sections
  set is_archived = true, updated_at = now()
  where project_id = p_project_id
    and user_id = current_user_id
    and not (section_key = any(incoming_keys));

  update public.projects
  set updated_at = now()
  where id = p_project_id and user_id = current_user_id;

  return query
    select ls.*
    from public.lecture_sections ls
    where ls.project_id = p_project_id
      and ls.user_id = current_user_id
      and ls.is_archived = false
    order by ls.position;
end;
$$;

revoke all on function public.sync_project_lecture_sections(uuid, jsonb) from public;
grant execute on function public.sync_project_lecture_sections(uuid, jsonb) to authenticated;

create or replace function public.save_lecture_section(
  p_section_id uuid,
  p_content_html text
)
returns public.lecture_sections
language plpgsql
security invoker
set search_path = public
as $$
declare
  saved_section public.lecture_sections;
begin
  if auth.uid() is null then
    raise exception 'Autentificare necesară.';
  end if;

  if octet_length(coalesce(p_content_html, '')) > 5000000 then
    raise exception 'Conținutul secțiunii este prea mare.';
  end if;

  update public.lecture_sections
  set
    content_edited = coalesce(p_content_html, ''),
    editor_format = 'html',
    manual_revision = manual_revision + 1,
    editor_updated_at = now(),
    source_changed = false,
    updated_at = now()
  where id = p_section_id
    and user_id = auth.uid()
  returning * into saved_section;

  if saved_section.id is null then
    raise exception 'Secțiunea nu există sau nu aparține utilizatorului curent.';
  end if;

  update public.projects
  set updated_at = now()
  where id = saved_section.project_id and user_id = auth.uid();

  return saved_section;
end;
$$;

revoke all on function public.save_lecture_section(uuid, text) from public;
grant execute on function public.save_lecture_section(uuid, text) to authenticated;
