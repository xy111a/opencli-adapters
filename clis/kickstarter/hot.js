/**
 * Kickstarter hot projects — DOM scraping.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';

cli({
    site: 'kickstarter',
    name: 'hot',
    description: 'Get hot Kickstarter projects',
    domain: 'www.kickstarter.com',
    strategy: Strategy.PUBLIC,
    access: 'read',
    browser: true,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Number of results (max 30)' },
    ],
    columns: ['rank', 'title', 'path', 'pledged', 'backers', 'category', 'comments'],
    func: async (page, args) => {
        const limit = Math.min(Number(args.limit) || 20, 30);
        
        // Navigate to Kickstarter discover page with popular sort
        const url = 'https://www.kickstarter.com/discover/advanced?sort=popular';
        
        await page.goto(url);
        
        // Wait for JS to render
        const deadline = Date.now() + 10000;
        while (Date.now() < deadline) {
            const count = await page.evaluate('document.querySelectorAll(\'a[href*="/projects/"]\').length');
            if (count > 0) break;
            await new Promise(r => setTimeout(r, 500));
        }
        
        // Extract projects — Kickstarter card structure
        const domItems = await page.evaluate(`
            (() => {
                const seen = new Set();
                const results = [];
                const cards = document.querySelectorAll('div.project-card-root');
                for (const card of cards) {
                    const linkEl = card.querySelector('a[href*="/projects/"]');
                    if (!linkEl) continue;
                    const href = linkEl.getAttribute('href');
                    if (seen.has(href)) continue;
                    seen.add(href);
                    
                    // Title: prefer .card-title span (actual visible text)
                    const titleEl = card.querySelector('.card-title span, .card-title');
                    let title = titleEl ? titleEl.textContent?.trim() : (linkEl.textContent?.trim() || '');
                    if (!title || title.length < 3) continue;
                    
                    // Pledged/backers/category may not be on discover page — mark unavailable
                    const pledgedEl = card.querySelector('[class*="pledged"]');
                    const pledged = pledgedEl ? pledgedEl.textContent?.trim() : null;
                    
                    const backersEl = card.querySelector('[class*="backers"]');
                    const backers = backersEl ? backersEl.textContent?.trim() : null;
                    
                    const categoryEl = card.querySelector('[class*="category"]');
                    const category = categoryEl ? categoryEl.textContent?.trim() : null;
                    
                    const commentsEl = card.querySelector('[class*="comments"]');
                    const comments = commentsEl ? commentsEl.textContent?.trim() : null;
                    
                    results.push({
                        title: title.substring(0, 120),
                        path: href,
                        pledged: pledged || '$--',
                        backers: backers || '--',
                        category: category || 'General',
                        comments: comments || '0'
                    });
                }
                return results;
            })()
        `);
        
        const items = Array.isArray(domItems) ? domItems : [];
        
        if (items.length === 0) {
            throw new CliError('NO_DATA', 'No projects found', 'Kickstarter may require login or the page structure changed.');
        }
        
        return items.slice(0, limit).map((item, i) => ({
            rank: i + 1,
            title: item.title,
            path: item.path,
            pledged: item.pledged,
            backers: item.backers,
            category: item.category,
            comments: item.comments
        }));
    },
});
