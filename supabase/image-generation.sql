-- Persona: generate images in Studio (Shot builder → Generate).
-- Keeps a log of every generated image and enforces the daily limits that keep the site inside the free tier.
-- Run once in Supabase → SQL editor (after character-ownership.sql and accounts-and-safety.sql, which define owns_character and is_admin).
-- Safe to run again.

create table if not exists public.image_generations (
  id bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  character_slug text not null,
  provider text not null,
  model text not null,
  prompt text,
  seed bigint,
  status text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  created_at timestamptz not null default now()
);
create index if not exists image_generations_day on public.image_generations (provider, created_at);
create index if not exists image_generations_user_day on public.image_generations (user_id, created_at);

alter table public.image_generations enable row level security;
drop policy if exists "own generations" on public.image_generations;
create policy "own generations" on public.image_generations for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
-- No insert/update/delete policies: rows are only written by the functions below.

-- Free tiers reset at 00:00 UTC, so "today" is the UTC day.
create or replace function public.image_gen_counts(p_provider text, uid uuid)
returns table (user_used int, site_used int) language sql stable security definer set search_path = public as $$
  select
    (select count(*)::int from image_generations
      where user_id = uid and status <> 'failed' and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'),
    (select count(*)::int from image_generations
      where provider = p_provider and status <> 'failed' and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc');
$$;

-- How many images this person and the whole site have made today.
create or replace function public.image_gen_usage(p_provider text)
returns json language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); u int; s int;
begin
  if uid is null then raise exception 'Please sign in.' using errcode = '28000'; end if;
  select user_used, site_used into u, s from image_gen_counts(p_provider, uid);
  return json_build_object('user_used', u, 'site_used', s);
end $$;

-- Reserve one image before calling the image model. Raises 54000 when a daily limit is reached.
create or replace function public.image_gen_claim(p_provider text, p_model text, p_slug text, p_prompt text,
  p_seed bigint, p_user_limit int, p_site_limit int)
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); u int; s int; new_id bigint;
begin
  if uid is null then raise exception 'Please sign in.' using errcode = '28000'; end if;
  if not public.owns_character(p_slug) and not public.is_admin() then
    raise exception 'You can only generate images for your own characters.' using errcode = '42501';
  end if;
  -- One claim at a time per provider, so two people can't both take the last free image.
  perform pg_advisory_xact_lock(hashtext('image_gen:' || p_provider));
  select user_used, site_used into u, s from image_gen_counts(p_provider, uid);
  if p_site_limit is not null and s >= p_site_limit then
    raise exception 'Today''s free images for Persona are used up (% of %). They reset at midnight UTC.', s, p_site_limit using errcode = '54000';
  end if;
  if p_user_limit is not null and u >= p_user_limit and not public.is_admin() then
    raise exception 'You''ve made your % images for today. More tomorrow (resets at midnight UTC).', p_user_limit using errcode = '54000';
  end if;
  insert into image_generations (user_id, character_slug, provider, model, prompt, seed)
    values (uid, p_slug, p_provider, p_model, left(p_prompt, 4000), p_seed) returning id into new_id;
  return json_build_object('id', new_id, 'user_used', u + 1, 'site_used', s + 1);
end $$;

-- Mark a claim done, or failed (failed ones don't count toward the limits).
create or replace function public.image_gen_finish(p_id bigint, p_ok boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  update image_generations set status = case when p_ok then 'done' else 'failed' end
    where id = p_id and user_id = auth.uid() and status = 'pending';
end $$;

revoke all on function public.image_gen_counts(text, uuid) from public, anon, authenticated;
grant execute on function public.image_gen_usage(text) to authenticated;
grant execute on function public.image_gen_claim(text, text, text, text, bigint, int, int) to authenticated;
grant execute on function public.image_gen_finish(bigint, boolean) to authenticated;
grant select on public.image_generations to authenticated;
