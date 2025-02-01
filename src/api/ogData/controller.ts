import type { Request, Response } from "express";
import ogs from "open-graph-scraper";
import NodeCache from "node-cache";

const cache = new NodeCache({ stdTTL: 300 }); // Cache for 5 minutes

export const getOgData = async (req: Request, res: Response) => {
  try {
    const url = req.query.url as string;

    if (!url) {
      return res.status(400).json({ error: "URL is required" });
    }

    // Check cache first
    const cachedData = cache.get(url);
    if (cachedData) {
      return res.json(cachedData);
    }

    const options = {
      url,
      timeout: 5000,
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      },
    };

    const { result } = await ogs(options);

    const ogData = {
      url,
      title: result.ogTitle,
      description: result.ogDescription,
      image: result.ogImage?.[0]?.url,
      siteName: result.ogSiteName,
    };

    // Store in cache
    cache.set(url, ogData);

    res.json(ogData);
  } catch (error) {
    console.error("Error fetching OG data:", error);
    res.status(500).json({ error: "Failed to fetch OG data" });
  }
};
