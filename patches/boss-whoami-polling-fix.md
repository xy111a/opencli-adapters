# 修复：BOSS 直聘 `whoami` 误报 AUTH_REQUIRED

## 问题

opencli v1.8.7 内置的 BOSS 适配器，`whoami` 在登录态正常时偶尔报：

```
error:
  code: AUTH_REQUIRED
  message: 'Boss path does not look like authenticated geek/recruiter page: blank'
```

而 `boss search` 等实际功能一直正常（说明 cookie 没失效，是 `whoami` 的页面探测误判）。

## 根因

`clis/boss/auth.js` 的 `verifyBossIdentity` 在 `page.goto` 后只 `wait(3)` 秒就检查 `location.pathname`。BOSS 前端是 SPA，客户端渲染偶尔慢一拍，`pathname` 还是空字符串时就被判定为「未登录」（报 `blank`）。

## 修复

把「等待 3 秒 + 单次判定」改成「轮询最多 8 秒，等页面路由稳定」。

打开 `~/.opencli/node_modules/@jackwener/opencli/clis/boss/auth.js`，将整个 `verifyBossIdentity` 函数替换为下面内容：

```js
async function verifyBossIdentity(page) {
  if (!await hasBossSessionCookie(page)) {
    throw new AuthRequiredError('zhipin.com', 'Boss wt2 / t cookies missing');
  }
  await page.goto(BOSS_GEEK_JOBS_URL);
  // BOSS is a SPA: the client-side render can leave location.pathname blank for a
  // moment after navigation, which made whoami mis-report AUTH_REQUIRED. Poll until
  // the page settles (matches an authenticated geek/recruiter route or a login redirect).
  let probe = null;
  for (let i = 0; i < 8; i++) {
    await page.wait(1);
    probe = await page.evaluate(`
      (() => {
        const path = location.pathname || '';
        if (/\\/web\\/user\\/login|\\/login\\.html/.test(location.href)) {
          return { kind: 'auth', detail: 'Boss redirected to login page' };
        }
        const userType = /\\/web\\/geek\\//.test(path) ? 'geek' : /\\/web\\/(boss|recruit|chat\\/boss)/.test(path) ? 'recruiter' : '';
        if (!userType) {
          return { kind: 'pending', detail: 'Boss path not settled yet: ' + (path || 'blank') };
        }
        return { ok: true, user_type: userType };
      })()
    `);
    if (probe?.ok || probe?.kind === 'auth') break;
  }
  if (probe?.kind === 'auth') throw new AuthRequiredError('zhipin.com', probe.detail);
  if (!probe?.ok) throw new CommandExecutionError(`Unexpected Boss probe: ${JSON.stringify(probe)}`);
  return { user_type: probe.user_type };
}
```

## 说明

- 这是针对 opencli **上游内置**适配器的修改，本仓库不持有 boss 代码。
- opencli 升级（`brew upgrade opencli`）会覆盖此文件，需重新应用本补丁。
- 更彻底的做法是向上游提 PR（欢迎）。
