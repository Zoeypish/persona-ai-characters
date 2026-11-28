// Content for the MVP. To move images to Cloudflare R2, set IMAGE_BASE to the
// bucket's public URL (e.g. "https://pub-xxxx.r2.dev/") and keep the same file names.
window.IMAGE_BASE = "images/";

window.CREATOR = {
  name: "Noor Vale",
  username: "noorvale",
  studio: "Vale Studio",
  location: "Toronto, Canada",
  bio: "Writer and 3D artist building AI characters with a story. Creator of Nova Reyes.",
  joined: "November 2026",
  characters: ["nova-reyes"],
};

window.CHARACTERS = [
  {
    slug: "lil-miquela",
    name: "Lil Miquela",
    handle: "@lilmiquela",
    link: "https://www.instagram.com/lilmiquela/",
    tagline: "The original virtual it-girl.",
    origin: "Los Angeles, USA",
    creator: "Brud (now part of Dapper Labs)",
    since: "2016",
    audience: "2.2M on Instagram",
    category: "Music · Fashion",
    bio: [
      "Miquela Sousa is a 19-year-old \"robot\" from Los Angeles and one of the first computer-generated characters to become a mainstream influencer.",
      "She has released pop singles, appeared in campaigns for Prada and Calvin Klein, and was named one of TIME's 25 most influential people on the internet in 2018. Her story, voice and look are written and directed by a human team."
    ],
    knownFor: ["Pop singles on Spotify", "Prada, Calvin Klein, Samsung", "TIME internet's most influential, 2018"],
  },
  {
    slug: "imma",
    name: "Imma",
    handle: "@imma.gram",
    link: "https://www.instagram.com/imma.gram/",
    tagline: "Tokyo's pink-bob virtual model.",
    origin: "Tokyo, Japan",
    creator: "Aww Inc.",
    since: "2018",
    audience: "378K on Instagram",
    category: "Fashion · Art · Culture",
    bio: [
      "Imma is a Japanese virtual model known for her signature pink bob and photo-real presence in everyday Tokyo scenes.",
      "She has fronted work for IKEA, Porsche, Amazon Fashion and SK-II, and famously \"lived\" in the window of IKEA's Harajuku store for three days in 2020. Aww Inc. builds her as a long-running character with her own taste in art and culture."
    ],
    knownFor: ["IKEA Harajuku residency, 2020", "Porsche, Amazon Fashion, SK-II", "Japan's first virtual model"],
  },
  {
    slug: "aitana-lopez",
    name: "Aitana López",
    handle: "@fit_aitana",
    link: "https://www.instagram.com/fit_aitana/",
    tagline: "The AI model who earns like a human one.",
    origin: "Barcelona, Spain",
    creator: "The Clueless agency",
    since: "2023",
    audience: "404K on Instagram",
    category: "Fitness · Gaming · Lifestyle",
    bio: [
      "Aitana is a 25-year-old pink-haired character from Barcelona, created by the agency The Clueless after it grew tired of working around human models' schedules.",
      "Her team plans her personality, posts and partnerships week by week. Reports put her earnings at up to €10,000 a month from brand deals, which made her the most-cited example of an AI character run as a business."
    ],
    knownFor: ["Up to €10K/month in brand deals", "Fitness and gaming content", "Built by a human creative agency"],
  },
  {
    slug: "nova-reyes",
    name: "Nova Reyes",
    handle: "@novareyes.ai",
    link: "creator.html",
    tagline: "A Persona original, made in the Studio.",
    origin: "Toronto, Canada",
    creator: "Noor Vale",
    creatorUsername: "noorvale",
    since: "2026",
    audience: "New on Persona",
    category: "Fashion · Music · Late nights",
    bio: [
      "Nova is a 23-year-old night-shift DJ and stylist who only exists after dark. She is the first character created directly on Persona.",
      "Her creator, Noor Vale, writes her story week by week and decides in the Persona Studio which images go live."
    ],
    knownFor: ["First Persona original", "Built and managed in the Studio", "Images curated by her creator"],
    builtIn: 0,
  },
];

window.CREDITS = {
 "lil-miquela": [
  [
   "Arab News",
   "https://www.arabnews.com/fashion/instagram-fashionista-miquela-sousa-casts-no-shadow-1307666"
  ],
  [
   "Cultured",
   "https://www.culturedmag.com/article/2019/04/23/lil-miquela"
  ],
  [
   "FQ",
   "https://fq.co.nz/fashions-new-favourite-influencer-is-a-virtual-avatar/"
  ],
  [
   "Cultured",
   "https://www.culturedmag.com/article/2019/04/23/lil-miquela"
  ],
  [
   "Interview",
   "https://www.interviewmagazine.com/culture/lil-miquela-instagram-avatar-flesh-blood-fanbase"
  ],
  [
   "Hypebeast",
   "https://hypebeast.com/2018/2/miquela-sousa-first-computer-generated-fashion-influencer"
  ]
 ],
 "imma": [
  [
   "Virtual Humans",
   "https://www.virtualhumans.org/human/imma-gram"
  ],
  [
   "Virtual Humans",
   "https://virtualhumans.org/article/who-is-virtual-model-and-fashion-icon-imma"
  ],
  [
   "Virtual Humans",
   "https://www.virtualhumans.org/article/imma-grams-creator-m-on-her-ikea-partnership"
  ],
  [
   "Virtual Humans",
   "https://virtualhumans.org/article/who-is-virtual-model-and-fashion-icon-imma"
  ],
  [
   "Virtual Humans",
   "https://virtualhumans.org/article/who-is-virtual-model-and-fashion-icon-imma"
  ],
  [
   "Virtual Humans",
   "https://virtualhumans.org/article/who-is-virtual-model-and-fashion-icon-imma"
  ]
 ],
 "aitana-lopez": [
  [
   "Euronews",
   "https://www.euronews.com/2024/12/27/meet-the-first-spanish-ai-model-earning-up-to-10000-per-month"
  ],
  [
   "Fortune",
   "https://fortune.com/europe/2023/11/23/spanish-influencer-agency-earned-11000-ai-model-posers/"
  ],
  [
   "Euronews",
   "https://www.euronews.com/2024/12/27/meet-the-first-spanish-ai-model-earning-up-to-10000-per-month"
  ],
  [
   "Geo News",
   "https://www.geo.tv/latest/527842-whos-aitana-first-spanish-ai-model-making-up-to-10000-a-month"
  ],
  [
   "Business Today",
   "https://www.businesstoday.in/technology/news/story/meet-aitana-lopez-a-25-year-old-spanish-ai-model-earning-up-to-9-lakh-per-month-check-details-407198-2023-11-27"
  ],
  [
   "¡HOLA!",
   "https://www.hola.com/us/lifestyle/20231128353116/aitana-spanish-ai-model/"
  ]
 ]
};

window.imagesFor = function (c) {
  var count = c.builtIn === undefined ? 6 : c.builtIn, list = [];
  for (var k = 1; k <= count; k++) list.push(k);
  return list.map(function (n) {
    var cr = (window.CREDITS[c.slug] || [])[n - 1] || [];
    return { id: c.slug + "-" + n, src: window.IMAGE_BASE + c.slug + "-" + n + ".jpg", alt: c.name + ", image " + n, credit: cr[0], creditUrl: cr[1] };
  });
};

// ---------- Search keywords ----------
// Style keywords for each character, and for each built-in image: its styles and what is in it
// (garments, colours). Search ranks: names/usernames first, then styles, then item names, then brands.
window.SEARCH_TAGS = {
  characters: {
    "lil-miquela": ["streetwear", "y2k", "vintage", "preppy", "casual", "colorful", "music", "la"],
    "imma": ["minimal", "chic", "streetwear", "casual", "art", "tokyo", "pink hair", "bob"],
    "aitana-lopez": ["sporty", "athleisure", "chic", "minimal", "fitness", "gaming", "pink hair", "barcelona"],
    "nova-reyes": ["party", "edgy", "evening", "streetwear", "music", "dj", "night"],
  },
  pins: {
    "aitana-lopez-1": { styles: ["sporty", "athleisure", "minimal", "casual"], words: ["white", "tank", "crop top", "top", "activewear", "fitness"] },
    "aitana-lopez-2": { styles: ["minimal", "edgy", "evening", "chic"], words: ["black", "tank", "top"] },
    "aitana-lopez-3": { styles: ["cozy", "casual", "minimal"], words: ["grey", "hoodie", "sweater", "knit", "cardigan", "loungewear"] },
    "aitana-lopez-4": { styles: ["classic", "office", "chic", "minimal"], words: ["blazer", "jacket", "white", "shirt", "grey", "black"] },
    "aitana-lopez-5": { styles: ["chic", "feminine", "romantic"], words: ["pink", "blazer", "jacket", "necklace", "jewelry"] },
    "aitana-lopez-6": { styles: ["resort", "beach", "summer", "feminine"], words: ["bikini", "swim", "swimwear", "pink", "palm"] },
    "imma-1": { styles: ["chic", "minimal", "evening", "party"], words: ["silk", "shirt", "cream", "white", "beige", "night out"] },
    "imma-2": { styles: ["minimal", "chic", "classic"], words: ["shirt dress", "dress", "green", "olive", "gold", "jewelry", "bracelet", "yellow"] },
    "imma-3": { styles: ["streetwear", "casual", "denim"], words: ["denim", "jacket", "black", "top", "white", "pants", "cargo", "blue", "ikea"] },
    "imma-4": { styles: ["edgy", "streetwear", "casual", "denim"], words: ["black", "top", "tee", "jeans", "denim", "jacket", "leather", "gold", "jewelry", "blue"] },
    "imma-5": { styles: ["evening", "artsy", "party", "minimal"], words: ["black", "dress", "gold", "art"] },
    "imma-6": { styles: ["casual", "cozy", "streetwear"], words: ["graphic tee", "tee", "t-shirt", "cardigan", "grey", "white", "necklace", "jewelry"] },
    "lil-miquela-1": { styles: ["casual", "minimal"], words: ["pink", "tee", "t-shirt", "top", "freckles", "buns"] },
    "lil-miquela-2": { styles: ["streetwear", "sporty", "y2k"], words: ["track jacket", "bomber", "jacket", "blue", "sunglasses"] },
    "lil-miquela-3": { styles: ["cozy", "streetwear", "casual", "beach"], words: ["red", "hoodie", "sweatshirt", "sweatpants", "sweatsuit"] },
    "lil-miquela-4": { styles: ["y2k", "vintage", "casual", "denim", "colorful"], words: ["overalls", "denim", "yellow", "top", "sunglasses", "blue"] },
    "lil-miquela-5": { styles: ["edgy", "streetwear"], words: ["black", "sweater", "knit", "stripes", "white", "leather", "boots", "shoes"] },
    "lil-miquela-6": { styles: ["preppy", "vintage", "casual", "colorful"], words: ["rugby", "polo", "stripes", "yellow", "white", "pants", "belt"] },
  },
};
