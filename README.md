# Persona

A minimal, high-end home for AI characters and the humans who create them.

- **Public site:** homepage gallery (`index.html`), character profiles (`profile.html?c=<slug>`), creator profile (`creator.html`), brand page (`brand.html`).
- **Creator Studio** (`studio.html`, sign in at `login.html`): Google sign-in, upload images, switch each image live or hidden. Creators start with 5 uploads and unlock 1 more for every 10 points.
- **Character registry, Shot builder and Drift guard** (Studio tabs, `studio-registry.js`, `lib/shot.js`): a versioned spec per character (identity, locked traits, reference sheet), camera and scene presets (`templates/presets.json`), a prompt compiler for each image tool, a model router that weighs cost, a wardrobe from the product catalog, forkable recipe JSON, and checks for off-model or repetitive images. Switch on with `supabase/character-registry.sql`. The optional face-match score needs `FACE_MATCH_URL` / `FACE_MATCH_KEY` (see `api/_lib/facematch.js`).
- **Character blocks and Combine** (Studio → Combine tab, `studio-blocks.js`, `lib/blocks.js`): small typed JSON blocks (face, body, hair, wardrobe, camera, light, location, mood, pose, motion, scene) addressed like `face@sienna/v2`. Pick blocks, preview the prompt, save as a new character or a new spec version, and publish or share your own blocks (JSON, file or link). Authors get 1 point the first time another person uses a block. Faces must be confirmed as invented, and 3 reports hide a block. Format: `templates/block-template.json`; starters: `templates/starter-blocks.json` (rebuild with `node scripts/build-blocks.js`). Switch on with `supabase/character-blocks.sql`.
- Plain HTML/CSS/JS, no build step. Content lives in `data.js`.

## Generate images in Studio (free tier)
Studio → Shot builder → **Build prompt**, then **Generate here** makes images from the compiled prompt, one at a time or in a
small batch (up to 8: the same shot with new seeds, or a fresh set-up for each image so the batch doesn't repeat itself).
Tick the ones to keep and save them: they become hidden drafts with the AI label, an origin record (model, prompt, seed, recipe),
the rights confirmation and the shot recipe for the drift guard. Saving uses the normal upload allowance.
- **Model:** FLUX.1 [schnell] on Cloudflare Workers AI (Apache 2.0, commercial use OK). Free: 10,000 neurons a day per Cloudflare
  account, reset 00:00 UTC, roughly 55 to 170 square 1024px images. On the Workers Free plan Cloudflare simply stops at the
  allowance, so there is no bill.
- **Limits:** 20 images per creator and 80 for the whole site per UTC day (change with `GEN_DAILY_PER_CREATOR`, `GEN_DAILY_SITE`).
  Only a character's owner can generate for it. Prompts that point to a real or famous person are refused, and every prompt starts
  with "Fictional person with an invented face".
- **Setup:** run `supabase/image-generation.sql` once. In Cloudflare (free account): copy your **Account ID** (dashboard home,
  right side, or Workers AI → Use REST API), then **Create a Workers AI API token** on that same page. In Vercel → Settings →
  Environment Variables add `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`, then redeploy.
- **Paid model later:** providers live in `api/_lib/imagegen.js`. Set `IMAGE_PROVIDER=openai-gpt-image` and `OPENAI_API_KEY`
  to switch to GPT Image (portrait 1024x1536), or add another provider there with the same `run({ prompt, seed })` shape.
  The Shot builder automatically uses the matching prompt format.

## Search
The search box (header) and `search.html?q=` search characters, images and brand products together.
Every item has keywords, and results are ranked in this order:
1. **Names**: character name, @handle, creator name/username.
2. **Styles**: streetwear, minimal, boho, y2k... (the item's own styles beat styles it gets from its brand or character).
3. **Item**: what it is and its colour (product title, "dress", "black", "denim", incl. French names like "robe").
4. **Brand**.

Keywords live in `data.js` (`SEARCH_TAGS`, for characters and the built-in images) and `search-index.json` (products).
After refreshing the product list, rebuild the index: `python3 scripts/build-search-index.py path/to/persona_products.csv`.

## Homepage feed
The homepage ("All") is a personal mix for each visitor, built in `feed.js`:
- **50%** pins from characters they follow
- **35%** pins similar to what they follow (shared style keywords from `SEARCH_TAGS` in `data.js`)
- **15%** random pins from everyone else

Pins they haven't seen yet come first, newest first; pins already seen move to the end, so the top of the feed keeps changing.
A pin counts as seen once half of it has been on screen (kept in the visitor's browser, like follows and saves).
If they follow nobody, "similar" uses their saved pins; with no follows and no saves the feed is fresh pins from everyone.
Pins from the same character are still never side by side or stacked.

## Accounts and safety
- **Saves and follows** are stored in the signed-in person's account (Supabase tables `saves`, `follows`). Visitors keep them in their browser; on sign-in those are added to the account. Signing out clears this device's copy.
- **Rights**: creators tick a box before uploading or creating a character (owns the images, no real person without consent). Connect AI keys require the same agreement. Stored as `images.rights_confirmed`.
- **AI label + origin record**: every pin shows an "AI" tag; the closeup has an origin record (made by, AI tool, date, prompt/recipe, source, rights).
- **Reports**: "Report this image" in the closeup (signed-in, once per person). 3 reports hide an image until an admin decides on `review.html`. Anyone can send a request on `takedown.html`.
- **Policy pages**: `content-policy.html`, `terms.html`.
- Setup: run `supabase/accounts-and-safety.sql` once, then add yourself to `admins` (line at the bottom of the file).

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

## Library (Persona House looks)
`library.html` shows the house fashion library: 188 popular looks from public Pinterest fashion boards, each broken into blocks
(face, body, hair, outfit, camera, light, location, scene, motion, mood, pose) with View JSON and Copy per block, plus Copy all
(a character recipe that Studio > Combine can paste). The reference photo is shown with Pinterest's own embed and links back to the
pin; nothing is copied from it except our written description. Faces are invented. Source notes: `templates/library/`;
rebuild with `node scripts/build-library.js` (writes `templates/library.json` and `supabase/house-library.sql`).
Run `supabase/house-library.sql` once (after `character-blocks.sql`) to make the blocks show up in Combine.
