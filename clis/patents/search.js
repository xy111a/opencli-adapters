/**
 * Google Patents search — discover patents by keyword.
 *
 * Uses Browser Bridge (Strategy.PUBLIC) to render the page in a real Chrome
 * session, then extracts patent cards via the Google Patents XHR JSON API
 * (same-origin sync XHR inside the page) with a DOM-scraping fallback.
 *
 * Usage:
 *   opencli patents search "smart ring" --limit 10
 *   opencli patents search "smart ring assignee" --limit 15 -f json
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';

const BASE = 'https://patents.google.com';

// Normalize the assignee field which varies across API shapes.
function normAssignee(a) {
    if (!a) return '';
    if (typeof a === 'string') return a.trim();
    if (Array.isArray(a)) return a.map(normAssignee).filter(Boolean).join('; ');
    if (typeof a === 'object') {
        if (a.assignee) return normAssignee(a.assignee);
        if (a.name) return String(a.name).trim();
        return '';
    }
    return String(a);
}

cli({
    site: 'patents',
    name: 'search',
    description: 'Search Google Patents by keyword (returns patent IDs, assignees, snippets)',
    domain: 'patents.google.com',
    strategy: Strategy.PUBLIC,
    access: 'read',
    browser: true,
    args: [
        { name: 'query', positional: true, required: true, help: 'Search query (e.g. "smart ring assignee")' },
        { name: 'limit', type: 'int', default: 10, min: 1, max: 50, help: 'Number of results (default 10, max 50)' },
    ],
    columns: ['rank', 'patent_id', 'title', 'assignee', 'date', 'snippet', 'url'],
    func: async (page, args) => {
        const query = String(args.query || '').trim();
        const limit = Math.max(1, Math.min(50, Number(args.limit) || 10));
        if (!query) throw new CliError('BAD_INPUT', 'Empty query', 'Provide a search keyword.');

        const searchUrl = BASE + '/?q=' + encodeURIComponent(query);
        await page.goto(searchUrl);

        // Wait for results to render.
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) {
            const count = await page.evaluate(
                'document.querySelectorAll("search-result, .search-result, article").length'
            );
            if (count > 0) break;
            await new Promise((r) => setTimeout(r, 500));
        }

        // Build an IIFE string (query/limit embedded as literals to avoid injection).
        const evalJs = `
(async () => {
  const q = ${JSON.stringify(query)};
  const lim = ${JSON.stringify(limit)};
  const normAssignee = (a) => {
    if (!a) return '';
    if (typeof a === 'string') return a.trim();
    if (Array.isArray(a)) return a.map(normAssignee).filter(Boolean).join('; ');
    if (typeof a === 'object') {
      if (a.assignee) return normAssignee(a.assignee);
      if (a.name) return String(a.name).trim();
      return '';
    }
    return String(a);
  };
  const clean = (s) => (s || '').toString().replace(/ +/g, ' ').trim();
  const stripHtml = (s) => {
    if (!s) return '';
    return String(s)
      .replace(/<[^>]+>/g, '')
      .replace(/&hellip;/g, '…').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ').trim();
  };

  // ---- Primary: Google Patents XHR JSON API (same-origin, sync XHR) ----
  try {
    const xhrUrl = 'https://patents.google.com/xhr/query?url=' +
      encodeURIComponent('q=' + q) + '&num=' + lim;
    const xhr = new XMLHttpRequest();
    xhr.open('GET', xhrUrl, false); // synchronous: opencli evaluate does not await promises
    xhr.withCredentials = true;
    xhr.send();
    if (xhr.status >= 200 && xhr.status < 300) {
      const data = JSON.parse(xhr.responseText);
      const resObj = (data && data.results) || {};
      const clusters = resObj.cluster || [];
      const flat = [];
      for (const c of clusters) { for (const r of (c.result || [])) flat.push(r); }
      const results = Array.isArray(resObj) ? resObj : flat;
      if (results.length > 0) {
        const out = results.slice(0, lim).map((r, i) => {
          const p = r.patent || r;
          const pub = p.publication_number || p.publicationNumber || (r.id ? String(r.id).split('/')[1] : '');
          const url = p.url || ('https://patents.google.com/patent/' + pub);
          const snippet = stripHtml(p.snippet || r.snippet || p.abstract || p.title).slice(0, 280);
          return {
            rank: i + 1,
            patent_id: pub,
            title: stripHtml(p.title).slice(0, 160),
            assignee: normAssignee(p.assignee),
            date: p.priority_date || p.priorityDate || p.publication_date || '',
            snippet: snippet,
            url: url,
          };
        });
        return JSON.stringify(out);
      }
    }
  } catch (e) { /* fall through to DOM */ }

  // ---- Fallback: DOM scraping ----
  const seen = new Set();
  const out = [];
  const nodes = document.querySelectorAll('search-result, .search-result, article');
  for (const node of nodes) {
    const link = node.querySelector('a[href*="/patent/"]');
    if (!link) continue;
    const href = link.href;
    if (!href || seen.has(href)) continue;
    seen.add(href);
    const title = clean((node.querySelector('.search-result-item-title, .title, h3, a') || {}).textContent || link.textContent);
    const assignee = clean((node.querySelector('.search-result-item-assignee, [class*="assignee"]') || {}).textContent);
    const snippet = clean((node.querySelector('.search-result-item-snippet, [class*="snippet"]') || {}).textContent).slice(0, 280);
    const pid = href.split('/patent/').pop().split('/')[0] || '';
    out.push({
      rank: out.length + 1,
      patent_id: pid,
      title: title.slice(0, 160),
      assignee: assignee,
      date: '',
      snippet: snippet,
      url: href,
    });
    if (out.length >= lim) break;
  }
  return JSON.stringify(out);
})()
`;

        const raw = await page.evaluate(evalJs);
        let items = [];
        try {
            items = JSON.parse(raw);
        } catch (e) {
            items = [];
        }

        const rows = Array.isArray(items) ? items : [];
        if (rows.length === 0) {
            throw new CliError('NO_DATA', 'No patents found', 'Google Patents returned no results for: ' + query);
        }
        return rows.slice(0, limit).map((it, i) => ({
            rank: i + 1,
            patent_id: it.patent_id || '',
            title: it.title || '',
            assignee: it.assignee || '',
            date: it.date || '',
            snippet: it.snippet || '',
            url: it.url || '',
        }));
    },
});
