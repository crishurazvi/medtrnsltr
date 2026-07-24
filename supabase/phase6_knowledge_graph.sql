-- MedTranslate Studio — Faza 6
-- Interconectare [[Concept]], backlinks și Knowledge Graph.
-- Rulează după Fazele 1–5 în Supabase Dashboard > SQL Editor.
-- Script idempotent: poate fi rulat din nou.

create extension if not exists pgcrypto;

create or replace function public.normalize_wiki_title(p_value text)
returns text
language sql
immutable
parallel safe
as $$
  select trim(
    regexp_replace(
      translate(lower(coalesce(p_value, '')), 'ăâîșşțţ', 'aaisstt'),
      '\s+',
      ' ',
      'g'
    )
  );
$$;

create table if not exists public.concept_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  source_type text not null,
  source_project_id uuid not null references public.projects(id) on delete cascade,
  source_concept_id uuid references public.concepts(id) on delete cascade,
  source_lecture_section_id uuid references public.lecture_sections(id) on delete cascade,
  target_concept_id uuid references public.concepts(id) on delete set null,
  target_title text not null,
  target_normalized text not null,
  target_project_hint text not null default '',
  target_project_normalized text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint concept_links_source_type_check check (
    source_type in ('concept_content', 'concept_notes', 'lecture_section')
  ),
  constraint concept_links_source_shape_check check (
    (
      source_type in ('concept_content', 'concept_notes')
      and source_concept_id is not null
      and source_lecture_section_id is null
    )
    or
    (
      source_type = 'lecture_section'
      and source_concept_id is null
      and source_lecture_section_id is not null
    )
  ),
  constraint concept_links_target_title_check check (char_length(target_title) between 1 and 300)
);

create unique index if not exists concept_links_concept_source_unique
  on public.concept_links(user_id, source_type, source_concept_id, target_project_normalized, target_normalized)
  where source_concept_id is not null;

create unique index if not exists concept_links_lecture_source_unique
  on public.concept_links(user_id, source_type, source_lecture_section_id, target_project_normalized, target_normalized)
  where source_lecture_section_id is not null;

create index if not exists concept_links_target_concept_idx
  on public.concept_links(user_id, target_concept_id);
create index if not exists concept_links_target_title_idx
  on public.concept_links(user_id, target_project_normalized, target_normalized);
create index if not exists concept_links_source_project_idx
  on public.concept_links(user_id, source_project_id);

alter table public.concept_links enable row level security;

drop policy if exists "concept_links_select_own" on public.concept_links;
drop policy if exists "concept_links_insert_own" on public.concept_links;
drop policy if exists "concept_links_update_own" on public.concept_links;
drop policy if exists "concept_links_delete_own" on public.concept_links;

create policy "concept_links_select_own"
  on public.concept_links for select
  to authenticated
  using (user_id = auth.uid());

create policy "concept_links_insert_own"
  on public.concept_links for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.projects p
      where p.id = source_project_id and p.user_id = auth.uid()
    )
  );

create policy "concept_links_update_own"
  on public.concept_links for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "concept_links_delete_own"
  on public.concept_links for delete
  to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on public.concept_links to authenticated;
revoke all on public.concept_links from anon;

drop trigger if exists concept_links_set_updated_at on public.concept_links;
create trigger concept_links_set_updated_at
before update on public.concept_links
for each row execute function public.set_updated_at();

-- Înlocuiește atomic indexul de linkuri pentru o singură zonă de autosave.
-- p_links este un array JSON: [{"target_title":"...", "project_hint":"..."}].
create or replace function public.sync_content_links(
  p_source_type text,
  p_source_id uuid,
  p_links jsonb
)
returns setof public.concept_links
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  source_project uuid;
  source_concept uuid;
  source_lecture uuid;
  link_item jsonb;
  raw_title text;
  raw_hint text;
  normalized_title text;
  normalized_hint text;
  resolved_target uuid;
  seen_keys text[] := '{}'::text[];
  current_key text;
begin
  if current_user_id is null then
    raise exception 'Autentificare necesară.';
  end if;

  if p_source_type not in ('concept_content', 'concept_notes', 'lecture_section') then
    raise exception 'Tip de sursă Wiki invalid.';
  end if;

  if p_source_type in ('concept_content', 'concept_notes') then
    select c.project_id, c.id
      into source_project, source_concept
    from public.concepts c
    where c.id = p_source_id and c.user_id = current_user_id;
  else
    select ls.project_id, ls.id
      into source_project, source_lecture
    from public.lecture_sections ls
    where ls.id = p_source_id and ls.user_id = current_user_id;
  end if;

  if source_project is null then
    raise exception 'Sursa linkurilor nu există sau nu aparține utilizatorului curent.';
  end if;

  if jsonb_typeof(coalesce(p_links, '[]'::jsonb)) <> 'array' then
    raise exception 'Lista linkurilor trebuie să fie un array JSON.';
  end if;

  delete from public.concept_links cl
  where cl.user_id = current_user_id
    and cl.source_type = p_source_type
    and (
      (source_concept is not null and cl.source_concept_id = source_concept)
      or
      (source_lecture is not null and cl.source_lecture_section_id = source_lecture)
    );

  for link_item in select value from jsonb_array_elements(coalesce(p_links, '[]'::jsonb))
  loop
    raw_title := left(trim(coalesce(link_item ->> 'target_title', '')), 300);
    raw_hint := left(trim(coalesce(link_item ->> 'project_hint', '')), 300);
    normalized_title := public.normalize_wiki_title(raw_title);
    normalized_hint := public.normalize_wiki_title(raw_hint);
    current_key := normalized_hint || '::' || normalized_title;

    if raw_title = '' or normalized_title = '' or current_key = any(seen_keys) then
      continue;
    end if;
    seen_keys := array_append(seen_keys, current_key);

    resolved_target := null;
    select c.id
      into resolved_target
    from public.concepts c
    join public.projects p on p.id = c.project_id and p.user_id = current_user_id
    where c.user_id = current_user_id
      and public.normalize_wiki_title(c.title) = normalized_title
      and (
        normalized_hint = ''
        or public.normalize_wiki_title(p.title) = normalized_hint
      )
    order by
      case
        when normalized_hint <> '' then 0
        when c.project_id = source_project then 0
        else 1
      end,
      c.updated_at desc,
      c.position asc
    limit 1;

    insert into public.concept_links (
      user_id,
      source_type,
      source_project_id,
      source_concept_id,
      source_lecture_section_id,
      target_concept_id,
      target_title,
      target_normalized,
      target_project_hint,
      target_project_normalized
    ) values (
      current_user_id,
      p_source_type,
      source_project,
      source_concept,
      source_lecture,
      resolved_target,
      raw_title,
      normalized_title,
      raw_hint,
      normalized_hint
    );
  end loop;

  return query
    select cl.*
    from public.concept_links cl
    where cl.user_id = current_user_id
      and cl.source_type = p_source_type
      and (
        (source_concept is not null and cl.source_concept_id = source_concept)
        or
        (source_lecture is not null and cl.source_lecture_section_id = source_lecture)
      )
    order by cl.created_at;
end;
$$;

revoke all on function public.sync_content_links(text, uuid, jsonb) from public;
grant execute on function public.sync_content_links(text, uuid, jsonb) to authenticated;

-- Rezolvă un [[Concept]] la click. Dacă nu există hint de proiect,
-- conceptul din proiectul sursă are prioritate, apoi biblioteca globală.
create or replace function public.resolve_concept_reference(
  p_title text,
  p_source_project_id uuid default null,
  p_project_hint text default ''
)
returns table (
  concept_id uuid,
  concept_title text,
  concept_summary text,
  project_id uuid,
  project_title text,
  chapter_id uuid,
  chapter_title text,
  candidate_count bigint
)
language sql
security invoker
set search_path = public
as $$
  with candidates as (
    select
      c.id as concept_id,
      c.title as concept_title,
      c.summary as concept_summary,
      c.project_id,
      p.title as project_title,
      c.chapter_id,
      ch.title as chapter_title,
      case
        when public.normalize_wiki_title(coalesce(p_project_hint, '')) <> '' then 0
        when c.project_id = p_source_project_id then 0
        else 1
      end as match_rank
    from public.concepts c
    join public.projects p on p.id = c.project_id and p.user_id = auth.uid()
    join public.chapters ch on ch.id = c.chapter_id and ch.user_id = auth.uid()
    where c.user_id = auth.uid()
      and public.normalize_wiki_title(c.title) = public.normalize_wiki_title(p_title)
      and (
        public.normalize_wiki_title(coalesce(p_project_hint, '')) = ''
        or public.normalize_wiki_title(p.title) = public.normalize_wiki_title(p_project_hint)
      )
  )
  select
    concept_id,
    concept_title,
    concept_summary,
    project_id,
    project_title,
    chapter_id,
    chapter_title,
    count(*) over() as candidate_count
  from candidates
  order by match_rank, concept_title, project_title
  limit 1;
$$;

revoke all on function public.resolve_concept_reference(text, uuid, text) from public;
grant execute on function public.resolve_concept_reference(text, uuid, text) to authenticated;

-- Backlinks pentru toate conceptele unui proiect, într-un singur apel.
create or replace function public.get_project_backlinks(p_project_id uuid)
returns table (
  link_id uuid,
  target_concept_id uuid,
  source_type text,
  source_project_id uuid,
  source_project_title text,
  source_concept_id uuid,
  source_lecture_section_id uuid,
  source_title text,
  source_summary text,
  source_excerpt text,
  created_at timestamptz
)
language sql
security invoker
set search_path = public
as $$
  with target_concepts as (
    select c.id, c.title, c.project_id, p.title as project_title
    from public.concepts c
    join public.projects p on p.id = c.project_id and p.user_id = auth.uid()
    where c.user_id = auth.uid() and c.project_id = p_project_id
  ),
  title_counts as (
    select public.normalize_wiki_title(c.title) as normalized_title, count(*) as total
    from public.concepts c
    where c.user_id = auth.uid()
    group by public.normalize_wiki_title(c.title)
  )
  select
    cl.id as link_id,
    tc.id as target_concept_id,
    cl.source_type,
    cl.source_project_id,
    sp.title as source_project_title,
    cl.source_concept_id,
    cl.source_lecture_section_id,
    case
      when cl.source_concept_id is not null then sc.title
      else sl.title
    end as source_title,
    case
      when cl.source_concept_id is not null then sc.summary
      else 'Secțiune din Lecture Mode'
    end as source_summary,
    left(
      case
        when cl.source_type = 'concept_content' then coalesce(sc.content_edited, '')
        when cl.source_type = 'concept_notes' then coalesce(sc.personal_notes, '')
        else coalesce(nullif(sl.content_edited, ''), sl.source_markdown, '')
      end,
      1200
    ) as source_excerpt,
    cl.created_at
  from public.concept_links cl
  join public.projects sp on sp.id = cl.source_project_id and sp.user_id = auth.uid()
  left join public.concepts sc on sc.id = cl.source_concept_id and sc.user_id = auth.uid()
  left join public.lecture_sections sl on sl.id = cl.source_lecture_section_id and sl.user_id = auth.uid()
  join target_concepts tc on (
    cl.target_concept_id = tc.id
    or (
      cl.target_concept_id is null
      and cl.target_normalized = public.normalize_wiki_title(tc.title)
      and (
        (
          cl.target_project_normalized <> ''
          and cl.target_project_normalized = public.normalize_wiki_title(tc.project_title)
        )
        or (
          cl.target_project_normalized = ''
          and (
            cl.source_project_id = tc.project_id
            or coalesce((
              select total from title_counts t
              where t.normalized_title = cl.target_normalized
            ), 0) = 1
          )
        )
      )
    )
  )
  where cl.user_id = auth.uid()
  order by tc.id, cl.created_at desc;
$$;

revoke all on function public.get_project_backlinks(uuid) from public;
grant execute on function public.get_project_backlinks(uuid) to authenticated;

-- Un singur payload pentru graful global.
create or replace function public.get_knowledge_graph()
returns jsonb
language sql
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'title', p.title,
        'source_filename', p.source_filename,
        'updated_at', p.updated_at
      ) order by p.updated_at desc)
      from public.projects p
      where p.user_id = auth.uid()
    ), '[]'::jsonb),
    'chapters', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ch.id,
        'project_id', ch.project_id,
        'title', ch.title,
        'summary', ch.summary,
        'position', ch.position,
        'page_start', ch.page_start,
        'page_end', ch.page_end
      ) order by ch.project_id, ch.position)
      from public.chapters ch
      where ch.user_id = auth.uid()
    ), '[]'::jsonb),
    'concepts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'project_id', c.project_id,
        'chapter_id', c.chapter_id,
        'title', c.title,
        'summary', c.summary,
        'tags', c.tags,
        'position', c.position,
        'page_start', c.page_start,
        'page_end', c.page_end,
        'manual_revision', c.manual_revision
      ) order by c.project_id, c.chapter_id, c.position)
      from public.concepts c
      where c.user_id = auth.uid()
    ), '[]'::jsonb),
    'lecture_sections', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ls.id,
        'project_id', ls.project_id,
        'title', ls.title,
        'position', ls.position,
        'heading_level', ls.heading_level
      ) order by ls.project_id, ls.position)
      from public.lecture_sections ls
      where ls.user_id = auth.uid() and ls.is_archived = false
    ), '[]'::jsonb),
    'links', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', cl.id,
        'source_type', cl.source_type,
        'source_project_id', cl.source_project_id,
        'source_concept_id', cl.source_concept_id,
        'source_lecture_section_id', cl.source_lecture_section_id,
        'target_concept_id', cl.target_concept_id,
        'target_title', cl.target_title,
        'target_project_hint', cl.target_project_hint
      ) order by cl.created_at)
      from public.concept_links cl
      where cl.user_id = auth.uid()
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.get_knowledge_graph() from public;
grant execute on function public.get_knowledge_graph() to authenticated;
