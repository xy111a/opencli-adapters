/**
 * 猎聘 (Liepin) recommended jobs feed — DOM extraction.
 * Mirrors `search` but targets the personalized recommendation stream.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { requirePage, readPositiveInteger, verbose, EXTRACT_JOB_CARDS_JS } from './utils.js';

cli({
  site: 'liepin',
  name: 'recommend',
  access: 'read',
  description: '猎聘为你推荐的职位流（需要登录态以返回个性化推荐）',
  domain: 'www.liepin.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  siteSession: 'persistent',
  args: [
    { name: 'page', type: 'int', default: 1, help: 'Page number' },
    { name: 'limit', type: 'int', default: 15, help: 'Number of results' },
  ],
  columns: ['title', 'salary', 'location', 'experience', 'degree', 'company', 'scale', 'recruiter', 'online', 'is_ad', 'job_id', 'url'],
  func: async (page, kwargs) => {
    requirePage(page);
    const limit = readPositiveInteger(kwargs.limit, 'limit', 15, 100);
    let curPage = readPositiveInteger(kwargs.page, 'page', 1);
    const all = [];
    const seen = new Set();
    while (all.length < limit) {
      const qs = new URLSearchParams();
      qs.set('curPage', String(curPage));
      // zhaopin without a key returns the recommended feed
      const url = `https://www.liepin.com/zhaopin/?${qs.toString()}`;
      verbose(`Capturing recommend page ${curPage}: ${url}`);
      await page.goto(url);
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
      if (added === 0) break;
      curPage++;
    }
    if (all.length === 0) {
      throw new EmptyResultError('liepin recommend', 'Liepin returned no recommended jobs');
    }
    return all;
  },
});
