-- Persona: let signed-in creators create their own characters.
-- Paste this whole file into the Supabase SQL editor and press Run. Safe to run more than once.

alter table public.creators add column if not exists characters text[] not null default '{}';

create table if not exists public.characters (
  slug         text primary key
               check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 44
                      and slug not in ('lil-miquela', 'imma', 'aitana-lopez', 'nova-reyes')),
  name         text not null check (length(btrim(name)) between 1 and 60),
  handle       text check (handle is null or length(handle) <= 41),
  bio          text check (bio is null or length(bio) <= 600),
  avatar_url   text,
  avatar_path  text,
  creator_name text,
  owner        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at   timestamptz not null default now()
);
alter table public.characters enable row level security;

drop policy if exists "characters are public" on public.characters;
create policy "characters are public" on public.characters for select using (true);

drop policy if exists "creators create own characters" on public.characters;
create policy "creators create own characters" on public.characters for insert to authenticated
  with check (owner = auth.uid());

drop policy if exists "owners edit characters" on public.characters;
create policy "owners edit characters" on public.characters for update to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());

drop policy if exists "owners delete characters" on public.characters;
create policy "owners delete characters" on public.characters for delete to authenticated
  using (owner = auth.uid());

create or replace function public.link_character_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.creators (id, name) values (new.owner, new.creator_name) on conflict (id) do nothing;
    update public.creators set characters = array_append(characters, new.slug)
      where id = new.owner and not (new.slug = any(characters));
    return new;
  else
    update public.creators set characters = array_remove(characters, old.slug) where id = old.owner;
    delete from public.images where character_slug = old.slug;
    return old;
  end if;
end $$;

drop trigger if exists characters_link_owner on public.characters;
create trigger characters_link_owner after insert or delete on public.characters
  for each row execute function public.link_character_owner();

grant usage on schema public to anon, authenticated;
grant select on public.characters to anon, authenticated;
grant insert, update, delete on public.characters to authenticated;
grant select on public.images, public.creators to anon, authenticated;
grant insert, update, delete on public.images to authenticated;
