const express = require("express");
let puppeteer;
let chromeAwsLambda = null;
try {
  if (process.env.VERCEL || process.env.AWS_REGION) {
    chromeAwsLambda = require("chrome-aws-lambda");
    puppeteer = require("puppeteer-core");
  } else {
    puppeteer = require("puppeteer");
  }
} catch (e) {
  try {
    puppeteer = require("puppeteer");
  } catch (e2) {
    console.error("Failed to require puppeteer packages:", e, e2);
    throw e2 || e;
  }
}
const cors = require("cors");
const path = require("path");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

// Puppeteer-based scraper endpoint
app.get("/api/puppeteer-scrape", async (req, res) => {
  try {
    const { channelUrl, limit } = req.query;
    if (!channelUrl)
      return res.status(400).json({ error: "Missing channelUrl parameter" });
    const max = Math.min(parseInt(limit || "50", 10), 200);

    let base = channelUrl.trim();
    if (!/^https?:\/\//i.test(base)) base = "https://" + base;
    const shortsUrl = /\/shorts(\/|$)/i.test(base)
      ? base
      : base.replace(/\/?$/, "") + "/shorts";

    // Build Puppeteer launch options and allow overriding executable via env
    const launchOpts = {
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    };
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      launchOpts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    } else {
      try {
        const defaultPath =
          puppeteer.executablePath && puppeteer.executablePath();
        if (defaultPath) launchOpts.executablePath = defaultPath;
      } catch (e) {}
    }

    let browser;
    try {
      browser = await puppeteer.launch(launchOpts);
    } catch (launchErr) {
      console.error("Puppeteer launch failed:", launchErr);
      return res.status(500).json({
        error:
          "Failed to launch Chromium/Chrome. Set PUPPETEER_EXECUTABLE_PATH to a valid browser binary (e.g. C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe), or run `npm install puppeteer` to download Chromium.",
      });
    }
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );
    await page.setViewport({ width: 1200, height: 800 });

    await page
      .goto(shortsUrl, { waitUntil: "networkidle2", timeout: 30000 })
      .catch(() => {});

    const start = Date.now();
    const ids = new Set();
    while (ids.size < max && Date.now() - start < 20000) {
      const newIds = await page.evaluate(() => {
        const out = [];
        document
          .querySelectorAll('a[href*="/shorts/"], a[href*="watch?v="]')
          .forEach((a) => {
            const href = a.getAttribute("href");
            if (!href) return;
            let id = null;
            if (href.includes("/shorts/"))
              id = href.split("/shorts/").pop().split(/[?#]/)[0];
            else if (href.includes("watch?v=")) {
              try {
                id = new URL(href, "https://youtube.com").searchParams.get("v");
              } catch (e) {}
            }
            if (id) out.push(id);
          });
        return out;
      });
      newIds.forEach((i) => ids.add(i));
      await page.evaluate(() => window.scrollBy(0, window.innerHeight));
      await page.waitForTimeout(700);
    }

    const idList = Array.from(ids).slice(0, max);
    const results = [];
    for (const id of idList) {
      try {
        // If running under chrome-aws-lambda (Vercel/AWS Lambda), use its args
        if (chromeAwsLambda) {
          launchOpts.args = (chromeAwsLambda.args || []).concat(
            launchOpts.args
          );
          launchOpts.headless = chromeAwsLambda.headless;
          try {
            // executablePath is async for chrome-aws-lambda
            launchOpts.executablePath =
              process.env.PUPPETEER_EXECUTABLE_PATH ||
              (await chromeAwsLambda.executablePath);
          } catch (e) {
            // ignore and let puppeteer-core try
          }
        } else if (process.env.PUPPETEER_EXECUTABLE_PATH) {
          launchOpts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
        } else {
          try {
            const defaultPath =
              puppeteer.executablePath && puppeteer.executablePath();
            if (defaultPath) launchOpts.executablePath = defaultPath;
          } catch (e) {}
        }
        const watchUrl = `https://www.youtube.com/watch?v=${id}`;
        const p = await browser.newPage();
        await p.setUserAgent(
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        );
        await p
          .goto(watchUrl, { waitUntil: "networkidle2", timeout: 20000 })
          .catch(() => {});
        const seconds = await p.evaluate(() => {
          try {
            return Number(
              window.ytInitialPlayerResponse?.videoDetails?.lengthSeconds || 0
            );
          } catch (e) {
            return 0;
          }
        });
        let duration = seconds || 0;
        if (!duration) {
          const meta = await p.$('meta[itemprop="duration"]');
          if (meta) {
            const content = await (
              await meta.getProperty("content")
            ).jsonValue();
            const m = String(content).match(
              /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/
            );
            if (m)
              duration =
                Number(m[1] || 0) * 3600 +
                Number(m[2] || 0) * 60 +
                Number(m[3] || 0);
          }
        }
        const title = await p
          .evaluate(
            () =>
              document.querySelector("h1.title")?.innerText ||
              document.title ||
              ""
          )
          .catch(() => "");
        await p.close();
        if (duration && duration <= 60) {
          results.push({
            id,
            title,
            thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
            url: `https://www.youtube.com/watch?v=${id}`,
            duration,
          });
        }
      } catch (e) {
        console.debug("per-video failure", id, e && e.message);
      }
    }

    await browser.close();
    return res.json({ videos: results });
  } catch (err) {
    console.error("puppeteer-scrape error", err);
    res.status(500).json({ error: "Scrape failed" + err });
  }
});

// Serve static frontend
const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}`)
);
