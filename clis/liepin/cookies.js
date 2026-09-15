/**
 * 猎聘 (Liepin) cookie diagnostic — dumps liepin.com cookie names so we can
 * confirm the persistent session and learn the real auth-cookie names.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { requirePage } from './utils.js';

cli({
  site: 'liepin',
  name: 'cookies',
  access: 'read',
  description: 'Dump liepin.com cookie names (diagnostic for auth / session debugging)',
  domain: 'www.liepin.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  siteSession: 'persistent',
  args: [
    { name: 'show', type: 'boolean', default: false, help: 'Also print a truncated preview of each cookie value' },
  ],
  columns: ['name', 'value_preview', 'httpOnly', 'secure', 'sameSite'],
  func: async (page, kwargs) => {
    requirePage(page);
    const cookies = await page.getCookies({ url: 'https://www.liepin.com' });
    const show = !!kwargs.show;
    return (cookies || []).map((c) => {
      const raw = String(c.value || '');
      return {
        name: c.name,
        value_preview: show
          ? raw.slice(0, 16) + (raw.length > 16 ? '…' : '')
          : (raw ? '***' : ''),
        httpOnly: !!c.httpOnly,
        secure: !!c.secure,
        sameSite: c.sameSite || '',
      };
    });
  },
});
