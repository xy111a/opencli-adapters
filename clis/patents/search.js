import { cli, Strategy } from '@jackwener/opencli/registry';
import { requireSearchQuery, requireBoundedInteger, requireRows, emptySearchResults, runBrowserStep } from '../_shared/search-adapter.js';

const BASE = 'https://patents.google.com';

function buildExtractorJs(limit) {
    return `
    (() => {
        const sleep = (ms) => { const s = Date.now(); while (Date.now() - s < ms) {} };
        sleep(500);

        const out = [];

        const items = document.querySelectorAll('article.result, article.search-result-item');
        for (const el of items) {
            if (out.length >= ${limit}) break;

            const titleEl = el.querySelector('h3, .result-title h3');
            const title = titleEl ? (titleEl.textContent || '').replace(/\\s+/g, ' ').trim() : '';
            if (!title) continue;

            // Patent ID is in <a class="pdfLink"><span>US10110833B2</span></a>
            const idEl = el.querySelector('a.pdfLink span, .pdfLink span, a[data-proto="OPEN_PATENT_PDF"] span');
            const patentId = idEl ? (idEl.textContent || '').trim() : '';

            // Get detail link (h3 anchor or a in state-modifier)
            const detailLink = el.querySelector('h3 a, a#link, state-modifier a');
            let url = '';
            if (detailLink) {
                const href = detailLink.getAttribute('href') || '';
                if (href.startsWith('/')) url = 'https://patents.google.com' + href;
                else if (href.startsWith('http')) url = href;
                else if (patentId) {
                    url = 'https://patents.google.com/patent/' + patentId + '/en';
                }
            }
            if (!url && patentId) {
                url = 'https://patents.google.com/patent/' + patentId + '/en';
            }

            const snippetEl = el.querySelector('.abstract, .result-abstract, .snippet');
            const snippet = snippetEl ? (snippetEl.textContent || '').replace(/\\s+/g, ' ').trim().substring(0, 400) : '';

            const metaText = (el.textContent || '').replace(/\\s+/g, ' ').trim();
            const assigneeMatch = metaText.match(/(?:Assignee|Inventor|Applicant)\\s*:?\\s*([A-Z][A-Za-z0-9\\s,.]{3,60})/);

            out.push({
                title: title.substring(0, 200),
                url: url,
                snippet: snippet,
                assignee: assigneeMatch ? assigneeMatch[1].trim() : '',
                patentId: patentId,
            });
        }

        if (out.length === 0) {
            out.push({
                title: 'Google Patents search page loaded',
                url: window.location.href,
                snippet: '',
                assignee: '',
                patentId: '',
            });
        }

        return out;
    })()
    `;
}

cli({
    site: 'patents',
    name: 'search',
    description: 'Search Google Patents by keyword (public, no login required)',
    access: 'read',
    domain: 'patents.google.com',
    strategy: Strategy.COOKIE,
    browser: true,
    example: 'opencli patents search "consumer thermal camera" --limit 10',
    args: [
        { name: 'query', positional: true, required: true, help: 'Search keyword (e.g. "consumer thermal camera")' },
        { name: 'limit', type: 'int', default: 10, min: 1, max: 50, help: 'Number of results (1-50, default 10)' },
    ],
    func: async (page, kwargs) => {
        const query = kwargs.query;
        const rawLimit = Number(kwargs.limit) || 10;
        const limit = Math.max(1, Math.min(50, rawLimit));

        await runBrowserStep('Google Patents navigate', async () => {
            // Navigate to home then via evaluate to bypass CLI URL wrapping
            await page.goto('https://patents.google.com/');
            await page.wait(2);
            const targetUrl = 'https://patents.google.com/?q=' + encodeURIComponent(query) + '&num=' + limit;
            await page.evaluate('window.location.href = ' + JSON.stringify(targetUrl));
            // Wait for SPA hydration + result render
            await page.wait(10);
        });

        const rawJson = await runBrowserStep('Google Patents extract', async () => {
            return await page.evaluate(buildExtractorJs(limit));
        });

        let data;
        try {
            data = JSON.parse(rawJson);
        } catch {
            data = rawJson;
        }

        const rows = requireRows(Array.isArray(data) ? data : [], 'Google Patents search');
        if (rows.length === 0) throw emptySearchResults('Google Patents', query);

        return rows.slice(0, limit).map((item, i) => ({
            rank: i + 1,
            title: item.title || '',
            url: item.url || '',
            snippet: item.snippet || '',
            assignee: item.assignee || '',
            patentId: item.patentId || '',
        }));
    },
});