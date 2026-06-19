// Build Watch scraper
// Fetches prebuilt PC listings from Canadian retailers and writes docs/listings.json
// for the static page (and the GitHub Actions workflow) to use.
//
// Run locally first: `npm install` then `node scrape.js`
// Check the console output and docs/listings.json before trusting the schedule.

import { writeFile, mkdir } from 'node:fs/promises';
import * as cheerio from 'cheerio';

const BUDGET = 2000; // CAD ceiling — change this any time, listings up to BUDGET*1.15 are kept (a little over-budget is still useful context)

const SOURCES = [
  {
    name: 'Canada Computers',
    url: 'https://www.canadacomputers.com/en/932/gaming-desktop-pcs?order=product.price.asc',
    parse: parseCanadaComputers
  },
  {
    name: 'Newegg.ca',
    url: 'https://www.newegg.ca/Gaming-Desktop-PC/SubCategory/ID-3742?Order=1', // Order=1 sorts low-to-high price
    parse: parseNewegg
  },
  {
    name: 'Memory Express',
    url: 'https://www.memoryexpress.com/Category/DesktopComputers?FilterID=2e413559-0182-1014-4547-d1dbca418ecd',
    parse: parseMemoryExpress
  },
  {
    name: 'Best Buy Canada',
    url: 'https://www.bestbuy.ca/en-ca/category/gaming-desktop-computers/30441',
    parse: parseBestBuy
  }
  // Each retailer renders differently, so each gets its own parse function above —
  // see README.md "Adding another retailer" for the pattern if you want a fifth.
];

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      // A normal browser user-agent — some retail sites block bare "node-fetch" requests.
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept-Language': 'en-CA,en;q=0.9'
    }
  });
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  return res.text();
}

// Pulls "$1,899.00" style numbers out of a text blob.
function extractPrices(text) {
  return [...text.matchAll(/\$[\d,]+\.\d{2}/g)].map(m => parseFloat(m[0].replace(/[$,]/g, '')));
}

function extractSpec(text, regex, numeric = false) {
  const m = text.match(regex);
  if (!m) return numeric ? null : '';
  return numeric ? parseInt(m[1], 10) : m[0];
}

// Titles often mention GB twice — once for GPU VRAM ("RTX 5060 Ti 16GB"), once for
// system RAM ("16GB DDR5" or "16GB, 1TB SSD"). This walks every GB match and skips
// ones immediately preceded by a GPU model number or a Ti/XT suffix.
function extractRam(title) {
  const matches = [...title.matchAll(/(\d{1,3})\s?GB/gi)];
  for (const m of matches) {
    const start = m.index;
    const before6 = title.slice(Math.max(0, start - 6), start).replace(/\s+$/, '');
    if (/Ti$|XT$|\d{4}$/i.test(before6)) continue; // looks like it followed a GPU name — VRAM, not RAM
    return parseInt(m[1], 10);
  }
  return null;
}

function parseCanadaComputers(html, sourceUrl) {
  const $ = cheerio.load(html);
  const results = [];
  const seen = new Set();

  // Product detail links live under /en/armoury-gaming-desktops/<id>/... or /en/gaming-desktop-pcs/<id>/...
  // This pattern is more stable across redesigns than a specific CSS class name.
  $('a[href*="/armoury-gaming-desktops/"], a[href*="/gaming-desktop-pcs/"]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || !/\/\d+\//.test(href)) return; // skip category/nav links without a numeric product id

    const fullUrl = href.startsWith('http') ? href : new URL(href, sourceUrl).toString();
    const title = $(el).text().trim();
    if (!title || title.length < 8) return; // skip empty or image-only links to the same product

    if (seen.has(fullUrl)) return;

    // Walk up to a container that should also hold the price text near this title.
    const container = $(el).closest('div, li, article');
    const priceText = container.text();
    const prices = extractPrices(priceText);
    if (prices.length === 0) return;

    const regular = Math.max(...prices);
    const sale = prices.length > 1 ? Math.min(...prices) : 0;
    const effective = sale > 0 ? sale : regular;
    if (effective > BUDGET * 1.15) return; // drop listings way over budget, keep a little headroom for context

    seen.add(fullUrl);
    results.push({
      title,
      store: 'Canada Computers',
      url: fullUrl,
      cpu: extractSpec(title, /(?:Ryzen \d+ \S+|(?:Core )?Ultra \d \S+|(?:Core )?i\d \S+)/i) || '',
      gpu: extractSpec(title, /(?:RTX \d{4}(?: ?Ti)?|RX \d{4}(?: ?XT)?)/i) || '',
      ram: extractRam(title),
      price: regular,
      sale,
      scrapedAt: new Date().toISOString()
    });
  });

  return results;
}

function parseNewegg(html, sourceUrl) {
  const $ = cheerio.load(html);
  const results = [];
  const seen = new Set();

  // Newegg.ca product pages all live under a /p/N82E... path.
  $('a[href*="/p/N82E"]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const fullUrl = href.startsWith('http') ? href : new URL(href, sourceUrl).toString();
    const title = $(el).text().trim();
    if (!title || title.length < 8 || seen.has(fullUrl)) return;

    const container = $(el).closest('div, li, article');
    const prices = extractPrices(container.text());
    if (prices.length === 0) return;

    const regular = Math.max(...prices);
    const sale = prices.length > 1 ? Math.min(...prices) : 0;
    const effective = sale > 0 ? sale : regular;
    if (effective > BUDGET * 1.15) return;

    seen.add(fullUrl);
    results.push({
      title,
      store: 'Newegg.ca',
      url: fullUrl,
      cpu: extractSpec(title, /(?:Ryzen\s*R?\d+[\w-]*|(?:Core )?Ultra \d \S+|(?:Core )?i\d[\w-]*)/i) || '',
      gpu: extractSpec(title, /(?:RTX \d{4}(?: ?Ti)?|RX \d{4}(?: ?XT)?)/i) || '',
      ram: extractRam(title),
      price: regular,
      sale,
      scrapedAt: new Date().toISOString()
    });
  });

  return results;
}

function parseMemoryExpress(html, sourceUrl) {
  const $ = cheerio.load(html);
  const results = [];
  const seen = new Set();

  // Memory Express product pages all live under /Products/MX######.
  $('a[href*="/Products/MX"]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const fullUrl = href.startsWith('http') ? href : new URL(href, sourceUrl).toString();
    const title = $(el).text().trim();
    if (!title || title.length < 8 || seen.has(fullUrl)) return;

    const container = $(el).closest('div, li, article');
    const prices = extractPrices(container.text());
    if (prices.length === 0) return;

    const regular = Math.max(...prices);
    const sale = prices.length > 1 ? Math.min(...prices) : 0;
    const effective = sale > 0 ? sale : regular;
    if (effective > BUDGET * 1.15) return;

    seen.add(fullUrl);
    results.push({
      title,
      store: 'Memory Express',
      url: fullUrl,
      cpu: extractSpec(title, /(?:Ryzen\s*R?\d+[\w-]*|(?:Core )?Ultra \d \S+|(?:Core )?i\d[\w-]*)/i) || '',
      gpu: extractSpec(title, /(?:RTX \d{4}(?: ?Ti)?|RX \d{4}(?: ?XT)?)/i) || '',
      ram: extractRam(title),
      price: regular,
      sale,
      scrapedAt: new Date().toISOString()
    });
  });

  return results;
}

function parseBestBuy(html, sourceUrl) {
  const $ = cheerio.load(html);
  const results = [];
  const seen = new Set();

  // Best Buy Canada doesn't show "$X $Y" side by side like the other three — it shows
  // the current price plus a separate "SAVE $N" delta, so the original price has to be
  // reconstructed rather than read directly.
  $('a[href*="/en-ca/product/"]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || !/\/\d+$/.test(href)) return; // skip nav links without a trailing numeric SKU
    const fullUrl = href.startsWith('http') ? href : new URL(href, sourceUrl).toString();
    const title = $(el).text().trim();
    if (!title || title.length < 8 || seen.has(fullUrl)) return;

    const container = $(el).closest('div, li, article');
    const containerText = container.text();
    const prices = extractPrices(containerText);
    if (prices.length === 0) return;

    const current = prices[0]; // Best Buy repeats the same current price twice, no separate original
    const saveMatch = containerText.match(/SAVE \$([\d,]+(?:\.\d{2})?)/i);
    const savings = saveMatch ? parseFloat(saveMatch[1].replace(/,/g, '')) : 0;
    const regular = current + savings;
    const sale = savings > 0 ? current : 0;
    if (current > BUDGET * 1.15) return;

    seen.add(fullUrl);
    results.push({
      title,
      store: 'Best Buy Canada',
      url: fullUrl,
      cpu: extractSpec(title, /(?:Ryzen\s*R?\d+[\w-]*|(?:Core )?Ultra \d \S+|(?:Core )?i\d[\w-]*)/i) || '',
      gpu: extractSpec(title, /(?:RTX \d{4}(?: ?Ti)?|RX \d{4}(?: ?XT)?)/i) || '',
      ram: extractRam(title),
      price: regular,
      sale,
      scrapedAt: new Date().toISOString()
    });
  });

  return results;
}

async function main() {
  const all = [];
  for (const source of SOURCES) {
    try {
      console.log(`Fetching ${source.name}...`);
      const html = await fetchHtml(source.url);
      const items = source.parse(html, source.url);
      console.log(`  found ${items.length} listings under ~$${Math.round(BUDGET * 1.15)}`);
      if (items.length === 0) {
        console.log('  zero results usually means the site changed its layout — see README.md "If a scrape comes back empty"');
      }
      all.push(...items);
    } catch (err) {
      console.error(`  failed: ${err.message}`);
    }
  }

  all.sort((a, b) => (a.sale || a.price) - (b.sale || b.price));

  await mkdir('docs', { recursive: true });
  await writeFile(
    'docs/listings.json',
    JSON.stringify({ generatedAt: new Date().toISOString(), budget: BUDGET, listings: all }, null, 2)
  );
  console.log(`Wrote ${all.length} total listings to docs/listings.json`);
}

main();
