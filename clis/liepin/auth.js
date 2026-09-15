/**
 * 猎聘 (Liepin) auth adapter — provides `login` and `whoami`.
 * Reuses the shared registerSiteAuthCommands helper so the command shape
 * (persistent cookie session, login polling) matches the built-in boss adapter.
 */
import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

const LIEPIN_HOME = 'https://www.liepin.com/';
const LIEPIN_USER_CENTER = 'https://www.liepin.com/u/';

// Candidate session cookies that only exist when logged in. Confirmed via
// `opencli liepin cookies` — `lt_auth` is the real persistent session token.
const SESSION_COOKIE_CANDIDATES = [
  'lt_auth', 'lpsso_uc', 'lp_stoken', 'LPP', 'liepin_uc', 'user_token', 'lp_token', 'lp_sso',
];

async function hasLiepinSessionCookie(page) {
  const cookies = await page.getCookies({ url: 'https://www.liepin.com' });
  const names = new Set((cookies || []).map((c) => c.name));
  return SESSION_COOKIE_CANDIDATES.some((n) => names.has(n));
}

// Well-known UI strings that are NOT the account name. The header on
// liepin.com contains CTAs like "邀请应聘" / "我要招人" that some loose
// selectors would otherwise match before the real username span renders.
const NON_USERNAME_TOKENS = ['邀请应聘', '我要招人', '你好', '登录', '注册', '立即登录', '免费', '顾问', '猎头', '简历优化'];

function isPlausibleName(text) {
  const t = (text || '').trim();
  if (!t || t.length > 12) return false;
  if (!/[一-龥]/.test(t) && !/[A-Za-z]/.test(t)) return false;
  return !NON_USERNAME_TOKENS.some((d) => t.includes(d));
}

async function verifyLiepinIdentity(page) {
  await page.goto(LIEPIN_USER_CENTER);
  // The header username (`.header-quick-menu-username`, a stable class with no
  // hash suffix) is client-rendered AFTER the SPA hydrates. Poll for it, but
  // ONLY accept the verified username span or the "你好，<name>" body pattern —
  // never the loose selectors that would grab a job-card CTA like "邀请应聘".
  const deadline = Date.now() + 8000;
  let name = '';
  while (Date.now() < deadline) {
    const probe = await page.evaluate(`
      (() => {
        const href = location.href || '';
        if (/\\/login/.test(href) || /\\/passport\\//.test(href) || /\\/user\\/login/.test(href)) {
          return { kind: 'auth', detail: 'Liepin redirected to login: ' + href };
        }
        // 1) Preferred: the stable header username span (no hash suffix).
        const span = document.querySelector('.header-quick-menu-username');
        const preferred = span && span.textContent ? span.textContent.trim() : '';
        if (preferred) return { ok: true, name: preferred };
        // 2) Fallback: body text "你好，<name>" pattern.
        const g = (document.body.innerText || '').match(/你好[，,\\s]+([^\\n,，\\s]{1,12})/);
        if (g && g[1]) return { ok: true, name: g[1].trim() };
        return { ok: true, name: '' };
      })()
    `);
    if (probe?.kind === 'auth') throw new AuthRequiredError('liepin.com', probe.detail);
    if (probe?.name && isPlausibleName(probe.name)) { name = probe.name; break; }
    await page.wait(1);
  }
  return { name };
}

registerSiteAuthCommands({
  site: 'liepin',
  domain: 'liepin.com',
  loginUrl: LIEPIN_HOME,
  columns: ['name'],
  quickCheck: hasLiepinSessionCookie,
  verify: verifyLiepinIdentity,
  poll: async (page) => {
    if (!await hasLiepinSessionCookie(page)) {
      throw new AuthRequiredError('liepin.com', 'Waiting for Liepin session cookies');
    }
    return verifyLiepinIdentity(page);
  },
});

export const __test__ = { LIEPIN_HOME, LIEPIN_USER_CENTER, SESSION_COOKIE_CANDIDATES };
