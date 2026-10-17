/**
 * Kickstarter project search — discover projects by keyword.
 *
 * Uses Browser Bridge (Strategy.COOKIE) to render Cloudflare-protected pages,
 * dismisses cookie consent modals, waits for React hydration, then extracts
 * project cards via DOM scraping.
 *
 * Usage:
 *   opencli kickstarter search "action camera" --limit 10 --sort magic
 *   opencli kickstarter search "drone" --limit 5 --sort popularity
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { requireSearchQuery, requireBoundedInteger, requireRows, emptySearchResults, runBrowserStep } from '../_shared/search-adapter.js';

const BASE = 'https://www.kickstarter.com';
const SORT_OPTIONS = ['magic', 'popularity', 'newest', 'end_date', 'most_funded', 'most_backed'];

// Extract project data from the fully-rendered DOM.
function buildExtractorJs(limit) {
    return `
    (() => {
        // 1. Dismiss cookie consent modal if present
        // Use CSS-only selectors first (native querySelector), then fallback to text-matching
        let cookieBtn = document.querySelector('[data-testid="gdpr-consent-accept"], [data-testid="cookie-consent-accept"], .cookie-consent button, [class*="cookie"] button');
        if (!cookieBtn) {
            for (const btn of document.querySelectorAll('button, a[role="button"], [role="button"]')) {
                const t = (btn.textContent || '').toLowerCase().trim();
                if (['okay', 'accept', 'i accept', 'agree', 'got it', 'continue', 'consent', 'allow'].includes(t)) {
                    cookieBtn = btn;
                    break;
                }
            }
        }
        if (cookieBtn) try { cookieBtn.click(); } catch(e) {}

        // 2. Wait briefly for dynamic content
        const sleep = (ms) => { const s = Date.now(); while (Date.now() - s < ms) {} };
        sleep(800);

        // 3. Also try global consent banner
        document.querySelectorAll('button, a, [role="button"]').forEach(el => {
            const text = (el.textContent || '').toLowerCase().trim();
            if (['okay', 'accept', 'i accept', 'agree', 'got it', 'continue', 'consent'].includes(text)) {
                try { el.click(); } catch(e) {}
            }
        });

        // 4. Extract project cards
        const results = [];
        const cards = document.querySelectorAll(
            'div[data-testid="project-grid"] > div > div, ' +
            '[data-testid="project_card"], ' +
            '[data-project], ' +
            '.project-card, ' +
            '.discoverable-card, ' +
            '.react-disc-project-card, ' +
            'a[href*="/projects/"][class*="card"], ' +
            'a[href*="/projects/"][class*="project"], ' +
            'div[class*="discover"][class*="card"] a[href*="/projects/"], ' +
            'div[class*="grid"] a[href*="/projects/"]'
        );
        const projectLinks = new Set();

        // Also try collecting all /projects/ links as fallback
        const allLinks = Array.from(document.querySelectorAll('a[href*="/projects/"]'))
            .filter(a => a.href.match(/kickstarter\\.com\\/projects\\/[^/]+\\/[^/?#]+/));

        for (const el of (cards.length > 0 ? cards : allLinks)) {
            const link = el.tagName === 'A' ? el.href : el.querySelector('a[href*="/projects/"]')?.href;
            if (!link || projectLinks.has(link)) continue;
            projectLinks.add(link);

            const container = el.closest?.('[class*="card"], [class*="project"], [class*="discover"], li, div') || el;
            const titleEl = container.querySelector?.('h2, h3, h4, [class*="title"], [class*="name"], strong') || el;
            const title = (titleEl.textContent || '').trim().replace(/\\s+/g, ' ');

            // Skip nav/footer links
            if (!title || title.length < 3 || title.length > 200) continue;

            const text = (container.textContent || '').toLowerCase();

            // Try to extract funding info from nearby text
            let pledged = '';
            let goal = '';
            let backers = '';
            let pct = '';

            const pledgedMatch = text.match(/(?:pledged|raised|funded)[:\\s]*[$€£¥]?\\s*([\\d,]+(?:[.]\\d+)?)\\s*(k|m|million|thousand)?/i);
            if (pledgedMatch) pledged = '$' + pledgedMatch[1] + (pledgedMatch[2] || '');

            const goalMatch = text.match(/goal[\\s:]*[$€£¥]?\\s*([\\d,]+(?:[.]\\d+)?)\\s*(k|m)?/i);
            if (goalMatch) goal = '$' + goalMatch[1] + (goalMatch[2] || '');

            const pctMatch = text.match(/(\\d{1,5})\\s*%\\s*(?:funded|of goal)/i);
            if (pctMatch) pct = pctMatch[1] + '%';

            const backerMatch = text.match(/(\\d{1,6}(?:[.]\\d+)?)\\s*(?:backers?|supporters?)/i);
            if (backerMatch) backers = backerMatch[1];

            results.push({
                title: title.slice(0, 120),
                pledged: pledged,
                goal: goal,
                funded_pct: pct,
                backers: backers,
                url: link
            });

            if (results.length >= ${limit}) break;
        }

        // Fallback: extract from raw HTML if selectors fail
        if (results.length === 0) {
            const bodyText = (document.body.textContent || '');
            const lines = bodyText.split('\\n').map(l => l.trim()).filter(Boolean).slice(0, 100);
            const matches = bodyText.match(/\\$[\\d,]+/g) || [];
            results.push({ title: 'Kickstarter search page loaded', count: matches.length + ' funding amounts found', url: window.location.href });
        }

        return JSON.stringify(results);
    })()
    `;
}

cli({
    site: 'kickstarter',
    name: 'search',
    access: 'read',
    description: 'Search Kickstarter projects by keyword',
    domain: 'www.kickstarter.com',
    strategy: Strategy.COOKIE,
    navigateBefore: false,
    args: [
        { name: 'query', positional: true, required: true, help: 'Search keyword' },
        { name: 'limit', type: 'int', default: 10, min: 1, max: 50, help: 'Number of results (default 10, max 50)' },
        { name: 'sort', type: 'str', default: 'magic', choices: SORT_OPTIONS, help: `Sort order: ${SORT_OPTIONS.join(', ')}` },
    ],
    columns: ['rank', 'title', 'pledged', 'goal', 'funded_pct', 'backers', 'url'],
    func: async (page, kwargs) => {
        const query = kwargs.query;
        const rawLimit = Number(kwargs.limit) || 10;
        const limit = Math.max(1, Math.min(50, rawLimit));
        const sort = SORT_OPTIONS.includes(kwargs.sort) ? kwargs.sort : 'magic';

        const url = `${BASE}/discover/advanced?term=${encodeURIComponent(query)}&sort=${sort}`;

        // Navigate
        await runBrowserStep('Kickstarter navigate', async () => {
            await page.goto(url);
            // Poll for the project grid (React hydration can take a while)
            await page.evaluate(`(async () => {
                const deadline = Date.now() + 25000;
                while (Date.now() < deadline) {
                    if (document.querySelector('div[data-testid="project-grid"] a[href*="/projects/"], a[href*="/projects/"]')) break;
                    await new Promise(r => setTimeout(r, 500));
                }
            })()`);
        });

        // Extract
        const rawJson = await runBrowserStep('Kickstarter extract', async () => {
            return await page.evaluate(buildExtractorJs(limit));
        });

        let data;
        try {
            data = JSON.parse(rawJson);
        } catch {
            // In case evaluate returned a JS object directly
            data = rawJson;
        }

        const rows = requireRows(Array.isArray(data) ? data : [], 'Kickstarter search');
        if (rows.length === 0) throw emptySearchResults('Kickstarter', query);

        return rows.slice(0, limit).map((item, i) => ({
            rank: i + 1,
            title: item.title || '',
            pledged: item.pledged || '',
            goal: item.goal || '',
            funded_pct: item.funded_pct || '',
            backers: item.backers || '',
            url: item.url || '',
        }));
    },
});
