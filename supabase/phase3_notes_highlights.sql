-- MedTranslate Studio — Faza 3: notițe personale și highlight-uri semantice
-- Rulează integral în Supabase Dashboard > SQL Editor după Fazele 1 și 2.
-- Script idempotent: poate fi rulat din nou fără să dubleze obiectele.

alter table public.concepts
  add column if not exists personal_notes text not null default '',
  add column if not exists notes_format text not null default 'html',
  add column if not exists notes_updated_at timestamptz,
  add column if not exists notes_revision integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'concepts_notes_format_check'
      and conrelid = 'public.concepts'::regclass
  ) then
    alter table public.concepts
      add constraint concepts_notes_format_check
      check (notes_format in ('html'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'concepts_notes_revision_check'
      and conrelid = 'public.concepts'::regclass
  ) then
    alter table public.concepts
      add constraint concepts_notes_revision_check
      check (notes_revision >= 0);
  end if;
end;
$$;

create index if not exists concepts_notes_updated_idx
  on public.concepts(user_id, notes_updated_at desc nulls last);

-- Salvează separat notițele personale. Highlight-urile sunt păstrate în
-- content_edited sub forma <mark data-highlight="..."> și folosesc funcția
-- existentă save_concept_editor din Faza 2.
create or replace function public.save_concept_notes(
  p_concept_id uuid,
  p_notes_html text
)
returns public.concepts
language plpgsql
security invoker
set search_path = public
as $$
declare
  saved_concept public.concepts;
begin
  if auth.uid() is null then
    raise exception 'Autentificare necesară.';
  end if;

  if octet_length(coalesce(p_notes_html, '')) > 1000000 then
    raise exception 'Notițele conceptului sunt prea mari.';
  end if;

  update public.concepts
  set
    personal_notes = coalesce(p_notes_html, ''),
    notes_format = 'html',
    notes_updated_at = now(),
    notes_revision = notes_revision + 1
  where id = p_concept_id
    and user_id = auth.uid()
  returning * into saved_concept;

  if saved_concept.id is null then
    raise exception 'Conceptul nu există sau nu aparține utilizatorului curent.';
  end if;

  return saved_concept;
end;
$$;

revoke all on function public.save_concept_notes(uuid, text) from public;
grant execute on function public.save_concept_notes(uuid, text) to authenticated;

-- Înlocuiește structura AI, dar conservă atât editorul personal și
-- highlight-urile lui, cât și notițele personale pentru conceptele care au
-- același capitol și același titlu generat.
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
  new_concept_id uuid;
  chapter_title_value text;
  chapter_summary_value text;
  concept_title_value text;
  concept_summary_value text;
  source_ids uuid[];
  original_content text;
  preserved_edits jsonb := '[]'::jsonb;
  preserved_item jsonb;
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

  select coalesce(jsonb_agg(jsonb_build_object(
    'chapter_key', lower(trim(ch.title)),
    'concept_key', lower(trim(coalesce(nullif(c.generated_title, ''), c.title))),
    'title', c.title,
    'summary', c.summary,
    'content_edited', c.content_edited,
    'editor_format', c.editor_format,
    'editor_updated_at', c.editor_updated_at,
    'manual_revision', c.manual_revision,
    'personal_notes', c.personal_notes,
    'notes_format', c.notes_format,
    'notes_updated_at', c.notes_updated_at,
    'notes_revision', c.notes_revision
  )), '[]'::jsonb)
  into preserved_edits
  from public.concepts c
  join public.chapters ch on ch.id = c.chapter_id
  where c.project_id = p_project_id
    and c.user_id = current_user_id
    and (
      trim(c.content_edited) <> ''
      or c.manual_revision > 0
      or trim(c.personal_notes) <> ''
      or c.notes_revision > 0
    );

  delete from public.chapters
  where project_id = p_project_id
    and user_id = current_user_id;

  for chapter_item, chapter_ordinality in
    select value, ordinality
    from jsonb_array_elements(coalesce(p_structure -> 'chapters', '[]'::jsonb))
      with ordinality
  loop
    chapter_title_value := left(
      coalesce(nullif(trim(chapter_item ->> 'title'), ''), 'Capitol fără titlu'),
      300
    );
    chapter_summary_value := left(coalesce(chapter_item ->> 'summary', ''), 5000);

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
      chapter_title_value,
      chapter_summary_value,
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
      concept_title_value := left(
        coalesce(nullif(trim(concept_item ->> 'title'), ''), 'Concept fără titlu'),
        300
      );
      concept_summary_value := left(coalesce(concept_item ->> 'summary', ''), 5000);

      select coalesce(array(
        select c.id
        from jsonb_array_elements_text(
          coalesce(concept_item -> 'source_chunk_ids', '[]'::jsonb)
        ) as source_id(value)
        join public.chunks c
          on c.id = source_id.value::uuid
         and c.project_id = p_project_id
         and c.user_id = current_user_id
      ), '{}'::uuid[])
      into source_ids;

      preserved_item := null;
      select item.value
      into preserved_item
      from jsonb_array_elements(preserved_edits) as item(value)
      where item.value ->> 'chapter_key' = lower(trim(chapter_title_value))
        and item.value ->> 'concept_key' = lower(trim(concept_title_value))
      limit 1;

      insert into public.concepts (
        chapter_id,
        project_id,
        user_id,
        title,
        summary,
        generated_title,
        generated_summary,
        position,
        page_start,
        page_end,
        source_chunk_ids,
        tags,
        content_original,
        content_edited,
        editor_format,
        editor_updated_at,
        manual_revision,
        personal_notes,
        notes_format,
        notes_updated_at,
        notes_revision
      ) values (
        new_chapter_id,
        p_project_id,
        current_user_id,
        coalesce(nullif(preserved_item ->> 'title', ''), concept_title_value),
        coalesce(nullif(preserved_item ->> 'summary', ''), concept_summary_value),
        concept_title_value,
        concept_summary_value,
        concept_ordinality - 1,
        nullif(concept_item ->> 'page_start', '')::integer,
        nullif(concept_item ->> 'page_end', '')::integer,
        source_ids,
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
        ),
        '',
        coalesce(preserved_item ->> 'content_edited', ''),
        coalesce(nullif(preserved_item ->> 'editor_format', ''), 'html'),
        nullif(preserved_item ->> 'editor_updated_at', '')::timestamptz,
        coalesce((preserved_item ->> 'manual_revision')::integer, 0),
        coalesce(preserved_item ->> 'personal_notes', ''),
        coalesce(nullif(preserved_item ->> 'notes_format', ''), 'html'),
        nullif(preserved_item ->> 'notes_updated_at', '')::timestamptz,
        coalesce((preserved_item ->> 'notes_revision')::integer, 0)
      )
      returning id into new_concept_id;

      select coalesce(
        nullif(string_agg(
          coalesce(nullif(trim(ch.translated_text), ''), trim(ch.source_text)),
          E'\n\n'
          order by ch.position
        ), ''),
        concept_summary_value,
        ''
      )
      into original_content
      from public.chunks ch
      where ch.project_id = p_project_id
        and ch.user_id = current_user_id
        and ch.id = any(source_ids);

      update public.concepts
      set content_original = coalesce(original_content, '')
      where id = new_concept_id;
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
