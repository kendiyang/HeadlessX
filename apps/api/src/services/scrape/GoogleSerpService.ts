import { Page, BrowserContext } from 'playwright-core';
import { browserService } from './BrowserService';

export interface SerpResult {
    ai_overview: string | null;
    sites: Array<{
        title: string;
        description: string;
        source: string;
        url: string;
    }>;
}

export interface SearchResponse {
    query: string;
    timestamp: string;
    results: SerpResult;
    markdown: string;
}

export interface GoogleSearchOptions {
    gl?: string;
    hl?: string;
    tbs?: 'qdr:h' | 'qdr:d' | 'qdr:w';
    stealth?: boolean;
}

export class GoogleSerpSetupError extends Error {
    public readonly code: string;
    public readonly statusCode: number;

    constructor(message: string, code: string, statusCode = 412) {
        super(message);
        this.name = 'GoogleSerpSetupError';
        this.code = code;
        this.statusCode = statusCode;
    }
}

export class GoogleSerpService {
    private static readonly DEFAULT_SEARCH_TIMEOUT_MS = 120000;

    public assertSearchReady(): void {
        const cookieStatus = browserService.getGoogleCookieBootstrapStatus();

        if (cookieStatus.running) {
            throw new GoogleSerpSetupError(
                'Google cookie browser is still open. Stop Browser after solving Google prompts, then rerun the search.',
                'GOOGLE_COOKIE_BOOTSTRAP_ACTIVE',
                409
            );
        }

        if (cookieStatus.required) {
            throw new GoogleSerpSetupError(
                'Build Cookies once before running Google AI Search so the shared browser profile looks trusted to Google.',
                'GOOGLE_COOKIE_BOOTSTRAP_REQUIRED',
                412
            );
        }
    }

    private async solveCaptcha(page: Page): Promise<boolean> {
        try {
            const { captchaSolverService } = await import('../CaptchaSolverService');
            return await captchaSolverService.solve(page);
        } catch (error) {
            console.error('Captcha solver is unavailable:', error);
            return false;
        }
    }

    private async detectCaptcha(page: Page): Promise<{ detected: boolean; isSorryPage: boolean }> {
        const isSorryPage = page.url().includes('/sorry/');
        if (isSorryPage) {
            return { detected: true, isSorryPage: true };
        }

        const hasCaptchaFrame = page.frames().some(frame => frame.url().includes('recaptcha'));
        if (hasCaptchaFrame) {
            return { detected: true, isSorryPage: false };
        }

        const hasRecaptchaIframe = (await page.locator('iframe[src*="recaptcha"]').count()) > 0;
        return { detected: hasRecaptchaIframe, isSorryPage: false };
    }

    private async solveCaptchaIfDetected(
        page: Page,
        options: {
            location: string;
            waitBeforeCheckMs?: number;
            waitAfterSolveMs?: number;
            homeUrl?: string;
            operationTimeout?: number;
            onCaptchaDetected?: () => void;
        }
    ): Promise<boolean> {
        try {
            if (options.waitBeforeCheckMs && options.waitBeforeCheckMs > 0) {
                await page.waitForTimeout(options.waitBeforeCheckMs);
            }

            const detection = await this.detectCaptcha(page);
            if (!detection.detected) {
                return false;
            }

            console.log(`   ⚠️ CAPTCHA detected at ${options.location}. Solving...`);
            options.onCaptchaDetected?.();

            await this.solveCaptcha(page);

            if (options.waitAfterSolveMs && options.waitAfterSolveMs > 0) {
                await page.waitForTimeout(options.waitAfterSolveMs);
            }

            if (options.homeUrl) {
                const postSolveDetection = await this.detectCaptcha(page);
                if (postSolveDetection.isSorryPage) {
                    console.log('   🔄 Navigating back to Google after CAPTCHA...');
                    await page.goto(options.homeUrl, {
                        waitUntil: 'domcontentloaded',
                        timeout: options.operationTimeout,
                    });
                    await page.waitForTimeout(2000);
                }
            }

            return true;
        } catch (error) {
            console.log(`   ⚠️ CAPTCHA check at ${options.location} failed:`, error);
            return false;
        }
    }

    private normalizeOptions(options?: GoogleSearchOptions): GoogleSearchOptions {
        return {
            gl: options?.gl?.trim().toLowerCase() || undefined,
            hl: options?.hl?.trim().toLowerCase() || undefined,
            tbs: options?.tbs || undefined,
            stealth: options?.stealth,
        };
    }

    private getTypingDelay(stealth?: boolean, minimum = 30, variance = 50): number {
        if (stealth === false) {
            return 0;
        }

        return Math.random() * variance + minimum;
    }

    private buildGoogleHomeUrl(options?: GoogleSearchOptions): string {
        const url = new URL('https://www.google.com/');
        if (options?.gl) {
            url.searchParams.set('gl', options.gl);
        }
        if (options?.hl) {
            url.searchParams.set('hl', options.hl);
        }
        return url.toString();
    }

    private buildGoogleSearchUrl(query: string, options?: GoogleSearchOptions): string {
        const url = new URL('https://www.google.com/search');
        url.searchParams.set('q', query);
        if (options?.gl) {
            url.searchParams.set('gl', options.gl);
        }
        if (options?.hl) {
            url.searchParams.set('hl', options.hl);
        }
        if (options?.tbs) {
            url.searchParams.set('tbs', options.tbs);
        }
        return url.toString();
    }

    private buildGoogleStartUrl(query: string, options?: GoogleSearchOptions): string {
        if (options?.gl || options?.hl || options?.tbs) {
            return this.buildGoogleSearchUrl(query, options);
        }

        return this.buildGoogleHomeUrl();
    }

    /**
     * Scrape Google AI Search with real-time progress updates
     */
    async scrapeWithProgress(
        query: string,
        timeout: number,
        options: GoogleSearchOptions,
        onProgress: (progress: { step: number; total: number; message: string; status: 'active' | 'completed' | 'pending' }) => void
    ): Promise<SearchResponse> {
        this.assertSearchReady();
        const searchOptions = this.normalizeOptions(options);
        const homeUrl = this.buildGoogleHomeUrl(searchOptions);
        const startUrl = this.buildGoogleStartUrl(query, searchOptions);
        const TOTAL_STEPS = 6;
        const operationTimeout = Math.max(timeout, 5000);
        let browserContext: BrowserContext | null = null;
        let page: Page | null = null;

        try {
            // STEP 1: Launch Browser
            onProgress({ step: 1, total: TOTAL_STEPS, message: 'Launching browser', status: 'active' });
            const browserResult = await browserService.getPage();
            page = browserResult.page;
            browserContext = browserResult.context;
            onProgress({ step: 1, total: TOTAL_STEPS, message: 'Launching browser', status: 'completed' });

            // STEP 2: Navigating to Google (Includes Consent & AI Mode setup)
            onProgress({ step: 2, total: TOTAL_STEPS, message: 'Navigating to Google', status: 'active' });
            await browserService.applyViewport(page);
            await page.goto(startUrl, {
                waitUntil: 'domcontentloaded',
                timeout: operationTimeout,
            });
            await page.waitForTimeout(2000); // Wait like Python script

            // CAPTCHA CHECK #1: After navigating to google.com
            await this.solveCaptchaIfDetected(page, {
                location: 'after navigation to Google',
                waitBeforeCheckMs: 3000,
                waitAfterSolveMs: 3000,
                homeUrl,
                operationTimeout,
                onCaptchaDetected: () => {
                    onProgress({
                        step: 4,
                        total: TOTAL_STEPS,
                        message: 'CAPTCHA detected after navigation. Solving...',
                        status: 'active'
                    });
                }
            });

            // Consent handling (robust)
            const consentSelectors = [
                "button.tHlp8d", "button#L2AGLb",
                "//button[contains(text(), 'Accept')]", "//button[contains(text(), 'I agree')]"
            ];
            for (const selector of consentSelectors) {
                try {
                    const btn = page.locator(selector).first();
                    if (await btn.isVisible({ timeout: 2000 })) {
                        await btn.click();
                        await page.waitForTimeout(2000);
                        break;
                    }
                } catch { }
            }

            let aiModeClicked = false;
            onProgress({ step: 2, total: TOTAL_STEPS, message: 'Navigating to Google', status: 'completed' });

            // AI Mode (always prefer it)
            try {
                const aiBtn = page.locator("//button[contains(@class, 'plR5qb')]").first();
                if (await aiBtn.isVisible({ timeout: 5000 })) {
                    await aiBtn.click();
                    aiModeClicked = true;
                    console.log("   ✅ Clicked AI Mode button");
                    await page.waitForTimeout(2000);
                }
            } catch {
                console.log("   ⚠️ AI Mode button not found, using regular search");
            }

            // CAPTCHA CHECK #2: After AI Mode click (before trying to type)
            await this.solveCaptchaIfDetected(page, {
                location: 'after AI mode click',
                waitBeforeCheckMs: 3000,
                waitAfterSolveMs: 3000,
                homeUrl,
                operationTimeout,
                onCaptchaDetected: () => {
                    onProgress({
                        step: 4,
                        total: TOTAL_STEPS,
                        message: 'CAPTCHA detected after AI mode. Solving...',
                        status: 'active'
                    });
                }
            });

            // STEP 3: Inputting search details (Includes finding input, typing, submitting)
            onProgress({ step: 3, total: TOTAL_STEPS, message: 'Inputting search details', status: 'active' });

            let typed = false;

            if (aiModeClicked) {
                try {
                    const el = page.locator("//textarea[contains(@class, 'ITIRGe')]").first();
                    if (await el.isVisible({ timeout: 2000 })) {
                        const existingValue = (await el.inputValue().catch(() => '')).trim();
                        if (existingValue.toLowerCase() === query.trim().toLowerCase()) {
                            typed = true;
                        } else {
                            await el.click({ force: true, timeout: 3000 });
                            await page.waitForTimeout(500);
                            await el.fill('');
                            for (const char of query) {
                                await el.type(char, { delay: this.getTypingDelay(searchOptions.stealth) });
                            }
                            typed = true;
                        }
                    }
                } catch (e) {
                    console.log("   ⚠️ AI Input failed (click/type), falling back to standard...", e);
                    await page.waitForTimeout(1000);
                }
            }

            if (!typed) {
                const searchXpaths = ["//textarea[@name='q']", "//input[@name='q']"];
                for (const xpath of searchXpaths) {
                    try {
                        const el = page.locator(xpath).first();
                        if (await el.isVisible({ timeout: 3000 })) {
                            const existingValue = (await el.inputValue().catch(() => '')).trim();
                            if (existingValue.toLowerCase() === query.trim().toLowerCase()) {
                                typed = true;
                                break;
                            }

                            await el.click({ force: true, timeout: 3000 });
                            await page.waitForTimeout(500);
                            await el.fill(query);
                            typed = true;
                            break;
                        }
                    } catch { }
                }
            }

            if (!typed) throw new Error("Could not find or type in any search input");
            onProgress({ step: 3, total: TOTAL_STEPS, message: 'Inputting search details', status: 'completed' });

            await page.keyboard.press('Enter');
            try {
                const sendBtn = page.locator("//button[@aria-label='Send']").first();
                if (await sendBtn.isVisible({ timeout: 1000 })) await sendBtn.click();
            } catch { }

            // STEP 4: Solving potential CAPTCHAs (Includes Waiting & Checking)
            onProgress({ step: 4, total: TOTAL_STEPS, message: 'Waiting for search results', status: 'active' });

            // Initial mandatory wait from Python script
            await page.waitForTimeout(5000);

            // Wait loop for results or captcha
            const maxWait = operationTimeout;
            let resultFound = false;
            let waited = 5000; // already waited 5s

            while (waited < maxWait) {
                const resultCount = await page.locator("div.MFrAxb, div.g").count(); // Check for results
                if (resultCount > 0) {
                    resultFound = true;
                    break;
                }

                await this.solveCaptchaIfDetected(page, {
                    location: 'while waiting for results',
                    waitAfterSolveMs: 3000,
                    onCaptchaDetected: () => {
                        onProgress({
                            step: 4,
                            total: TOTAL_STEPS,
                            message: 'CAPTCHA detected while waiting. Solving...',
                            status: 'active'
                        });
                    }
                });

                await page.waitForTimeout(1000);
                waited += 1000;
            }
            onProgress({
                step: 4,
                total: TOTAL_STEPS,
                message: resultFound ? 'Results are ready for extraction' : 'Finished waiting for results',
                status: 'completed'
            });

            // STEP 5: Extracting SERP data (Includes Expansion)
            onProgress({ step: 5, total: TOTAL_STEPS, message: 'Extracting SERP data', status: 'active' });

            // Expand Results
            try {
                // "Show all" button: //div[@id='rw0ISc'] from Python
                const showAll = page.locator("//div[@id='rw0ISc']").first();
                if (await showAll.isVisible({ timeout: 5000 })) {
                    await showAll.click({ force: true });
                    await page.waitForTimeout(3000);
                }
            } catch { }

            // Extract & Format
            const results = await this.extractResults(page);
            onProgress({ step: 5, total: TOTAL_STEPS, message: 'Extracting SERP data', status: 'completed' });

            // STEP 6: Formatting results
            onProgress({ step: 6, total: TOTAL_STEPS, message: 'Formatting results', status: 'active' });
            const markdown = this.generateMarkdown(query, results);

            const response: SearchResponse = {
                query,
                timestamp: new Date().toISOString(),
                results,
                markdown
            };
            onProgress({ step: 6, total: TOTAL_STEPS, message: 'Formatting results', status: 'completed' });

            return response;

        } catch (error) {
            console.error('Google AI Search Error:', error);
            throw error;
        } finally {
            if (browserContext) {
                await browserService.release(browserContext, page ?? undefined);
            }
        }
    }

    private async extractResults(page: Page): Promise<SerpResult> {
        const results: SerpResult = {
            ai_overview: null,
            sites: []
        };

        // Extract AI Overview
        try {
            const aiSelectors = [
                "div.mZJni",
                "div.wDYxhc",
                "div[data-attrid='wa:/description']"
            ];

            for (const selector of aiSelectors) {
                const elements = await page.locator(selector).all();
                let fullText = "";

                for (const el of elements) {
                    const text = (await el.innerText()).trim();
                    if (text.length > fullText.length) {
                        fullText = text;
                    }
                }

                if (fullText) {
                    results.ai_overview = fullText;
                    break;
                }
            }
        } catch (e) {
            console.log("No AI Overview found or error extracting");
        }

        // Extract Sites
        try {
            const siteItems = await page.locator("div.MFrAxb").all();

            for (const item of siteItems) {
                try {
                    const title = await item.locator("div.Nn35F").first().innerText().catch(() => "");
                    const description = await item.locator("span.vhJ6Pe").first().innerText().catch(() => "");
                    const source = await item.locator("span.R0r5R").first().innerText().catch(() => "");
                    const url = await item.locator("a.NDNGvf").first().getAttribute("href").catch(() => "");

                    if (title || url) {
                        results.sites.push({
                            title: title.trim(),
                            description: description.trim(),
                            source: source.trim(),
                            url: url || ""
                        });
                    }
                } catch (e) {
                    // Ignore individual item errors
                }
            }
        } catch (e) {
            console.log("Error extracting sites", e);
        }

        return results;
    }

    private generateMarkdown(query: string, results: SerpResult): string {
        const timestamp = new Date().toLocaleString();
        let md = `# Google AI Search Results\n\n`;
        md += `**Query:** ${query}\n`;
        md += `**Timestamp:** ${timestamp}\n\n`;
        md += `---\n\n`;

        md += `## AI Overview\n\n`;
        md += `${results.ai_overview || "No AI overview available."}\n\n`;
        md += `---\n\n`;

        md += `## Sites (${results.sites.length} results)\n\n`;

        results.sites.forEach((site, index) => {
            md += `### ${index + 1}. [${site.title || "Untitled"}](${site.url || "#"})\n`;
            md += `**${site.source || "Unknown Source"}**\n\n`;
            md += `> ${site.description || "No description available."}\n\n`;
            md += `---\n\n`;
        });

        return md;
    }

    public async search(query: string, options?: GoogleSearchOptions): Promise<SearchResponse> {
        return this.scrapeWithProgress(
            query,
            GoogleSerpService.DEFAULT_SEARCH_TIMEOUT_MS,
            options ?? {},
            () => {
                // No progress events needed for non-stream endpoint.
            }
        );
    }
}

export const googleSerpService = new GoogleSerpService();
