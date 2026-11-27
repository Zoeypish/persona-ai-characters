-- Shop the look: real product matches for the 18 site images.
-- Replaces the random links. Paste all of this into the Supabase SQL editor and press Run. Safe to run again.
-- Each product was picked by looking at the image and matching garment type, colour and style.

begin;

-- 1. Clear the old random links.
update public.persona_products set pin_ids = '{}' where pin_ids <> '{}';

-- 2. Link each matched product to the image(s) it belongs to.
update public.persona_products p set pin_ids = m.pins
from (values
  ('representclo.com', '7744557482193', array['aitana-lopez-1']::text[]), -- Represent: 247 Oversized Tank - Flat White
  ('representclo.com', '7688844247249', array['aitana-lopez-1']::text[]), -- Represent: Team 247 Star Tank - Flat White
  ('www.loveshackfancy.com', '8111107473593', array['aitana-lopez-1']::text[]), -- LoveShackFancy: Kudura Cropped Active Top
  ('khaite.com', '8067202285631', array['aitana-lopez-1']::text[]), -- Khaite: Angel Top in Chalk Cashmere Jersey
  ('ullajohnson.com', '7681278410848', array['aitana-lopez-1']::text[]), -- Ulla Johnson: Kyla Top - Ivory Melange
  ('www.rouje.com', '9605103911240', array['aitana-lopez-1']::text[]), -- Rouje: Top GALE
  ('khaite.com', '8067206086719', array['aitana-lopez-2']::text[]), -- Khaite: Val Top in Black
  ('staud.clothing', '8651709284525', array['aitana-lopez-2']::text[]), -- Staud: Lynelle Silk Tank | Black
  ('cultgaia.com', '8430456143946', array['aitana-lopez-2', 'imma-3']::text[]), -- Cult Gaia: ANDIE KNIT TOP - BLACK
  ('representclo.com', '7744557514961', array['aitana-lopez-2']::text[]), -- Represent: 247 Oversized Tank - Jet Black
  ('faithfullthebrand.com', '6987501764672', array['aitana-lopez-2']::text[]), -- Faithfull the Brand: Margot Top Black
  ('khaite.com', '8186961428543', array['aitana-lopez-2']::text[]), -- Khaite: Alice Tank in Black
  ('staud.clothing', '8306610962605', array['aitana-lopez-3']::text[]), -- Staud: Eva Sweater Dress | Heather Grey
  ('kith.com', '8287036964992', array['aitana-lopez-3', 'imma-6']::text[]), -- Kith: GUIZIO Rory Wide Shawl Cardigan - Heather Grey
  ('khaite.com', '8186967359551', array['aitana-lopez-3']::text[]), -- Khaite: Max Hoodie in Heather Grey
  ('www.aimeleondore.com', '9560750817377', array['aitana-lopez-3']::text[]), -- Aimé Leon Dore: Cashmere Embroidered Logo Hoodie
  ('mirrorpalais.com', '9626303168725', array['aitana-lopez-3', 'imma-6']::text[]), -- Mirror Palais: Drawstring Cardigan in Kitten Grey Sample
  ('cultgaia.com', '8430461354058', array['aitana-lopez-3']::text[]), -- Cult Gaia: LONA KNIT CARDIGAN - CHARCOAL
  ('representclo.com', '7904108773585', array['aitana-lopez-3']::text[]), -- Represent: Represent Owners Club Hoodie & Sweatpant Set - Ash Grey
  ('www.rouje.com', '9251484959048', array['aitana-lopez-4']::text[]), -- Rouje: Veste JASON
  ('faithfullthebrand.com', '7025889869888', array['aitana-lopez-4']::text[]), -- Faithfull the Brand: Enna Long Sleeve Blazer Charcoal
  ('www.loveshackfancy.com', '8217313673401', array['aitana-lopez-4']::text[]), -- LoveShackFancy: Icarus Cropped Lace-Trimmed Blazer
  ('faithfullthebrand.com', '6987514544192', array['aitana-lopez-4']::text[]), -- Faithfull the Brand: Lena Blazer Black - Final Sale
  ('faithfullthebrand.com', '6736941088832', array['aitana-lopez-4', 'imma-1']::text[]), -- Faithfull the Brand: Managua Shirt White - Final Sale
  ('wearebraindead.com', '8833971224707', array['aitana-lopez-4', 'imma-1']::text[]), -- Brain Dead: Brooks Brothers California Button Up - White Oxford
  ('kith.com', '8287035228288', array['aitana-lopez-5']::text[]), -- Kith: Marni Cotton Wool Knit Jacket - Lilac
  ('mirrorpalais.com', '9387950670037', array['aitana-lopez-5', 'lil-miquela-1']::text[]), -- Mirror Palais: Sicilia Top
  ('www.rouje.com', '9833782739272', array['aitana-lopez-5']::text[]), -- Rouje: Chemise HARPER
  ('representclo.com', '7817810968785', array['aitana-lopez-5']::text[]), -- Represent: R Pendant Necklace - Silver
  ('representclo.com', '7817811394769', array['aitana-lopez-5']::text[]), -- Represent: Doberman Pendant Necklace - Silver
  ('collinastrada.com', '15412022378797', array['aitana-lopez-5']::text[]), -- Collina Strada: SILVER SPRING STARLETTE NECKLACE
  ('cultgaia.com', '8430458503242', array['aitana-lopez-5']::text[]), -- Cult Gaia: DARYA EARRING - ANTIQUE SILVER
  ('www.loveshackfancy.com', '8084023115961', array['aitana-lopez-6']::text[]), -- LoveShackFancy: Klaudyna Polkadot Bikini
  ('www.loveshackfancy.com', '8084023345337', array['aitana-lopez-6']::text[]), -- LoveShackFancy: Zofia Gingham Eyelet Bikini
  ('ullajohnson.com', '7681285062752', array['aitana-lopez-6']::text[]), -- Ulla Johnson: Zahara Bra Cup Bikini Top - Plum
  ('www.loveshackfancy.com', '8095325847737', array['aitana-lopez-6']::text[]), -- LoveShackFancy: Candace Floral Striped Halter Bikini
  ('mirrorpalais.com', '9387950604501', array['aitana-lopez-6']::text[]), -- Mirror Palais: Búzios Bikini Top
  ('wearebraindead.com', '8706111471747', array['imma-1']::text[]), -- Brain Dead: Brooks Brothers California Half Placket Oxford Button Up - Natural
  ('wearebraindead.com', '8833973485699', array['imma-1']::text[]), -- Brain Dead: Brooks Brothers California 3 Pocket Button Up - White
  ('khaite.com', '8187014578239', array['imma-1']::text[]), -- Khaite: Marian Top in Black and Cream
  ('ullajohnson.com', '7520459948128', array['imma-2']::text[]), -- Ulla Johnson: Zeda V Neck Midi Dress - Olive
  ('www.motherdenim.com', '8703845761112', array['imma-2']::text[]), -- Mother Denim: Alix Of Bohemia Jasper Jacket - Olive
  ('wearebraindead.com', '8706108555395', array['imma-2']::text[]), -- Brain Dead: Military Shirt Jacket - Army
  ('houseofsunny.co.uk', '15655749517695', array['imma-2']::text[]), -- House of Sunny: CRUISE JACKET
  ('hanifa.co', '7750049300543', array['imma-2', 'imma-4']::text[]), -- Hanifa: Halo Chain Link Necklace
  ('cultgaia.com', '8019618922570', array['imma-2', 'imma-4']::text[]), -- Cult Gaia: VERA BRACELET - BRUSHED BRASS
  ('collinastrada.com', '15412022149421', array['imma-2']::text[]), -- Collina Strada: GOLD PARTY MIX PARTY MIX NECKLACE
  ('houseofsunny.co.uk', '15406286045567', array['imma-3']::text[]), -- House of Sunny: THE WESTERN JACKET
  ('fearofgod.com', '7716288004157', array['imma-3']::text[]), -- Fear of God: Denim Work Jacket
  ('ullajohnson.com', '7171569385568', array['imma-3']::text[]), -- Ulla Johnson: The Odette Jacket - Danube
  ('www.motherdenim.com', '8350227660888', array['imma-3']::text[]), -- Mother Denim: The Chisel Sneak - Natural Selection
  ('faithfullthebrand.com', '6987510906944', array['imma-3']::text[]), -- Faithfull the Brand: Ilride Pant White - Final Sale
  ('www.rouje.com', '8413366223176', array['imma-3', 'lil-miquela-6']::text[]), -- Rouje: Jean GERMAIN
  ('representclo.com', '7744557416657', array['imma-4']::text[]), -- Represent: 247 Oversized T-Shirt - Jet Black
  ('representclo.com', '7624811053265', array['imma-4']::text[]), -- Represent: Nylon Overshirt - Jet Black
  ('bode.com', '8735231475906', array['imma-4']::text[]), -- Bode: Riding Twill Lillian Jacket - Black
  ('www.motherdenim.com', '8412579987544', array['imma-4']::text[]), -- Mother Denim: The Bronco - Taken For Granite
  ('representclo.com', '7624812363985', array['imma-4']::text[]), -- Represent: R2S Split Denim - Soot
  ('mirrorpalais.com', '7590791545045', array['imma-5']::text[]), -- Mirror Palais: Strapless Supermodel Dress in Noir
  ('mirrorpalais.com', '8844950438101', array['imma-5']::text[]), -- Mirror Palais: Vamp Bustier Top in Noir
  ('mirrorpalais.com', '9244631630037', array['imma-5']::text[]), -- Mirror Palais: Ballet Corset Dress Lined in Noir
  ('staud.clothing', '8306609619117', array['imma-5']::text[]), -- Staud: Cece Dress | Espresso Black
  ('staud.clothing', '8764995993773', array['imma-5']::text[]), -- Staud: Marisole Velvet Dress | Black
  ('kith.com', '8287036473472', array['imma-5']::text[]), -- Kith: JADE Rumi Top - Black Crochet
  ('palomawool.com', '16415289115011', array['imma-6']::text[]), -- Paloma Wool: no 3208 / Women
  ('collinastrada.com', '10248965423405', array['imma-6']::text[]), -- Collina Strada: WHITE NO RAIN, NO FLOWERS RHINESTONE L/S GRAPHIC TEE
  ('collinastrada.com', '15412023034157', array['imma-6']::text[]), -- Collina Strada: ITS NICE RHINESTONE GRAPHIC TEE
  ('collinastrada.com', '15412022116653', array['imma-6']::text[]), -- Collina Strada: GOLD CLEAR PARTY MIX NECKLACE
  ('www.rouje.com', '9251493445960', array['lil-miquela-1']::text[]), -- Rouje: Top HUGO
  ('houseofsunny.co.uk', '15643915354495', array['lil-miquela-1']::text[]), -- House of Sunny: PINK POWER PEGGY
  ('collinastrada.com', '10334079844653', array['lil-miquela-1']::text[]), -- Collina Strada: PINK BROWN STRIPE WRAPPED CARDIO CREW
  ('wearebraindead.com', '9006640431235', array['lil-miquela-1']::text[]), -- Brain Dead: Brain Dead x Adidas Sweater - Rich Mauve
  ('khaite.com', '8067162144831', array['lil-miquela-2']::text[]), -- Khaite: Onno Jacket in Sky Blue Leather
  ('palomawool.com', '15655026688387', array['lil-miquela-2']::text[]), -- Paloma Wool: no 2429 / Bastian B
  ('houseofsunny.co.uk', '15822725579135', array['lil-miquela-2']::text[]), -- House of Sunny: TIFFANY BLUE FUR TRIM TAILORED BLAZER
  ('houseofsunny.co.uk', '15712997704063', array['lil-miquela-2']::text[]), -- House of Sunny: KING OF THE COURT
  ('houseofsunny.co.uk', '15686821314943', array['lil-miquela-2']::text[]), -- House of Sunny: PEGGY CARDIGAN
  ('wearebraindead.com', '8642580021379', array['lil-miquela-2', 'lil-miquela-4']::text[]), -- Brain Dead: Titanium Tani Post Modern Primitive Eye Protection - Matte Silver
  ('fearofgod.com', '7716284956733', array['lil-miquela-3']::text[]), -- Fear of God: Womens Classic Hoodie
  ('fearofgod.com', '7716281647165', array['lil-miquela-3']::text[]), -- Fear of God: 90s Long Sleeve Tee
  ('www.aimeleondore.com', '7384755306593', array['lil-miquela-3']::text[]), -- Aimé Leon Dore: ALD / Porsche Nylon Track Pant
  ('fearofgod.com', '7716283777085', array['lil-miquela-3']::text[]), -- Fear of God: Relaxed Sweatshort
  ('staud.clothing', '8306612076717', array['lil-miquela-3']::text[]), -- Staud: Sidney Sweater | Rouge
  ('houseofsunny.co.uk', '15643915977087', array['lil-miquela-4']::text[]), -- House of Sunny: BUTTER DOUBLE LAYER SECOND SKIN TOP
  ('houseofsunny.co.uk', '15643915059583', array['lil-miquela-4']::text[]), -- House of Sunny: BUTTER CABLE KNIT PEGGY
  ('cultgaia.com', '8430463057994', array['lil-miquela-4']::text[]), -- Cult Gaia: NALI KNIT CARDIGAN - SUNBEAM
  ('www.motherdenim.com', '8407794974808', array['lil-miquela-4']::text[]), -- Mother Denim: The Bronco Prep - Navy
  ('www.motherdenim.com', '8415534743640', array['lil-miquela-4']::text[]), -- Mother Denim: The Ripper - Navy
  ('khaite.com', '7831100948543', array['lil-miquela-5']::text[]), -- Khaite: Harvey Over-the-Knee High Boot in Zebra Print Haircalf and Black Suede
  ('cultgaia.com', '7746823028810', array['lil-miquela-5']::text[]), -- Cult Gaia: DANTE BOOT - BLACK
  ('staud.clothing', '7332856561837', array['lil-miquela-5']::text[]), -- Staud: Wally Boot | Black Suede
  ('representclo.com', '7714229551313', array['lil-miquela-5']::text[]), -- Represent: California Striped Henley Sweater - Jet Black Grey Marl
  ('bode.com', '8730151911618', array['lil-miquela-5']::text[]), -- Bode: Rib Stripe Heart Tee
  ('cultgaia.com', '8430464008266', array['lil-miquela-5']::text[]), -- Cult Gaia: PORTILLO TURTLENECK - BLACK
  ('www.motherdenim.com', '8437269725272', array['lil-miquela-6']::text[]), -- Mother Denim: The L/S Huddle - Going The Distance
  ('faithfullthebrand.com', '7294402101312', array['lil-miquela-6']::text[]), -- Faithfull the Brand: Sable Polo Shirt Luis Stripe Faded Butter
  ('faithfullthebrand.com', '7294403280960', array['lil-miquela-6']::text[]), -- Faithfull the Brand: Le Paz Top Luis Stripe Faded Butter
  ('representclo.com', '7688860795089', array['lil-miquela-6']::text[]), -- Represent: Represent Owners Club Rugby Polo - Chalk
  ('www.motherdenim.com', '7525936070744', array['lil-miquela-6']::text[])  -- Mother Denim: PETITES The Lil Hustler Ankle Fray - Fairest Of Them All
) as m(store_domain, external_id, pins)
where p.store_domain = m.store_domain and p.external_id = m.external_id;

commit;

-- 3. Check: each image should show 5 to 7 products.
select pin, count(*) as products from public.persona_products, unnest(pin_ids) as pin group by pin order by pin;
