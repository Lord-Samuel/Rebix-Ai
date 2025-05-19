import express from "express";
import cors from "cors";
import morgan from "morgan";
import fetch from "node-fetch";

class AIApi {
    constructor(options = {}) {
        this.apis = [
            {
                url: "https://api-rebix.vercel.app/api/cohere",
                param: "q",
                provider: "Rebix-Ai",
            },
            {
                url: "https://api.siputzx.my.id/api/ai/blackboxai-pro",
                param: "content",
                provider: "BlackboxAI-Pro",
            },
            {
                url: "https://api.siputzx.my.id/api/ai/blackboxai",
                param: "content",
                provider: "BlackboxAI",
            },
            {
                url: "https://vapis.my.id/api/blackbox",
                param: "q",
                provider: "Blackbox-Vapis",
            },
            {
                url: "https://apis.davidcyriltech.my.id/blackbox",
                param: "q",
                provider: "Blackbox-DavidCyril",
            },
        ];

        this.config = {
            timeout: options.timeout || 10000,
            retryCount: options.retryCount || 2,
            cache: options.cache || false,
            cacheTTL: options.cacheTTL || 3600000,
        };

        this.cache = new Map();
    }

    buildUrl(api, text) {
        return `${api.url}?${api.param}=${encodeURIComponent(text)}`;
    }

    standardizeResponse(data) {
        return {
            content:
                data.message || data.data || data.result || data.response || message.generations.text || "",
            metadata: {
                timestamp: new Date().toISOString(),
                source: data.provider || "unknown",
            },
        };
    }

    async fetchWithTimeout(url, timeout) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        try {
            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);

            // Check content type before parsing
            const contentType = response.headers.get("content-type");
            if (!contentType || !contentType.includes("application/json")) {
                const text = await response.text();
                throw new Error(
                    `Invalid content-type. Received: ${contentType || "unknown"}. Response: ${text.slice(0, 100)}`,
                );
            }

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(`HTTP error! status: ${response.status}`, {
                    cause: errorData,
                });
            }

            return await response.json();
        } catch (error) {
            clearTimeout(timeoutId);
            throw error;
        }
    }

    async query(text, options = {}) {
        if (!text || typeof text !== "string") {
            throw new Error("Query text must be a non-empty string");
        }

        const queryOptions = {
            retry: options.retry ?? this.config.retryCount,
            specificApi: options.specificApi,
        };

        const cacheKey = `${text}:${queryOptions.specificApi || "all"}`;
        if (this.config.cache && this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }

        const apisToTry = queryOptions.specificApi
            ? this.apis.filter(
                  (api) => api.provider === queryOptions.specificApi,
              )
            : this.apis;

        const errors = [];

        for (const api of apisToTry) {
            let attempts = 0;
            while (attempts <= queryOptions.retry) {
                try {
                    const url = this.buildUrl(api, text);
                    const data = await this.fetchWithTimeout(
                        url,
                        this.config.timeout,
                    );

                    if (
                        data &&
                        (data.message ||
                            data.data ||
                            data.result ||
                            data.response)
                    ) {
                        const response = this.standardizeResponse({
                            ...data,
                            provider: api.provider,
                        });

                        if (this.config.cache) {
                            this.cache.set(cacheKey, response);
                            setTimeout(
                                () => this.cache.delete(cacheKey),
                                this.config.cacheTTL,
                            );
                        }

                        return response;
                    }
                } catch (error) {
                    attempts++;
                    errors.push(
                        `[${api.provider} attempt ${attempts}]: ${error.message}`,
                    );

                    if (attempts > queryOptions.retry) {
                        console.warn(
                            `Failed ${api.provider} after ${attempts} attempts: ${error.message}`,
                        );
                    }

                    if (attempts <= queryOptions.retry) {
                        await new Promise((resolve) =>
                            setTimeout(resolve, Math.pow(2, attempts) * 1000),
                        );
                    }
                }
            }
        }

        throw new Error(
            `All API attempts failed. Errors:\n${errors.join("\n")}`,
        );
    }
}

const app = express();
const port = process.env.PORT || 3000;
const aiApi = new AIApi({
    timeout: 15000,
    retryCount: 3,
    cache: true,
});

app.use(cors());
app.use(express.json());
app.use(morgan("dev"));


app.get("/api/query", async (req, res) => {
    try {
        const { q, provider } = req.query;

        if (!q) {
            return res.status(400).json({
                status: "error",
                message: "Query parameter is required",
            });
        }

        const response = await aiApi.query(q);

        res.json({
            status: "success",
            data: response,
            creator: "Lord Samuel",
        });
    } catch (error) {
        console.error("Error in GET /api/query:", error);
        res.status(500).json({
            status: "error",
            message: error.message || "Failed to process query",
        });
    }
});

app.delete("/api/cache", (req, res) => {
    aiApi.cache.clear();
    res.json({
        status: "success",
        message: "Cache cleared successfully",
    });
});

app.get("/api/health", (req, res) => {
    res.json({
        status: "success",
        message: "API is running",
        timestamp: new Date().toISOString(),
    });
});

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        status: "error",
        message: "Internal server error",
    });
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

export default app;
