import { CommandExecutionError } from '@jackwener/opencli/errors';

/**
 * Assert that page is available (non-null).
 */
export function requirePage(page) {
  if (!page) throw new CommandExecutionError('Browser page required');
}

/**
 * Verbose log helper — prints when OPENCLI_VERBOSE is set.
 */
export function verbose(msg) {
  if (process.env.OPENCLI_VERBOSE) {
    console.error(`[opencli:liepin] ${msg}`);
  }
}

/**
 * Read a positive integer arg with fallback/ceiling.
 */
export function readPositiveInteger(raw, name, fallback, max) {
  const value = raw === undefined || raw === null || raw === '' ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new CommandExecutionError(`liepin ${name} must be a positive integer`);
  }
  if (max !== undefined && value > max) {
    throw new CommandExecutionError(`liepin ${name} must be <= ${max}`);
  }
  return value;
}

/**
 * In-page job-card extraction, shared by `search` and `recommend`.
 * Uses STABLE attributes (data-nick) and text regexes instead of Liepin's
 * hashed CSS classes (e.g. `_40108XXXX`), which change per build.
 * Returns an array of plain objects.
 */
export const EXTRACT_JOB_CARDS_JS = `
  (() => {
    const cards = Array.from(document.querySelectorAll('.job-card-pc-container'));
    const out = [];
    for (const card of cards) {
      const link = card.querySelector('a[data-nick="job-detail-job-info"]');
      const href = link ? (link.getAttribute('href') || '') : '';
      const m = href && href.match(/\\/job\\/(\\d+)\\.shtml/);
      const jobId = m ? m[1] : '';
      const titleDiv = link ? link.querySelector('div.ellipsis-1') : null;
      const title = titleDiv ? (titleDiv.textContent || '').trim() : '';
      const text = (card.innerText || '').replace(/\\s+/g, ' ');
      const locM = text.match(/【([^】]+)】/);
      const location = locM ? locM[1].trim() : '';
      const salM = text.match(/(\\d+(?:\\.\\d+)?(?:-\\d+(?:\\.\\d+)?)?k)/i);
      const salary = salM ? salM[1] : '';
      const expM = text.match(/(\\d+-\\d+年|\\d+年以上|\\d+年以内|经验不限|应届|在校)/);
      const experience = expM ? expM[1] : '';
      const degM = text.match(/(?:统招)?(本科|硕士|大专|博士|高中|中专|初中)/);
      const degree = degM ? degM[1] : '';
      const compBox = card.querySelector('div[data-nick="job-detail-company-info"]');
      const compEls = compBox ? compBox.querySelectorAll('.ellipsis-1') : [];
      const company = compEls[0] ? (compEls[0].textContent || '').trim() : '';
      const scale = compEls[1] ? (compEls[1].textContent || '').replace(/\\s+/g, ' ').trim() : '';
      const recBox = card.querySelector('.recruiter-info-box');
      const recEls = recBox ? recBox.querySelectorAll('.ellipsis-1') : [];
      const recruiter = recEls[0] ? (recEls[0].textContent || '').trim() : '';
      const online = recEls[1] ? (recEls[1].textContent || '').trim() : '';
      const isAd = /广告/.test(text);
      out.push({
        title, salary, location, experience, degree, company, scale,
        recruiter, online, is_ad: isAd, job_id: jobId,
        url: href ? (href.startsWith('http') ? href : 'https://www.liepin.com' + href) : '',
      });
    }
    return out;
  })()
`;
