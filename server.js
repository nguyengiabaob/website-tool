const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

// Import the optimized scraper handler
const scrapeHandler = require("./api/puppeteer-scrape");

const app = express();
app.use(cors());
app.use(express.json());

// Puppeteer-based scraper endpoint - uses the same handler as Vercel
app.get("/api/puppeteer-scrape", scrapeHandler);

// Serve static frontend
const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}`)
);
