/**
 * 猎聘 (Liepin) job search — DOM extraction.
 * Public endpoint, works with or without login (uses persistent cookies when present).
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { requirePage, readPositiveInteger, verbose, EXTRACT_JOB_CARDS_JS } from './utils.js';

cli({
  site: 'liepin',
  name: 'search',
  access: 'read',
  description: '猎聘搜索职位（关键词留空则返回为您推荐的职位）',
  domain: 'www.liepin.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  siteSession: 'persistent',
  args: [
    { name: 'query', positional: true, help: 'Search keyword (optional, empty = recommended jobs)' },
    { name: 'city', default: '', help: 'City name to filter (e.g. 杭州, 上海, 北京)' },
    { name: 'page', type: 'int', default: 1, help: 'Page number' },
    { name: 'limit', type: 'int', default: 15, help: 'Number of results' },
  ],
  columns: ['title', 'salary', 'location', 'experience', 'degree', 'company', 'scale', 'recruiter', 'online', 'is_ad', 'job_id', 'url'],
  func: async (page, kwargs) => {
    requirePage(page);
    const query = String(kwargs.query ?? '').trim();
    const city = String(kwargs.city ?? '').trim();
    const limit = readPositiveInteger(kwargs.limit, 'limit', 15, 100);
    let curPage = readPositiveInteger(kwargs.page, 'page', 1);
    const all = [];
    const seen = new Set();
    while (all.length < limit) {
      const qs = new URLSearchParams();
      if (query) qs.set('key', query);
      if (city) qs.set('city', city);
      qs.set('curPage', String(curPage));
      const url = `https://www.liepin.com/zhaopin/?${qs.toString()}`;
      verbose(`Capturing page ${curPage}: ${url}`);
      await page.goto(url);
      // Poll for cards to render
      const deadline = Date.now() + 8000;
      let count = 0;
      while (Date.now() < deadline) {
        count = await page.evaluate('document.querySelectorAll(".job-card-pc-container").length');
        if (count > 0) break;
        await page.wait(1);
      }
      const batch = await page.evaluate(EXTRACT_JOB_CARDS_JS);
      if (!Array.isArray(batch) || batch.length === 0) break;
      let added = 0;
      for (const j of batch) {
        if (!j.job_id || seen.has(j.job_id)) continue;
        seen.add(j.job_id);
        all.push(j);
        added++;
        if (all.length >= limit) break;
      }
      if (added === 0) break; // duplicate page, stop
      curPage++;
    }
    if (all.length === 0) {
      throw new EmptyResultError('liepin search', query ? `No Liepin jobs found for "${query}"` : 'Liepin returned no recommended jobs');
    }
    return all;
  },
});
