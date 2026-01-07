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

    let browser;
    // 1. Production / Serverless Launch (Vercel / AWS)
    if (process.env.VERCEL || process.env.AWS_EXECUTION_ENV) {
      try {
        const executablePath = await chromium.executablePath();
        browser = await puppeteer.launch({
          args: chromium.args,
          defaultViewport: chromium.defaultViewport,
          executablePath,
          headless: chromium.headless,
          ignoreHTTPSErrors: true,
        });
      } catch (e) {
        console.error("Vercel launch failed:", e);
        throw new Error("Failed to launch browser on Vercel: " + e.message);
      }
    }
    // 2. Local Development Launch
    else {
      try {
        const p = require("puppeteer");
        browser = await p.launch({
          headless: true, // "new" is default in v24, true is fine
          defaultViewport: { width: 1200, height: 800 },
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-extensions",
            "--disable-notifications",
          ],
        });
      } catch (e) {
        console.error(
          "Local launch failed. Ensure 'puppeteer' is installed.",
          e
        );
        // Fallback to puppeteer-core if standard puppeteer fails (unlikely if set up right)
        browser = await puppeteer.launch({
          channel: "chrome",
          headless: true,
          args: ["--no-sandbox"],
        });
      }
    }

    // Race against a 50s timeout to generate a proper JSON response before Vercel kills it
    const scrapePromise = (async () => {
      try {
        const page = await browser.newPage();
        // Block heavy resources
        await page.setRequestInterception(true);
        page.on("request", (req) => {
          const r = req.resourceType();
          // Allow stylesheets for correct rendering
          if (["image", "font"].includes(r)) req.abort();
          else req.continue();
        });

        await page.setUserAgent(
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        );
        await page.setExtraHTTPHeaders({
          "Accept-Language": "en-US,en;q=0.9",
        });
        await page.setViewport({ width: 1200, height: 800 });

        console.log("Navigating to:", shortsUrl);
        await page
          .goto(shortsUrl, { waitUntil: "networkidle2", timeout: 30000 })
          .catch((e) => console.log("Goto error:", e.message));

        const pageTitle = await page.title();
        console.log("Page Title:", pageTitle);

        // Check for common consent popups (often happens on serverless IPs)
        try {
          const consentSelectors = [
            'button[aria-label="Accept all"]',
            'button[aria-label="Agree to the use of cookies and other data for the purposes described"]',
            "ytd-button-renderer.ytd-consent-bump-v2-lightbox button", // generic consent bump
            // simplified text search if aria-label fails
            "//button[contains(., 'Accept all')]",
            "//button[contains(., 'Reject all')]",
          ];

          for (const s of consentSelectors) {
            let btn;
            if (s.startsWith("//")) {
              const [el] = await page.$x(s);
              btn = el;
            } else {
              btn = await page.$(s);
            }

            if (btn) {
              console.log("Consent button found. Clicking...", s);
              await btn.click();
              // Wait for navigation or modal close
              await new Promise((r) => setTimeout(r, 2000));
              break;
            }
          }
        } catch (err) {
          console.log("Consent check error (non-fatal):", err.message);
        }

        // Wait for at least one short to appear
        try {
          await page.waitForSelector('a[href*="/shorts/"]', { timeout: 10000 });
        } catch (e) {
          console.log(
            "Timeout waiting for shorts selector. Page content hint: " +
              (await page.evaluate(() =>
                document.body.innerText.substring(0, 200)
              ))
          );
        }

        const start = Date.now();
        const videosMap = new Map();

        // Scroll and scrape loop
        while (videosMap.size < max && Date.now() - start < 15000) {
          const newItems = await page.evaluate(() => {
            const items = [];
            // Target the main container for each short to get context
            // ytd-rich-grid-slim-media is standard for shorts grid on desktop
            const elements = document.querySelectorAll(
              "ytd-rich-grid-slim-media, ytd-rich-item-renderer"
            );

            elements.forEach((el) => {
              const anchor = el.querySelector('a[href*="/shorts/"]');
              if (!anchor) return;

              const href = anchor.getAttribute("href");
              const id = href.split("/shorts/").pop().split(/[?#]/)[0];
              if (!id) return;

              // Try to find title
              let title = "";
              const titleEl = el.querySelector("#video-title");
              if (titleEl) title = titleEl.textContent.trim();
              if (!title)
                title =
                  anchor.getAttribute("title") ||
                  anchor.getAttribute("aria-label") ||
                  "";

              // Fallback: If we only found a loose anchor without container (fallback for different layouts)
              if (!title && anchor.innerText.trim().length > 5) {
                title = anchor.innerText.trim();
              }

              items.push({ id, title });
            });

            // Fallback for simple layouts or mobile view if heavy selectors fail
            if (items.length === 0) {
              const anchors = document.querySelectorAll('a[href*="/shorts/"]');
              anchors.forEach((a) => {
                const href = a.getAttribute("href");
                const id = href.split("/shorts/").pop().split(/[?#]/)[0];
                if (id) {
                  let t = a.textContent.trim();
                  // Ignore timestamps or short text
                  if (t.length < 5) t = "";
                  items.push({ id, title: t });
                }
              });
            }

            return items;
          });

          newItems.forEach((item) => {
            if (item.id && !videosMap.has(item.id)) {
              // Only add if we don't have it, or if we have it but the new one has a better title
              videosMap.set(item.id, item);
            } else if (item.id && videosMap.has(item.id)) {
              const existing = videosMap.get(item.id);
              if (!existing.title && item.title) {
                videosMap.set(item.id, item);
              }
            }
          });

          if (videosMap.size >= max) break;

          await page.evaluate(() => window.scrollBy(0, window.innerHeight));
          await new Promise((r) => setTimeout(r, 800));
        }

        await browser.close();

        // Format results
        const results = Array.from(videosMap.values())
          .slice(0, max)
          .map((v) => ({
            id: v.id,
            title: v.title || "Short Video",
            thumbnail: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
            url: `https://www.youtube.com/watch?v=${v.id}`,
            duration: 60, // Assumed duration for shorts to pass frontend check
          }));

        console.log(`Scrape finished. Found ${results.length} videos.`);
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
        // new Promise((_, reject) =>
        //   setTimeout(() => reject(new Error("Function Timeout")), 55000)
        // ),
      ]);
      console.log(`Scrape finished. Found ${results.length} videos.`);
      return res.json({ videos: results });
    } catch (err) {
      console.error("Scrape error:", err);
      return res.status(500).json({ error: err.message || "Scrape failed" });
    }
  } catch (e) {
    console.error("puppeteer-scrape error", e);
    return res.status(500).json({ error: e.message || "Scrape failed8888" });
  }
};
