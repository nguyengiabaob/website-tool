# YouTube Shorts Loop

Small demo app that scrapes a channel's Shorts tab (using Puppeteer) and plays the Shorts in an embedded YouTube iframe player that loops forward and reverse.

Warning: This project uses Puppeteer which downloads Chromium (large). Only run on a machine with enough disk space.

Setup

1. Install dependencies:

```powershell
cd "D:/Project/New folder (4)/New folder"
npm install
```

2. Start the server:

```powershell
node server.js
# or for development
nodemon server.js
```

3. Open http://localhost:3000

Usage

- Paste a channel URL (e.g. https://www.youtube.com/@AnimeHouse2658) and click Fetch.
- The backend uses Puppeteer to load the channel's Shorts page, scroll, and collect video IDs, then checks each video's duration and returns Shorts (<=60s).
- The frontend embeds videos using the YouTube IFrame API and automatically advances; after hitting the end it reverses direction and continues looping.

Notes

- Puppeteer is resource-heavy. For production, reuse a single browser instance and add caching + rate limiting.
- Scraping YouTube may violate their Terms of Service — review before deploying publicly.

# YouTube Shorts Loop

Small demo app that fetches YouTube Shorts from a channel and displays them in a continuous forward/reverse loop. Includes a Node.js proxy to keep the API key off the client.

Setup

1. Copy `.env.example` to `.env` and set `YOUTUBE_API_KEY`.
2. Install dependencies:

```bash
cd "D:/Project/New folder (4)/New folder"
npm install
```

3. Start the server:

```bash
npm start
```

4. Open http://localhost:3000 in your browser.

Usage

-- Enter a full channel URL (for example: `https://www.youtube.com/c/CHANNEL_NAME` or `https://www.youtube.com/@username`) and click `Fetch`.
-- Click `Load More` to fetch additional pages of results (scraped continuations when available).
-- The scraper fetches videos from the channel's `/shorts` page and displays Shorts in a forward/reverse loop indefinitely.

Notes

- This project uses the YouTube Data API v3. Ensure your API key has quota.
- For production, consider stricter rate-limiting, caching, and hiding the API key in a secure backend.

# Next.js Fullstack Profile Page

Minimal Next.js project containing a personal profile page for a Fullstack Software Engineer.

Quick start

1. Install dependencies with Yarn (requires Node 16+):

```bash
yarn install
```

2. Run development server:

```bash
yarn dev
```

Open http://localhost:3000 to view the profile page.

Files added

- `package.json` — project configuration and scripts
- `pages/profile.js` — the profile page
- `pages/index.js` — redirects to `/profile`
- `pages/_app.js` — global stylesheet loader
- `styles/global.css` — basic styles
- `pages/portfolio.js` — portfolio with project cards

You can customize the content in `pages/profile.js` for your name, bio, experience, and links. Visit `/portfolio` to see and edit the sample projects.
