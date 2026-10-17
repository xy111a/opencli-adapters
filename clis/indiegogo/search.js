/**
 * Indiegogo campaign search — discover campaigns by keyword.
 *
 * Uses the site's own search API (POST /api/projectSearch/searchProjects)
 * via in-page fetch so Cloudflare clearance + cookies are inherited.
 * No DOM scraping, no hydration waits.
 *
 * Usage:
 *   opencli indiegogo search "smart ring" --limit 10
 *   opencli indiegogo search "drone" --limit 5 --sort most_funded
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { requireRows, emptySearchResults, runBrowserStep } from '../_shared/search-adapter.js';

const BASE = 'https://www.indiegogo.com';
const SORT_OPTIONS = ['trending', 'popular_all', 'most_funded', 'new_this_week'];
// Best-effort mapping of sort names onto the API's `order` field.
const SORT_ORDER = { trending: 0, popular_all: 1, most_funded: 2, new_this_week: 3 };

function fmtMoney(n) {
    if (n === null || n === undefined || n === '') return '';
    const num = Number(n);
    if (!Number.isFinite(num) || num <= 0) return '';
    return '$' + num.toLocaleString('en-US');
}

cli({
    site: 'indiegogo',
    name: 'search',
    access: 'read',
    description: 'Search Indiegogo campaigns by keyword',
    domain: 'www.indiegogo.com',
    strategy: Strategy.COOKIE,
    navigateBefore: false,
    args: [
        { name: 'query', positional: true, required: true, help: 'Search keyword' },
        { name: 'limit', type: 'int', default: 10, min: 1, max: 50, help: 'Number of results (default 10, max 50)' },
        { name: 'sort', type: 'str', default: 'trending', choices: SORT_OPTIONS, help: `Sort order: ${SORT_OPTIONS.join(', ')}` },
    ],
    columns: ['rank', 'title', 'raised_amt', 'goal_amt', 'backers', 'state', 'time_left', 'url'],
    func: async (page, kwargs) => {
        const query = String(kwargs.query || '').trim();
        if (!query) throw new Error('Search keyword cannot be empty');
        const rawLimit = Number(kwargs.limit) || 10;
        const limit = Math.max(1, Math.min(50, rawLimit));
        const sort = SORT_OPTIONS.includes(kwargs.sort) ? kwargs.sort : 'trending';

        // Land on the origin first so in-page fetch inherits cookies + CF clearance.
        await runBrowserStep('Indiegogo navigate', async () => {
            await page.goto(BASE + '/');
        });

        const rawJson = await runBrowserStep('Indiegogo search API', async () => {
            return await page.evaluate(`(async () => {
                const res = await fetch('${BASE}/api/projectSearch/searchProjects', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        pageSize: ${limit},
                        pageIndex: 0,
                        term: ${JSON.stringify(query)},
                        order: ${SORT_ORDER[sort]},
                    }),
                });
                if (!res.ok) throw new Error('searchProjects HTTP ' + res.status);
                return await res.text();
            })()`);
        });

        let data;
        try {
            data = JSON.parse(rawJson);
        } catch {
            throw new Error('Indiegogo search returned non-JSON payload');
        }

        const items = Array.isArray(data?.pagedItems) ? data.pagedItems : [];
        const now = Date.now();
        const rows = items.map((it) => {
            const end = it.campaignEnd ? Date.parse(it.campaignEnd) : NaN;
            let timeLeft = '';
            if (Number.isFinite(end)) {
                const days = Math.ceil((end - now) / 86400000);
                timeLeft = days > 0 ? `${days} days left` : 'ended';
            }
            return {
                title: it.name || '',
                raised_amt: fmtMoney(it.fundsGatheredPresentation),
                goal_amt: fmtMoney(it.campaignGoal),
                backers: '',
                state: Number.isFinite(end) ? (end > now ? 'live' : 'ended') : 'unknown',
                time_left: timeLeft,
                url: it.projectPageUrl || '',
            };
        }).filter((r) => r.title && r.url);

        const checked = requireRows(rows, 'Indiegogo search');
        if (checked.length === 0) throw emptySearchResults('Indiegogo', query);

        return checked.slice(0, limit).map((item, i) => ({ rank: i + 1, ...item }));
    },
});
