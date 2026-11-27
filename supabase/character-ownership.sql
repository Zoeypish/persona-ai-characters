-- Character ownership: each creator account manages only the characters assigned to it.
-- Run once in the Supabase SQL editor (safe to re-run). Then assign characters, see the bottom.

-- 1. Which characters (slugs, e.g. 'nova-reyes') each creator owns. Only the site owner sets this.
alter table public.creators add column if not exists characters text[] not null default '{}';

-- Creators can edit their own row but not their points or their characters.
drop policy if exists "creator updates self" on public.creators;
create policy "creator updates self" on public.creators for update to authenticated using (id = auth.uid())
  with check (id = auth.uid()
    and points = (select c.points from public.creators c where c.id = auth.uid())
    and characters = (select c.characters from public.creators c where c.id = auth.uid()));

create or replace function public.owns_character(slug text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.creators where id = auth.uid() and slug = any(characters));
$$;
grant execute on function public.owns_character(text) to anon, authenticated;

-- 2. Images: everyone sees live images; owners also see their hidden ones.
--    Only a character's owner can upload, switch live/hidden or delete its images.
drop policy if exists "read live or signed in" on public.images;
drop policy if exists "read live or owner" on public.images;
create policy "read live or owner" on public.images for select using (live or public.owns_character(character_slug));

drop policy if exists "creators insert within allowance" on public.images;
create policy "creators insert within allowance" on public.images for insert to authenticated
  with check (public.owns_character(character_slug)
    and (url is null or public.uploads_used(auth.uid()) < public.upload_allowance(auth.uid())));

drop policy if exists "creators update" on public.images;
create policy "creators update" on public.images for update to authenticated
  using (public.owns_character(character_slug)) with check (public.owns_character(character_slug));

drop policy if exists "creators delete own uploads" on public.images;
create policy "creators delete own uploads" on public.images for delete to authenticated
  using (owner = auth.uid() and public.owns_character(character_slug));

-- Table permissions for the API roles (RLS above still decides which rows).
grant usage on schema public to anon, authenticated;
grant select on public.images, public.creators to anon, authenticated;
grant insert, update, delete on public.images to authenticated;
grant update on public.creators to authenticated;
grant execute on function public.upload_allowance(uuid), public.uploads_used(uuid) to anon, authenticated;

-- 3. Give a creator their character (run in the SQL editor, which bypasses the rules above).
--    The creator must have signed in with Google once so their row exists.
--   update public.creators set characters = array['nova-reyes'] where id = (select id from auth.users where email = 'creator@example.com');
