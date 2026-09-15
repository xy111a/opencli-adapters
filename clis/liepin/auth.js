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

async function verifyLiepinIdentity(page) {
  await page.goto(LIEPIN_USER_CENTER);
  // The header username is client-rendered — poll for it (or a login redirect).
  const deadline = Date.now() + 6000;
  let name = '';
  while (Date.now() < deadline) {
    const probe = await page.evaluate(`
      (() => {
        const href = location.href || '';
        if (/\\/login/.test(href) || /\\/passport\\//.test(href) || /\\/user\\/login/.test(href)) {
          return { kind: 'auth', detail: 'Liepin redirected to login: ' + href };
        }
        const selectors = [
          '.header-quick-menu-username', '.user-info .name', '.header .username',
          '[class*="user-name"]', '.uname', '.nickname', '[class*="nick"]',
          '.user-name', 'a[href*="/u/"] .name', '.top-user .name', '[data-nick="user-name"]',
        ];
        let n = '';
        for (const s of selectors) {
          const el = document.querySelector(s);
          if (el && el.textContent && el.textContent.trim()) { n = el.textContent.trim(); break; }
        }
        if (!n) {
          const g = (document.body.innerText || '').match(/你好[，,\\s]*([^\\n,，]{1,20})/);
          if (g) n = g[1].trim();
        }
        return { ok: true, name: n };
      })()
    `);
    if (probe?.kind === 'auth') throw new AuthRequiredError('liepin.com', probe.detail);
    if (probe?.name) { name = probe.name; break; }
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
