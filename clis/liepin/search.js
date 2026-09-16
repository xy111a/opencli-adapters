/**
 * 猎聘 (Liepin) job search — DOM extraction.
 * Public endpoint, works with or without login (uses persistent cookies when present).
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { requirePage, readPositiveInteger, verbose, EXTRACT_JOB_CARDS_JS } from './utils.js';

// 猎聘搜索按城市筛选用的是 `dqs` 参数 + 城市编码（非中文名、非 `city` 参数）。
// 中文 `?city=杭州` 会被直接忽略，退化成全国推荐流。编码来自猎聘城市选择器 DOM。
const CITY_CODES = {
  北京: '010',
  上海: '020',
  广州: '050020',
  深圳: '050090',
  杭州: '070020',
  成都: '090200',
  武汉: '030200',
  南京: '070030',
  苏州: '050200',
  西安: '200200',
  重庆: '040000',
  长沙: '070060',
  郑州: '150020',
  青岛: '120200',
  厦门: '110220',
  天津: '030000',
  合肥: '080020',
  宁波: '070040',
};

function resolveCityParam(city) {
  if (!city) return null;
  const code = CITY_CODES[city];
  if (code) return { dqs: code };
  verbose(`[liepin] 未收录城市编码 "${city}"，已跳过城市筛选（返回全国结果）`);
  return null;
}


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
    let emptyPages = 0;
    const MAX_PAGES = 12;
    while (all.length < limit && curPage <= MAX_PAGES) {
      const qs = new URLSearchParams();
      if (query) qs.set('key', query);
      const cityParam = resolveCityParam(city);
      if (cityParam) qs.set('dqs', cityParam.dqs);
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
        // 指定城市时，只保留 location 命中该城市的岗位（猎聘深翻页会回落全国推荐流）
        if (city && j.location && !j.location.includes(city)) {
          verbose(`[liepin][city-filter] DROP ${city} not in location="${j.location}" | ${j.company} · ${j.title}`);
          continue;
        }
        seen.add(j.job_id);
        all.push(j);
        added++;
        if (all.length >= limit) break;
      }
      if (added === 0) {
        emptyPages++;
        if (emptyPages >= 3) break; // 连续 3 页无本城市匹配才放弃（猎聘深翻页会回落全国噪声流）
      } else {
        emptyPages = 0;
      }
      curPage++;
    }
    if (all.length === 0) {
      throw new EmptyResultError('liepin search', query ? `No Liepin jobs found for "${query}"` : 'Liepin returned no recommended jobs');
    }
    return all;
  },
});
