-- Persona: run this once in the Supabase SQL editor.
-- Then enable Google: Authentication → Providers → Google (add your Google OAuth client ID and secret),
-- and add your site URL (e.g. https://<project>.vercel.app/studio.html) under Authentication → URL Configuration → Redirect URLs.

-- Creators: one row per Google account that signs in. Points unlock extra uploads.
create table if not exists public.creators (
  id         uuid primary key references auth.users(id) on delete cascade,
  name       text,
  username   text unique,
  points     integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.creators enable row level security;
create policy "creators are public" on public.creators for select using (true);
create policy "creator updates self" on public.creators for update to authenticated using (id = auth.uid())
  with check (id = auth.uid() and points = (select points from public.creators where id = auth.uid())); -- creators can't award themselves points

-- Create the creator row automatically on first Google sign-in.
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.creators (id, name) values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Images: one row per uploaded image, or per built-in image a creator switched on/off.
create table if not exists public.images (
  id             text primary key,              -- "imma-3" for built-in images, "up-<time>-<n>" for uploads
  character_slug text not null,
  url            text,                           -- public URL for uploads (null for built-in images)
  path           text,                           -- storage path for uploads
  live           boolean not null default false,
  owner          uuid default auth.uid(),
  created_at     timestamptz not null default now()
);
alter table public.images enable row level security;

-- Upload allowance: 5 to start, plus 1 for every 10 points.
create or replace function public.upload_allowance(uid uuid) returns integer language sql stable security definer set search_path = public as $$
  select 5 + coalesce((select points from public.creators where id = uid), 0) / 10;
$$;
create or replace function public.uploads_used(uid uuid) returns integer language sql stable security definer set search_path = public as $$
  select count(*)::int from public.images where owner = uid and url is not null;
$$;

create policy "read live or signed in" on public.images
  for select using (live or auth.role() = 'authenticated');
create policy "creators insert within allowance" on public.images for insert to authenticated
  with check (url is null or public.uploads_used(auth.uid()) < public.upload_allowance(auth.uid()));
create policy "creators update" on public.images for update to authenticated using (true);
create policy "creators delete own uploads" on public.images for delete to authenticated using (owner = auth.uid());

-- Public image bucket; only signed-in creators can upload or delete.
insert into storage.buckets (id, name, public) values ('character-images', 'character-images', true)
  on conflict (id) do nothing;
create policy "creators upload" on storage.objects for insert to authenticated with check (bucket_id = 'character-images');
create policy "creators remove" on storage.objects for delete to authenticated using (bucket_id = 'character-images');

-- To give a creator points (e.g. from an admin tool or the SQL editor):
--   update public.creators set points = points + 10 where username = 'noorvale';
