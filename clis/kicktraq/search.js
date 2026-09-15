/**
 * Kicktraq - Kickstarter project analytics and tracking.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';

cli({
    site: 'kicktraq',
    name: 'search',
    description: 'Search Kicktraq for project analytics',
    domain: 'www.kicktraq.com',
    strategy: Strategy.PUBLIC,
    access: 'read',
    browser: true,
    args: [
        { name: 'query', positional: true, required: true, help: 'Search query (project name or keyword)' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of results (max 30)' },
    ],
    columns: ['rank', 'name', 'status', 'url'],
    func: async (page, args) => {
        const limit = Math.min(Number(args.limit) || 20, 30);
        const query = encodeURIComponent(String(args.query || ''));
        
        const url = `https://www.kicktraq.com/search/?find=${query}`;
        
        await page.goto(url);
        
        // Wait for content
        await new Promise(r => setTimeout(r, 3000));
        
        // Extract using simpler selector approach
        const domItems = await page.evaluate(`
            (() => {
                const seen = new Set();
                const results = [];
                
                // Find project links in the listings
                const links = document.querySelectorAll('a[href*="/projects/"]');
                
                links.forEach((link) => {
                    const href = link.getAttribute('href');
                    const title = link.textContent?.trim() || '';
                    
                    // Filter for valid project links
                    if (!title || title.length < 3) return;
                    if (href === '/projects/' || href === '/projects') return;
                    if (href.split('/').length < 4) return;  // Need at least /projects/x/y
                    
                    if (seen.has(href)) return;
                    seen.add(href);
                    
                    results.push({
                        name: title.substring(0, 100),
                        path: href
                    });
                });
                
                return results;
            })()
        `);
        
        const items = Array.isArray(domItems) ? domItems : [];
        
        if (items.length === 0) {
            throw new CliError('NO_DATA', 'No projects found', 'Try a different search term.');
        }
        
        return items.slice(0, limit).map((item, i) => ({
            rank: i + 1,
            name: item.name,
            status: '-',
            url: 'https://www.kicktraq.com' + item.path
        }));
    },
});

// Browse projects with filters
cli({
    site: 'kicktraq',
    name: 'browse',
    description: 'Browse Kicktraq active projects',
    domain: 'www.kicktraq.com',
    strategy: Strategy.PUBLIC,
    access: 'read',
    browser: true,
    args: [
        { name: 'sort', default: 'newest', help: 'Sort: newest, ending, most-funded' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of results (max 30)' },
    ],
    columns: ['rank', 'name', 'category', 'url'],
    func: async (page, args) => {
        const limit = Math.min(Number(args.limit) || 20, 30);
        
        // Navigate to projects page
        await page.goto('https://www.kicktraq.com/projects/');
        
        await new Promise(r => setTimeout(r, 3000));
        
        // Extract projects
        const domItems = await page.evaluate(`
            (() => {
                const seen = new Set();
                const results = [];
                
                const links = document.querySelectorAll('a[href*="/projects/"]');
                
                links.forEach((link) => {
                    const href = link.getAttribute('href');
                    const title = link.textContent?.trim() || '';
                    
                    if (!title || title.length < 3) return;
                    if (!href.match(/\\/projects\\/[^/]+\\/[^/]+/)) return;
                    if (seen.has(href)) return;
                    seen.add(href);
                    
                    // Try to find category nearby
                    let category = '';
                    const row = link.closest('div');
                    if (row) {
                        const catEl = row.querySelector('[class*="cat"]');
                        if (catEl) category = catEl.textContent?.trim() || '';
                    }
                    
                    results.push({
                        name: title.substring(0, 100),
                        category: category.substring(0, 30),
                        path: href
                    });
                });
                
                return results;
            })()
        `);
        
        const items = Array.isArray(domItems) ? domItems : [];
        
        if (items.length === 0) {
            throw new CliError('NO_DATA', 'No projects found', 'Page may be empty.');
        }
        
        return items.slice(0, limit).map((item, i) => ({
            rank: i + 1,
            name: item.name,
            category: item.category || '-',
            url: 'https://www.kicktraq.com' + item.path
        }));
    },
});

// Get project details
cli({
    site: 'kicktraq',
    name: 'project',
    description: 'Get detailed info on a specific project',
    domain: 'www.kicktraq.com',
    strategy: Strategy.PUBLIC,
    access: 'read',
    browser: true,
    args: [
        { name: 'project', positional: true, required: true, help: 'Project name or Kicktraq URL path' },
    ],
    columns: ['field', 'value'],
    func: async (page, args) => {
        const project = String(args.project || '');
        
        // Build URL
        let url;
        if (project.includes('kicktraq.com')) {
            url = project;
        } else if (project.includes('/projects/')) {
            url = 'https://www.kicktraq.com' + project;
        } else {
            // Search for the project
            url = `https://www.kicktraq.com/search/?find=${encodeURIComponent(project)}`;
        }
        
        await page.goto(url);
        
        await new Promise(r => setTimeout(r, 3000));
        
        // Extract project details
        const details = await page.evaluate(`
            (() => {
                const result = {};
                
                // Title
                const titleEl = document.querySelector('#project-title h2');
                result.title = titleEl?.textContent?.trim() || '';
                
                // Creator
                const creatorEl = document.querySelector('#project-title span');
                result.creator = creatorEl?.textContent?.trim() || '';
                
                // Status
                const statusEl = document.querySelector('#project-info h3');
                result.status = statusEl?.textContent?.trim() || '';
                
                // Days/hours/minutes
                const daysEl = document.querySelector('#clock-days');
                const hoursEl = document.querySelector('#clock-hours');
                const minsEl = document.querySelector('#clock-mins');
                result.days = daysEl?.textContent?.trim() || '0';
                result.hours = hoursEl?.textContent?.trim() || '0';
                result.mins = minsEl?.textContent?.trim() || '0';
                
                return result;
            })()
        `);
        
        if (!details.title) {
            throw new CliError('NO_DATA', 'Project not found', 'Check the project name or URL.');
        }
        
        return [
            { field: 'Title', value: details.title },
            { field: 'Creator', value: details.creator },
            { field: 'Status', value: details.status },
            { field: 'Time Left', value: `${details.days}d ${details.hours}h ${details.mins}m` }
        ];
    },
});

// Hot list - trending projects
cli({
    site: 'kicktraq',
    name: 'hot',
    description: 'Kicktraq hot list - trending projects',
    domain: 'www.kicktraq.com',
    strategy: Strategy.PUBLIC,
    access: 'read',
    browser: true,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Number of results (max 30)' },
    ],
    columns: ['rank', 'name', 'url'],
    func: async (page, args) => {
        const limit = Math.min(Number(args.limit) || 20, 30);
        
        await page.goto('https://www.kicktraq.com/hotlist/');
        
        await new Promise(r => setTimeout(r, 3000));
        
        const domItems = await page.evaluate(`
            (() => {
                const seen = new Set();
                const results = [];
                
                const links = document.querySelectorAll('a[href*="/projects/"]');
                
                links.forEach((link) => {
                    const href = link.getAttribute('href');
                    const title = link.textContent?.trim() || '';
                    
                    if (!title || title.length < 3) return;
                    if (!href.match(/\\/projects\\/[^/]+\\/[^/]+/)) return;
                    if (seen.has(href)) return;
                    seen.add(href);
                    
                    results.push({
                        name: title.substring(0, 100),
                        path: href
                    });
                });
                
                return results;
            })()
        `);
        
        const items = Array.isArray(domItems) ? domItems : [];
        
        if (items.length === 0) {
            throw new CliError('NO_DATA', 'No projects found', 'Hot list may be empty.');
        }
        
        return items.slice(0, limit).map((item, i) => ({
            rank: i + 1,
            name: item.name,
            url: 'https://www.kicktraq.com' + item.path
        }));
    },
});
