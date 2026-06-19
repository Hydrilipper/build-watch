# Build Watch Scraper

Automatically checks four Canadian retailers' gaming desktop listings once a day
and publishes anything under budget to a free, auto-updating webpage. No server,
no hosting bill — runs entirely on GitHub's free tier.

**Sources:** Canada Computers, Newegg.ca, Memory Express, Best Buy Canada — all
confirmed to serve plain server-rendered HTML with the data already in the page,
so no headless browser is needed.

## How it fits together

```
scrape.js              → fetches the listing page, parses it, writes docs/listings.json
.github/workflows/      → tells GitHub to run scrape.js once a day and commit the result
  scrape.yml
docs/index.html         → the actual page people visit — reads listings.json and renders cards
docs/listings.json      → the data file the scraper writes to (seeded with a snapshot already)
```

GitHub Pages serves whatever is in `docs/`, so `docs/index.html` becomes your live URL,
and `docs/listings.json` next to it is just a regular file the page fetches.

## Setup (one-time, ~10 minutes)

1. **Create a new GitHub repo.** Public — GitHub Pages' free tier requires a public repo
   unless you're on a paid plan.
2. **Push these files into it** (this whole folder, as-is).
3. **Turn on GitHub Pages.** Repo → Settings → Pages → under "Build and deployment",
   set Source to "Deploy from a branch", branch `main`, folder `/docs`. Save.
   Your page will be live at `https://<your-username>.github.io/<repo-name>/`.
4. **Turn on Actions** if it isn't already (Settings → Actions → General → Allow all actions).
5. **Run it once manually** to confirm it works: Actions tab → "Scrape PC deals" →
   "Run workflow" button → Run. Watch the log.
6. After that, it runs on its own daily (see the cron schedule in `scrape.yml` —
   times are UTC, adjust the hour if you want it to run at a different local time).

## Verify it locally before trusting the schedule

```
npm install
node scrape.js
```

This writes `docs/listings.json` and prints how many listings it found for each
of the four sources. I tested the price/spec extraction logic against real data
from each site and against realistic HTML fixtures for each parser, but I couldn't
execute a live network request to any of these four domains from my own sandbox to
confirm the scrape end-to-end — so this local run is worth doing before you let the
schedule run unattended.

## If a scrape comes back empty

Retail sites redesign their pages without warning, and that's the most common way
a scraper like this breaks. The console output names which source failed — if
`node scrape.js` reports 0 results for one of the four:

1. Open that retailer's listing page in a normal browser, right-click a product card, "Inspect".
2. Check the product link pattern that source's parser looks for still holds:
   - Canada Computers: URL contains `/armoury-gaming-desktops/` or `/gaming-desktop-pcs/` followed by a number
   - Newegg.ca: URL contains `/p/N82E`
   - Memory Express: URL contains `/Products/MX`
   - Best Buy Canada: URL contains `/en-ca/product/` and ends in a number
3. If the pattern changed, update the corresponding `parse...()` function in
   `scrape.js`, then re-run `node scrape.js` to confirm.

A single source failing doesn't stop the others — each is wrapped in its own
try/catch, so one broken parser just means one site's listings are missing
until you fix it, not that the whole run fails.

## Adding another retailer

Each retailer renders its listings differently, so each needs its own `parse...()`
function — copy the shape of `parseCanadaComputers()` (or `parseNewegg`, etc.),
point it at the new site's listing URL, and add it to the `SOURCES` array at the
top of `scrape.js`. Uniway Computers and the various boutique builders (Stoneforged,
TECHNOID, etc.) are reasonable next additions if you want even more coverage.

## Changing the budget

Edit `BUDGET` near the top of `scrape.js` — that controls what the scraper keeps.
The number on the webpage itself is just a display filter (saved in your browser),
so visitors can narrow further without needing a new scrape.
