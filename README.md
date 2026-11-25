# Persona

A minimal, high-end home for AI characters and the humans who create them.

- **Public site:** homepage gallery (`index.html`), character profiles (`profile.html?c=<slug>`), creator profile (`creator.html`), brand page (`brand.html`).
- **Creator Studio** (`studio.html`, sign in at `login.html`): Google sign-in, upload images, switch each image live or hidden. Creators start with 5 uploads and unlock 1 more for every 10 points.
- Plain HTML/CSS/JS, no build step. Content lives in `data.js`.

## Run locally
Serve the folder with any static server, for example `python3 -m http.server`, and open http://localhost:8000.
Without Supabase it runs in **demo mode**: uploads and choices are saved in your browser only.

## Deploy on Vercel
Import this repo in Vercel (framework preset: Other, no build command). That's it.

## Connect Supabase
1. In Supabase, open the SQL editor and run `supabase/schema.sql`.
2. Authentication → Providers → enable **Google** (needs a Google OAuth client ID and secret).
3. Authentication → URL Configuration → set Site URL to `https://<your-site>` and add `https://<your-site>/**` to Redirect URLs (otherwise Google sign-in returns to localhost:3000).
4. In Vercel → Project → Settings → Environment Variables, add `SUPABASE_URL` and `SUPABASE_ANON_KEY` (Project Settings → API in Supabase), then redeploy.
   (Or paste them into `config.js`. The anon key is public by design; access is protected by row-level security.)
5. Give a creator points: `update public.creators set points = points + 10 where id = '<user id>';`

Images of Lil Miquela, Imma and Aitana López belong to their creators and are shown with credit for demonstration.

## Shop products (persona_products)
1. Run `supabase/migrations/20261125_persona_products.sql` in the Supabase SQL editor.
2. Run `data/persona_products_import_part1.sql` … `part4.sql` in order (latest ~100 items from 20 brands, linked loosely to site pins via `pin_ids`).
3. Refresh: run the "Fetch brand products" GitHub Action; it rewrites `data/` (re-split the SQL or import `data/persona_products.csv`).
