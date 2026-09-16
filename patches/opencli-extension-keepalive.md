# 补丁：opencli Browser Bridge 扩展保活（MV3 service worker 挂起修复）

## 问题

opencli 的 Browser Bridge 扩展是 **MV3**，后台是 service worker（`~/.opencli/opencli-extension/dist/background.js`）。
MV3 service worker 在空闲约 30s 后会被 Chrome 挂起，WS（`ws://localhost:19825/ext`）随之断开。
`opencli profile list` 仍显示 `connected`（daemon 缓存的注册态），但真正派发命令时扩展 SW 已休眠 →
命令失败：`code: BROWSER_CONNECT / Browser Bridge extension not connected`。

现象：每次 `opencli <site> <cmd>` 等约 60s 仍接不住 SW 的 24s 重连窗口，且 daemon 可能持有旧死连接。

## 修复

在 `background.js` 的 `ws.onopen` 里加一个 **10s 心跳**：周期性 `fetch(DAEMON_PING_URL)`（复用扩展已有的 `/ping` 端点），
让 SW 永不休眠，WS 因此持续打开。完全不碰 daemon 协议，零风险。

改动点（均在 `dist/background.js`）：

1. 新增模块级变量：`let heartbeatTimer = null;`（在 `let reconnectTimer = null;` 附近）
2. `ws.onopen` 末尾加：
   ```js
   if (heartbeatTimer) clearInterval(heartbeatTimer);
   heartbeatTimer = setInterval(() => {
     fetch(DAEMON_PING_URL, { signal: AbortSignal.timeout(1e3) }).catch(() => {});
   }, 1e4);
   ```
3. `ws.onclose` 与 `ws.onerror` 里 `clearInterval(heartbeatTimer); heartbeatTimer = null;`
4. `ws.onmessage` 里对 `command?.type === "ping"` 直接 `return`（忽略 daemon 心跳，可选）

## 验证

`node --check dist/background.js` 通过后，以**用户身份**重启 Chrome 加载扩展：
```
pkill -f "Google Chrome.app"; open -a "Google Chrome" --args --load-extension=/Users/huajun/.opencli/opencli-extension
```
（⚠️ 不能用 Bash 工具直接 `opencli chrome-opencli`/nohup 启动 Chrome —— macOS TCC 会拒绝写
`~/Library/Application Support/Google/Chrome/SingletonLock`，导致 Chrome abort。必须 `open -a` 以用户 GUI 身份启动。）
重启后 `opencli profile list` 稳定 `connected`，命令不再掉线。

## ⚠️ 升级会被覆盖

`brew upgrade opencli` 可能覆写 `~/.opencli/opencli-extension/`。升级后若发现 bridge 又开始掉线，重新应用本补丁。
