/**
 * Fingerprint probe — drives the connected (real) Chrome via opencli's Browser
 * Bridge and audits the automation/bot-detection surface that sites like BOSS
 * (zhipin.com) inspect. Reports each signal with a verdict (OK/SUSPECT/BAD) so we
 * can see what opencli's stealth.js still leaves detectable.
 *
 * Uses several small `page.evaluate` calls (the proven pattern from liepin's
 * explore.js) instead of one giant script, to avoid expression-wrapping issues.
 *
 * Usage:
 *   opencli probe trace                 # navigate to zhipin.com
 *   opencli probe trace --url <url>     # navigate to an arbitrary page first
 */
import { cli, Strategy } from '@jackwener/opencli/registry';

const PROBE_HOME = 'https://www.zhipin.com/';

function verdictFor(signal, value) {
  const v = String(value);
  if (v === '' || v === 'undefined') return '?';
  switch (signal) {
    case 'webdriver': return v === 'true' ? 'BAD' : 'OK';
    case 'chrome_obj': return v === 'undefined' ? 'SUSPECT' : 'OK';
    case 'plugins_count':
    case 'mimeTypes_count': return Number(v) === 0 ? 'SUSPECT' : 'OK';
    case 'cdc_var':
    case 'async_script_info': return v === 'PRESENT' ? 'BAD' : 'OK';
    case 'err_stack_has_pptr': return v === 'YES' ? 'SUSPECT' : 'OK';
    case 'webgl_renderer': return /SwiftShader|Software|llvmpipe/i.test(v) ? 'SUSPECT' : 'OK';
    case 'webgl_vendor': return /Google Inc\.|SwiftShader/i.test(v) && !/Apple|Intel|NVIDIA|AMD/i.test(v) ? 'SUSPECT' : 'OK';
    case 'hardwareConcurrency': return v === '' || v === 'undefined' ? 'SUSPECT' : 'OK';
    case 'deviceMemory': return v === '' || v === 'undefined' ? 'SUSPECT' : 'OK';
    default: return 'OK';
  }
}

const EVALS = [
  ['nav', `(() => ({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    vendor: navigator.vendor,
    language: navigator.language,
    languages: (navigator.languages || []).join(','),
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: navigator.deviceMemory,
    maxTouchPoints: navigator.maxTouchPoints,
    cookieEnabled: navigator.cookieEnabled,
    doNotTrack: navigator.doNotTrack,
    webdriver: navigator.webdriver,
    chrome_obj: typeof window.chrome
  }))()`],

  ['plugins', `(() => {
    const ps = [];
    for (let i = 0; i < (navigator.plugins || []).length; i++) ps.push(navigator.plugins[i].name);
    return {
      plugins_count: navigator.plugins ? navigator.plugins.length : -1,
      plugins: ps.slice(0, 12).join('|'),
      mimeTypes_count: navigator.mimeTypes ? navigator.mimeTypes.length : -1
    };
  })()`],

  ['screen', `(() => ({
    screen_w: screen.width,
    screen_h: screen.height,
    screen_depth: screen.colorDepth,
    dpr: window.devicePixelRatio,
    inner_wh: window.innerWidth + 'x' + window.innerHeight,
    outer_wh: window.outerWidth + 'x' + window.outerHeight
  }))()`],

  ['locale', `(() => {
    let tz = 'err', lc = 'err';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) {}
    try { lc = Intl.DateTimeFormat().resolvedOptions().locale; } catch (e) {}
    return { timezone: tz, locale: lc, tz_offset_min: new Date().getTimezoneOffset() };
  })()`],

  ['fp', `(() => {
    let canvas = 'err', wv = 'no-webgl', wr = 'no-webgl';
    try {
      const c = document.createElement('canvas');
      const x = c.getContext('2d');
      x.textBaseline = 'top';
      x.font = "14px 'Arial'";
      x.fillStyle = '#f60';
      x.fillRect(0, 0, 100, 20);
      x.fillStyle = '#069';
      x.fillText('fp-probe', 2, 2);
      canvas = c.toDataURL().slice(-32);
    } catch (e) { canvas = 'err'; }
    try {
      const cv = document.createElement('canvas');
      const gl = cv.getContext('webgl') || cv.getContext('experimental-webgl');
      if (gl) {
        const d = gl.getExtension('WEBGL_debug_renderer_info');
        wv = d ? gl.getParameter(d.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
        wr = d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      }
    } catch (e) { wv = 'err'; wr = 'err'; }
    return { canvas_hash: canvas, webgl_vendor: wv, webgl_renderer: wr };
  })()`],

  ['det', `(() => {
    const cdc = (typeof window.$cdc_ !== 'undefined' || typeof document.$cdc_ !== 'undefined') ? 'PRESENT' : 'absent';
    const asi = typeof window.$chrome_asyncScriptInfo !== 'undefined' ? 'PRESENT' : 'absent';
    let cl = 'err';
    try { cl = Function.prototype.toString.call(console.log).slice(0, 30); } catch (e) {}
    let st = 'no';
    try { const s = new Error().stack || ''; st = /puppeteer_evaluation_script|pptr:/.test(s) ? 'YES' : 'no'; } catch (e) { st = 'err'; }
    let pn = 'no';
    try { const a = performance.now(), b = performance.now(); pn = a === b ? 'yes' : 'no'; } catch (e) { pn = 'err'; }
    const bat = typeof navigator.getBattery !== 'undefined' ? 'present' : 'absent';
    return { cdc_var: cdc, async_script_info: asi, console_log_src: cl, err_stack_has_pptr: st, perf_now_equal: pn, battery_api: bat };
  })()`],

  ['uad', `(() => {
    try {
      if (navigator.userAgentData) {
        return {
          ua_brands: (navigator.userAgentData.brands || []).map(b => b.brand + '/' + b.version).join(','),
          ua_mobile: String(navigator.userAgentData.mobile)
        };
      }
      return { ua_brands: 'absent', ua_mobile: 'absent' };
    } catch (e) { return { ua_brands: 'err', ua_mobile: 'err' }; }
  })()`],
];

cli({
  site: 'probe',
  name: 'trace',
  access: 'read',
  description: 'Audit the browser automation/bot-detection fingerprint surface under opencli (real Chrome)',
  domain: 'www.zhipin.com',
  strategy: Strategy.PUBLIC,
  browser: true,
  navigateBefore: false,
  siteSession: 'persistent',
  args: [
    { name: 'url', default: '', help: 'Navigate to this URL before probing (default: zhipin.com)' },
  ],
  columns: ['signal', 'value', 'verdict'],
  func: async (page, kwargs) => {
    const target = String(kwargs.url ?? '').trim() || PROBE_HOME;
    // eslint-disable-next-line no-console
    console.error('[probe] navigating to ' + target);
    await page.goto(target);
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      const len = await page.evaluate('document.body ? document.body.innerText.length : 0');
      if (len > 200) break;
      await page.wait(1);
    }
    const raw = {};
    for (const [group, js] of EVALS) {
      const part = await page.evaluate(js);
      Object.assign(raw, part || {});
    }
    const rows = Object.keys(raw).map((k) => ({
      signal: k,
      value: String(raw[k]),
      verdict: verdictFor(k, raw[k]),
    }));
    const order = { BAD: 0, SUSPECT: 1, '?': 2, OK: 3 };
    rows.sort((a, b) => (order[a.verdict] - order[b.verdict]) || a.signal.localeCompare(b.signal));
    return rows;
  },
});
