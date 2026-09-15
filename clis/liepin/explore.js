/**
 * 猎聘 (Liepin) DOM explorer — diagnostic. Navigates to a job-search URL and
 * reports which candidate selectors actually match, plus a text sample, so we
 * can lock down the real DOM structure for the `search` command.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { requirePage, verbose } from './utils.js';

const CANDIDATE_CARD_SELECTORS = [
  'div.job-info', 'div.job-card', 'li.job-list-item', 'div.job-list-item',
  '.sojob-item', '#sojob .job-info', '.job-card-box', 'a.job-title-link',
  '.job-list-box .item', 'div[data-job-id]', '.card-info', '.job-item',
];

cli({
  site: 'liepin',
  name: 'explore',
  access: 'read',
  description: 'Diagnostic: open a Liepin search URL and report which DOM selectors match (for adapter tuning)',
  domain: 'www.liepin.com',
  strategy: Strategy.PUBLIC,
  browser: true,
  navigateBefore: false,
  siteSession: 'persistent',
  args: [
    { name: 'query', positional: true, default: 'AI产品', help: 'Search keyword' },
    { name: 'page', type: 'int', default: 1, help: 'Page number' },
    { name: 'url', default: '', help: 'Override: navigate to this URL instead of a search' },
  ],
  columns: ['url', 'title', 'body_len', 'matched_selectors', 'first_card_html', 'sample'],
  func: async (page, kwargs) => {
    requirePage(page);
    const override = String(kwargs.url ?? '').trim();
    let url;
    if (override) {
      url = override;
    } else {
      const query = encodeURIComponent(String(kwargs.query ?? 'AI产品'));
      const curPage = Number(kwargs.page ?? 1);
      url = `https://www.liepin.com/zhaopin/?key=${query}&curPage=${curPage}`;
    }
    verbose(`Opening ${url}`);
    await page.goto(url);
    // Poll for content to settle
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const len = await page.evaluate('document.body ? document.body.innerText.length : 0');
      if (len > 500) break;
      await page.wait(1);
    }
    const report = await page.evaluate(`
      (() => {
        const title = document.title || '';
        const bodyLen = document.body ? document.body.innerText.length : 0;
        const candidates = ${JSON.stringify(CANDIDATE_CARD_SELECTORS)};
        const matched = {};
        for (const sel of candidates) {
          try { matched[sel] = document.querySelectorAll(sel).length; } catch (e) { matched[sel] = -1; }
        }
        // collect a text sample from the most promising container
        let sample = '';
        const trySels = ['#sojob', '.sojob-list', '.job-list-box', '#search-result', '.search-result', 'div.job-info', '.job-card'];
        for (const s of trySels) {
          const el = document.querySelector(s);
          if (el && el.innerText) { sample = el.innerText.slice(0, 600); break; }
        }
        // also dump classes containing job/card/title/company/salary
        const classStats = {};
        document.querySelectorAll('[class]').forEach(el => {
          el.classList.forEach(c => {
            if (/job|card|title|company|salary|recruit/i.test(c)) classStats[c] = (classStats[c]||0)+1;
          });
        });
        const topClasses = Object.entries(classStats).sort((a,b)=>b[1]-a[1]).slice(0, 30).map(([k,v])=>k+':'+v).join(' ');
        // deep dump of the first job card: tag + class + href + short text
        let firstCard = '';
        let firstCardHtml = '';
        const card = document.querySelector('.job-card-pc-container');
        if (card) {
          const parts = [];
          card.querySelectorAll('a, [class]').forEach(el => {
            const cls = el.className && el.className.toString ? el.className.toString() : '';
            const href = el.getAttribute && el.getAttribute('href') ? el.getAttribute('href') : '';
            const txt = (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40);
            if (href || /title|salary|name|company|recruit|online|area|degree|exp/i.test(cls) || /link|href/.test(href)) {
              parts.push((el.tagName||'') + '.' + cls.split(' ').slice(0,2).join('.') + (href ? ' href=' + href : '') + ' :: ' + txt);
            }
          });
          firstCard = parts.slice(0, 40).join('\\n');
          firstCardHtml = card.outerHTML.replace(/\\s+/g, ' ').slice(0, 3500);
        }
        // scan header / user-area elements for the account name
        const userEls = [];
        document.querySelectorAll('[class*="user"],[class*="name"],[class*="avatar"],[class*="login"],[class*="header"]').forEach(el => {
          const cls = el.className && el.className.toString ? el.className.toString() : '';
          const txt = (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 30);
          const href = el.getAttribute && el.getAttribute('href') ? el.getAttribute('href') : '';
          if (txt && !/^\s*$/.test(txt) && txt.length <= 30) {
            userEls.push((el.tagName||'') + '.' + cls.split(' ').slice(0,2).join('.') + (href ? ' href=' + href : '') + ' :: ' + txt);
          }
        });
        return { title, bodyLen, matched, sample, topClasses, firstCard, firstCardHtml, userEls: userEls.slice(0, 50) };
      })()
    `);
    return [{
      url,
      title: report.title,
      body_len: report.bodyLen,
      matched_selectors: JSON.stringify(report.matched),
      top_classes: report.topClasses,
      first_card: report.firstCard,
      first_card_html: report.firstCardHtml,
      user_els: report.userEls.join('\\n'),
      sample: report.sample,
    }];
  },
});
