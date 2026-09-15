/**
 * Indiegogo project search and discovery with detailed data.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';

async function extractProjects(page, limit) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
        const count = await page.evaluate('document.querySelectorAll(\'a[href*="/projects/"]\').length');
        console.log('Poll count:', count);
        if (count > 5) break;
        await new Promise(r => setTimeout(r, 500));
    }
    await page.evaluate(() => window.scrollBy(0, 800));
    await new Promise(r => setTimeout(r, 1500));

    const links = await page.evaluate(`
        (() => {
            const seen = new Set();
            const results = [];
            document.querySelectorAll('a[href*="/projects/"]').forEach((link) => {
                const href = link.getAttribute('href');
                const title = link.getAttribute('title') || link.textContent?.trim() || '';
                if (!title || title.length < 3) return;
                if (href.includes('/users/') || href.includes('/about') || href.includes('/faq') || href.includes('/discover')) return;
                if (seen.has(href)) return;
                seen.add(href);
                results.push({ title: title.substring(0, 120), path: href });
            });
            return results;
        })()
    `);
    return (Array.isArray(links) ? links : []).slice(0, limit);
}

async function getProjectDetails(page, path) {
    try {
        await page.goto(`https://www.indiegogo.com${path}`, { waitUntil: 'networkidle2', timeout: 15000 });
        
        // Wait for the amount element to appear (JS-rendered)
        try {
            await page.waitForSelector('[data-qa="project-summary:Gathered"]', { timeout: 8000 });
        } catch (e) {
            // Try alternate selector
            try {
                await page.waitForSelector('[data-qa="project-summary:Funded"]', { timeout: 5000 });
            } catch (e2) {
                // Element not found, will proceed with whatever is rendered
            }
        }

        const details = await page.evaluate(`
            (() => {
                const result = { amount: '-', backers: '-', category: '-', comments: '-' };
                
                // Amount raised
                const amountEl = document.querySelector('[data-qa="project-summary:Gathered"]') ||
                    document.querySelector('[data-qa="project-summary:Funded"]');
                if (amountEl) {
                    const text = amountEl.textContent?.trim() || '';
                    const m = text.match(/\$([\d,]+)/);
                    result.amount = m ? '$' + m[1] : text;
                }

                // Backers
                const backersEl = document.querySelector('[data-qa="project-summary:BackersCount"]');
                if (backersEl) {
                    const text = backersEl.textContent?.trim() || '';
                    const m = text.match(/(\d+)/);
                    result.backers = m ? m[1] : text;
                }

                // Category — first sidebar category
                const catEl = document.querySelector('[data-qa^="sidebar-category-section:"]');
                if (catEl) result.category = catEl.textContent?.trim().substring(0, 50) || '-';

                // Comments — try to find comment count
                const commentEl = document.querySelector('[data-qa*="comment"]');
                if (commentEl) {
                    const m = commentEl.textContent?.match(/(\d+)/);
                    if (m) result.comments = m[1];
                }

                return result;
            })()
        `);
        return details;
    } catch (e) {
        return { amount: '-', backers: '-', category: '-', comments: '-' };
    }
}

cli({
    site: 'indiegogo',
    name: 'browse',
    description: 'Browse trending Indiegogo projects with details',
    domain: 'www.indiegogo.com',
    strategy: Strategy.PUBLIC,
    access: 'read',
    browser: true,
    args: [
        { name: 'sort', default: 'trending', help: 'Sort: trending, newest, endingSoon, mostFunded' },
        { name: 'limit', type: 'int', default: 10, help: 'Number of results (max 10)' },
    ],
    columns: ['rank', 'title', 'category', 'url'],
    func: async (page, args) => {
        const limit = Math.min(Number(args.limit) || 10, 10);
        const sort = args.sort || 'trending';
        const url = `https://www.indiegogo.com/explore/all?sort=${sort}`;
        
        await page.goto(url);
        const projects = await extractProjects(page, limit);
        
        if (projects.length === 0) {
            throw new CliError('NO_DATA', 'No projects found', 'Try a different sort.');
        }

        return projects.slice(0, limit).map((item, i) => ({
            rank: i + 1,
            title: item.title,
            category: item.category || 'General',
            url: item.path.startsWith('http') ? item.path : 'https://www.indiegogo.com' + item.path
        }));
    },
});

cli({
    site: 'indiegogo',
    name: 'search',
    description: 'Search Indiegogo projects with details',
    domain: 'www.indiegogo.com',
    strategy: Strategy.PUBLIC,
    access: 'read',
    browser: true,
    args: [
        { name: 'query', positional: true, required: false, help: 'Search query' },
        { name: 'sort', default: 'trending', help: 'Sort: trending, newest, endingSoon, mostFunded' },
        { name: 'limit', type: 'int', default: 10, help: 'Number of results (max 10)' },
    ],
    columns: ['rank', 'title', 'category', 'url'],
    func: async (page, args) => {
        const limit = Math.min(Number(args.limit) || 10, 10);
        const query = args.query ? encodeURIComponent(String(args.query)) : '';
        const sort = args.sort || 'trending';
        
        let url = `https://www.indiegogo.com/explore/all?sort=${sort}`;
        if (query) url += `&search_term=${query}`;
        
        await page.goto(url);
        const projects = await extractProjects(page, limit);
        
        if (projects.length === 0) {
            throw new CliError('NO_DATA', 'No projects found', 'Try a different query.');
        }

        return projects.slice(0, limit).map((item, i) => ({
            rank: i + 1,
            title: item.title,
            category: item.category || 'General',
            url: item.path.startsWith('http') ? item.path : 'https://www.indiegogo.com' + item.path
        }));
    },
});

cli({
    site: 'indiegogo',
    name: 'explore',
    description: 'Explore Indiegogo by category',
    domain: 'www.indiegogo.com',
    strategy: Strategy.PUBLIC,
    access: 'read',
    browser: true,
    args: [
        { name: 'category', required: true, help: 'Category: technology, design, games, film, music, art, fashion, food, photography, comics, journalism' },
        { name: 'sort', default: 'trending', help: 'Sort: trending, newest, endingSoon, mostFunded' },
        { name: 'limit', type: 'int', default: 10, help: 'Number of results (max 10)' },
    ],
    columns: ['rank', 'title', 'creator'],
    func: async (page, args) => {
        const limit = Math.min(Number(args.limit) || 10, 10);
        const category = args.category || 'technology';
        const sort = args.sort || 'trending';
        const url = `https://www.indiegogo.com/explore/${category}?sort=${sort}`;
        
        await page.goto(url);
        const projects = await extractProjects(page, limit);
        
        if (projects.length === 0) {
            throw new CliError('NO_DATA', 'No projects found', 'Category may be empty.');
        }
        return projects.map((item, i) => ({
            rank: i + 1, title: item.title, creator: (item.path.match(/\/projects\/([^\/]+)\//) || [])[1] || '-'
        }));
    },
});
