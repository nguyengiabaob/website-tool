const chromium = require("@sparticuz/chromium");
const puppeteer = require("puppeteer-core");
const fs = require("fs");

module.exports = async (req, res) => {
  // Sanitize environment for Vercel Dev local execution
  if (process.env.VERCEL_ENV === "development") {
    delete process.env.PUPPETEER_EXECUTABLE_PATH;
  }

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

    const launchOpts = {
      args: (chromium.args || []).concat([
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage", // important for serverless
        "--disable-gpu",
      ]),
      headless: chromium.headless,
      defaultViewport: { width: 1200, height: 800 },
    };

    // Vercel / Serverless environment (ONLY in production/preview, not local dev)
    if (
      (process.env.AWS_EXECUTION_ENV || process.env.VERCEL) &&
      process.env.VERCEL_ENV !== "development"
    ) {
      try {
        launchOpts.executablePath = await chromium.executablePath();
      } catch (e) {
        console.error("Failed to get chromium executable path:", e);
      }
    } else if (
      process.env.PUPPETEER_EXECUTABLE_PATH &&
      fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)
    ) {
      launchOpts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    } else {
      // Local development fallback
      try {
        const p = require("puppeteer");
        if (p.executablePath) launchOpts.executablePath = p.executablePath();
      } catch (e) {
        console.log(
          "Local fallback: full 'puppeteer' not installed, trying sparticuz/default."
        );
        try {
          const exe = await chromium.executablePath();
          if (exe) launchOpts.executablePath = exe;
        } catch (e2) {}
      }
    }

    // Race against a 50s timeout to generate a proper JSON response before Vercel kills it
    const scrapePromise = (async () => {
        let browser;
        try {
            if (launchOpts.executablePath) {
                browser = await puppeteer.launch(launchOpts);
            } else {
                 browser = await puppeteer.launch({
                    ...launchOpts,
                    headless: true, // Use new headless mode (true = new in v22+)
                    args: [...launchOpts.args, "--disable-extensions", "--disable-notifications"]
                 });
            }
        } catch (launchErr) {
            console.error("Puppeteer launch failed:", launchErr);
            throw new Error("Failed to launch Browser. " + launchErr.message);
        }

        try {
            const page = await browser.newPage();
            // Block heavy resources
            await page.setRequestInterception(true);
            page.on("request", (req) => {
                const r = req.resourceType();
                if (["image", "stylesheet", "font"].includes(r)) req.abort();
                else req.continue();
            });

            await page.setUserAgent(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            );
            await page.setViewport({ width: 1200, height: 800 }); // Fix width typo 120 -> 1200

            await page.goto(shortsUrl, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});

            const start = Date.now();
            const ids = new Set();
            // Reduce max scroll time to 15s
            while (ids.size < max && Date.now() - start < 15000) {
                const newIds = await page.evaluate(() => {
                    const out = [];
                    document.querySelectorAll('a[href*="/shorts/"], a[href*="watch?v="]').forEach((a) => {
                        const href = a.getAttribute("href");
                        if (!href) return;
                        let id = null;
                        if (href.includes("/shorts/")) id = href.split("/shorts/").pop().split(/[?#]/)[0];
                        else if (href.includes("watch?v=")) {
                            try { id = new URL(href, "https://youtube.com").searchParams.get("v"); } catch (e) {}
                        }
                        if (id) out.push(id);
                    });
                    return out;
                });
                newIds.forEach((i) => ids.add(i));
                await page.evaluate(() => window.scrollBy(0, window.innerHeight));
                await new Promise((r) => setTimeout(r, 500));
            }

            await page.close(); // Save memory: close list page before processing details

            const idList = Array.from(ids).slice(0, max);
            const results = [];
            
            // Optimize: Reuse a single page for details to save memory/overhead
            // Also enforce strict timeboxing.
            const detailPage = await browser.newPage();
            try {
                await detailPage.setRequestInterception(true);
                detailPage.on("request", (req) => {
                    const r = req.resourceType();
                    if (["image", "stylesheet", "font", "media"].includes(r)) req.abort();
                    else req.continue();
                });

                for (const id of idList) {
                    // If we are within 10 seconds of the 60s timeout (i.e. > 50s elapsed), stop and return what we have.
                    // Vercel limit is strict.
                    if (Date.now() - start > 45000) break; 
                    
                    try {
                        const watchUrl = `https://www.youtube.com/watch?v=${id}`;
                        
                        // Race navigation with a short 3s timeout
                        await Promise.race([
                            detailPage.goto(watchUrl, { waitUntil: "domcontentloaded" }),
                            new Promise(r => setTimeout(r, 4000))
                        ]).catch(() => {});
                        
                        // Quick evaluate with safety
                        const data = await detailPage.evaluate(() => {
                            try {
                                const playerResp = window.ytInitialPlayerResponse;
                                const d = playerResp?.videoDetails;
                                return {
                                    duration: Number(d?.lengthSeconds || 0),
                                    title: d?.title || document.title || ""
                                };
                            } catch(e) { return { duration: 0, title: "" }; }
                        });

                        let { duration, title } = data;

                        // Fallback for duration
                        if (!duration) {
                            const metaDuration = await detailPage.$eval('meta[itemprop="duration"]', el => el.content).catch(() => null);
                            if (metaDuration) {
                                const m = String(metaDuration).match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
                                if (m) duration = Number(m[1]||0)*3600 + Number(m[2]||0)*60 + Number(m[3]||0);
                            }
                        }

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
                        // Ignore per-video errors
                    }
                }
            } finally {
               await detailPage.close();
            }
            
            await browser.close();
            return results;
        } catch (e) {
            if (browser) await browser.close();
            throw e;
        }
    })();

    try {
        // Enforce 55s timeout
        const results = await Promise.race([
            scrapePromise,
            new Promise((_, reject) => setTimeout(() => reject(new Error("Function Timeout")), 55000))
        ]);
        return res.json({ videos: results });
    } catch (err) {
        console.error("Scrape error:", err);
        return res.status(500).json({ error: err.message || "Scrape failed" });
    }
};
