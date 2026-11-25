-- Persona: characters live in the database.
-- Run this in the Supabase SQL editor AFTER supabase/schema.sql. It is safe to run again:
-- it creates what is missing, refreshes the seeded profile text and credits, and never
-- changes which images a creator has switched live or hidden.

-- ---------- Characters: one row per public profile ----------
create table if not exists public.characters (
  slug             text primary key check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name             text not null,
  handle           text,
  link             text,
  tagline          text,
  origin           text,
  creator          text,                         -- display name of the human creator / studio
  creator_username text,                         -- set when the creator has a Persona profile
  since            text,
  audience         text,
  category         text,
  bio              text[] not null default '{}', -- one entry per paragraph
  known_for        text[] not null default '{}',
  owner            uuid references auth.users(id) on delete set null default auth.uid(),
  published        boolean not null default true,
  sort             integer not null default 100, -- lower shows first
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
alter table public.characters enable row level security;

drop policy if exists "characters are public" on public.characters;
create policy "characters are public" on public.characters
  for select using (published or owner = auth.uid());
drop policy if exists "creators create characters" on public.characters;
create policy "creators create characters" on public.characters
  for insert to authenticated with check (owner = auth.uid());
drop policy if exists "creators edit own characters" on public.characters;
create policy "creators edit own characters" on public.characters
  for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
drop policy if exists "creators delete own characters" on public.characters;
create policy "creators delete own characters" on public.characters
  for delete to authenticated using (owner = auth.uid());

grant select on public.characters to anon, authenticated;
grant insert, update, delete on public.characters to authenticated;

-- ---------- Images: credit + order, so the feed comes fully from the DB ----------
alter table public.images add column if not exists credit     text;
alter table public.images add column if not exists credit_url text;
alter table public.images add column if not exists position   integer not null default 1000;
create index if not exists images_character_idx on public.images (character_slug, position, created_at);

-- ---------- Seed the characters ----------
insert into public.characters
  (slug, name, handle, link, tagline, origin, creator, creator_username, since, audience, category, bio, known_for, owner, sort)
values
  ('lil-miquela', 'Lil Miquela', '@lilmiquela', 'https://www.instagram.com/lilmiquela/',
   'The original virtual it-girl.', 'Los Angeles, USA', 'Brud (now part of Dapper Labs)', null, '2016',
   '2.2M on Instagram', 'Music · Fashion',
   array[
     'Miquela Sousa is a 19-year-old "robot" from Los Angeles and one of the first computer-generated characters to become a mainstream influencer.',
     'She has released pop singles, appeared in campaigns for Prada and Calvin Klein, and was named one of TIME''s 25 most influential people on the internet in 2018. Her story, voice and look are written and directed by a human team.'
   ],
   array['Pop singles on Spotify', 'Prada, Calvin Klein, Samsung', 'TIME internet''s most influential, 2018'],
   null, 10),

  ('imma', 'Imma', '@imma.gram', 'https://www.instagram.com/imma.gram/',
   'Tokyo''s pink-bob virtual model.', 'Tokyo, Japan', 'Aww Inc.', null, '2018',
   '378K on Instagram', 'Fashion · Art · Culture',
   array[
     'Imma is a Japanese virtual model known for her signature pink bob and photo-real presence in everyday Tokyo scenes.',
     'She has fronted work for IKEA, Porsche, Amazon Fashion and SK-II, and famously "lived" in the window of IKEA''s Harajuku store for three days in 2020. Aww Inc. builds her as a long-running character with her own taste in art and culture.'
   ],
   array['IKEA Harajuku residency, 2020', 'Porsche, Amazon Fashion, SK-II', 'Japan''s first virtual model'],
   null, 20),

  ('aitana-lopez', 'Aitana López', '@fit_aitana', 'https://www.instagram.com/fit_aitana/',
   'The AI model who earns like a human one.', 'Barcelona, Spain', 'The Clueless agency', null, '2023',
   '404K on Instagram', 'Fitness · Gaming · Lifestyle',
   array[
     'Aitana is a 25-year-old pink-haired character from Barcelona, created by the agency The Clueless after it grew tired of working around human models'' schedules.',
     'Her team plans her personality, posts and partnerships week by week. Reports put her earnings at up to €10,000 a month from brand deals, which made her the most-cited example of an AI character run as a business.'
   ],
   array['Up to €10K/month in brand deals', 'Fitness and gaming content', 'Built by a human creative agency'],
   null, 30),

  ('nova-reyes', 'Nova Reyes', '@novareyes.ai', 'creator.html',
   'A Persona original, made in the Studio.', 'Toronto, Canada', 'Noor Vale', 'noorvale', '2026',
   'New on Persona', 'Fashion · Music · Late nights',
   array[
     'Nova is a 23-year-old night-shift DJ and stylist who only exists after dark. She is the first character created directly on Persona.',
     'Her creator, Noor Vale, writes her story week by week and decides in the Persona Studio which images go live.'
   ],
   array['First Persona original', 'Built and managed in the Studio', 'Images curated by her creator'],
   null, 40)
on conflict (slug) do update set
  name = excluded.name, handle = excluded.handle, link = excluded.link, tagline = excluded.tagline,
  origin = excluded.origin, creator = excluded.creator, creator_username = excluded.creator_username,
  since = excluded.since, audience = excluded.audience, category = excluded.category,
  bio = excluded.bio, known_for = excluded.known_for, sort = excluded.sort, updated_at = now();

-- ---------- Seed the featured images (files in /images, so url stays null) ----------
-- New rows go live; existing rows keep the creator's live/hidden choice.
insert into public.images (id, character_slug, url, path, live, owner, credit, credit_url, position)
values
  ('lil-miquela-1', 'lil-miquela', null, null, true, null, 'Arab News', 'https://www.arabnews.com/fashion/instagram-fashionista-miquela-sousa-casts-no-shadow-1307666', 1),
  ('lil-miquela-2', 'lil-miquela', null, null, true, null, 'Cultured', 'https://www.culturedmag.com/article/2019/04/23/lil-miquela', 2),
  ('lil-miquela-3', 'lil-miquela', null, null, true, null, 'FQ', 'https://fq.co.nz/fashions-new-favourite-influencer-is-a-virtual-avatar/', 3),
  ('lil-miquela-4', 'lil-miquela', null, null, true, null, 'Cultured', 'https://www.culturedmag.com/article/2019/04/23/lil-miquela', 4),
  ('lil-miquela-5', 'lil-miquela', null, null, true, null, 'Interview', 'https://www.interviewmagazine.com/culture/lil-miquela-instagram-avatar-flesh-blood-fanbase', 5),
  ('lil-miquela-6', 'lil-miquela', null, null, true, null, 'Hypebeast', 'https://hypebeast.com/2018/2/miquela-sousa-first-computer-generated-fashion-influencer', 6),
  ('imma-1', 'imma', null, null, true, null, 'Virtual Humans', 'https://www.virtualhumans.org/human/imma-gram', 1),
  ('imma-2', 'imma', null, null, true, null, 'Virtual Humans', 'https://virtualhumans.org/article/who-is-virtual-model-and-fashion-icon-imma', 2),
  ('imma-3', 'imma', null, null, true, null, 'Virtual Humans', 'https://www.virtualhumans.org/article/imma-grams-creator-m-on-her-ikea-partnership', 3),
  ('imma-4', 'imma', null, null, true, null, 'Virtual Humans', 'https://virtualhumans.org/article/who-is-virtual-model-and-fashion-icon-imma', 4),
  ('imma-5', 'imma', null, null, true, null, 'Virtual Humans', 'https://virtualhumans.org/article/who-is-virtual-model-and-fashion-icon-imma', 5),
  ('imma-6', 'imma', null, null, true, null, 'Virtual Humans', 'https://virtualhumans.org/article/who-is-virtual-model-and-fashion-icon-imma', 6),
  ('aitana-lopez-1', 'aitana-lopez', null, null, true, null, 'Euronews', 'https://www.euronews.com/2024/12/27/meet-the-first-spanish-ai-model-earning-up-to-10000-per-month', 1),
  ('aitana-lopez-2', 'aitana-lopez', null, null, true, null, 'Fortune', 'https://fortune.com/europe/2023/11/23/spanish-influencer-agency-earned-11000-ai-model-posers/', 2),
  ('aitana-lopez-3', 'aitana-lopez', null, null, true, null, 'Euronews', 'https://www.euronews.com/2024/12/27/meet-the-first-spanish-ai-model-earning-up-to-10000-per-month', 3),
  ('aitana-lopez-4', 'aitana-lopez', null, null, true, null, 'Geo News', 'https://www.geo.tv/latest/527842-whos-aitana-first-spanish-ai-model-making-up-to-10000-a-month', 4),
  ('aitana-lopez-5', 'aitana-lopez', null, null, true, null, 'Business Today', 'https://www.businesstoday.in/technology/news/story/meet-aitana-lopez-a-25-year-old-spanish-ai-model-earning-up-to-9-lakh-per-month-check-details-407198-2023-11-27', 5),
  ('aitana-lopez-6', 'aitana-lopez', null, null, true, null, '¡HOLA!', 'https://www.hola.com/us/lifestyle/20231128353116/aitana-spanish-ai-model/', 6)
on conflict (id) do update set
  character_slug = excluded.character_slug, credit = excluded.credit,
  credit_url = excluded.credit_url, position = excluded.position;

-- ---------- Every image belongs to a real character ----------
do $$
begin
  -- Any image pointing at a slug we don't know gets a placeholder character, so the key can be added.
  insert into public.characters (slug, name, owner, published)
    select distinct i.character_slug, initcap(replace(i.character_slug, '-', ' ')), null::uuid, false
    from public.images i left join public.characters c on c.slug = i.character_slug
    where c.slug is null
  on conflict (slug) do nothing;
  if not exists (select 1 from pg_constraint where conname = 'images_character_slug_fkey') then
    alter table public.images add constraint images_character_slug_fkey
      foreign key (character_slug) references public.characters(slug) on update cascade on delete cascade;
  end if;
end $$;

-- ---------- Check ----------
-- select slug, name, (select count(*) from public.images i where i.character_slug = c.slug and i.live) as live_images
-- from public.characters c order by sort;
