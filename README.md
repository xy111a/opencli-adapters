# opencli-adapters

我自己的 [opencli](https://github.com/jackwener/opencli) 第三方站点适配器集合。opencli 内置适配器之外，这里收我自己写/维护的站点适配器，方便在多台机器间同步，也方便以后继续加更多。

> **关于 BOSS 直聘（boss）适配器**：它是 opencli **上游内置**的，不是我写的，所以本仓库**不持有 boss 代码**。我对它的 `whoami` 有个修复（SPA 渲染延迟导致误报 `AUTH_REQUIRED`），以补丁形式放在 [`patches/boss-whoami-polling-fix.md`](patches/boss-whoami-polling-fix.md)。

## 收录的适配器

| 站点 | 目录 | 命令 | 说明 |
|---|---|---|---|
| 猎聘 Liepin | `clis/liepin` | `login` / `whoami` / `cookies` / `explore` / `search` / `recommend` | 招聘职位搜索 + 个性化推荐流（DOM 提取，登录后数据更完整） |
| Indiegogo | `clis/indiegogo` | `search` | 众筹项目搜索与发现 |
| Kickstarter | `clis/kickstarter` | `hot` / `search` | 热门项目 + 项目搜索 |
| Kicktraq | `clis/kicktraq` | `search` | Kickstarter 项目数据分析与追踪 |
| Google Patents | `clis/patents` | `search` | 按关键词检索专利 |

所有适配器都依赖 opencli 运行时（通过 `@jackwener/opencli/registry` 和 `@jackwener/opencli/errors` 注册命令）。

## 安装

opencli 会自动加载 `~/.opencli/clis/<site>/` 下的适配器（优先级高于 npm 包内置）。

```bash
# 安装全部
cp -R clis/* ~/.opencli/clis/

# 只装某一个（例如猎聘）
cp -R clis/liepin ~/.opencli/clis/
# 猎聘依赖 clis/_shared/site-auth.js，装 liepin 时要把 _shared 一起复制
cp -R clis/_shared ~/.opencli/clis/_shared
```

装完验证：

```bash
opencli adapter status   # 应列出你的自定义站点（标记 [custom]）
opencli validate <site>  # 检查命令定义是否合法
```

## 新增一个适配器

1. 在 `clis/<site>/` 下建目录，文件名即命令名（如 `search.js` → `<site> search`）。
2. 用 `cli({ site, args, func, columns })` 注册（`import { cli, Strategy } from '@jackwener/opencli/registry'`）。
3. 需要登录态的命令，复用 `../_shared/site-auth.js` 的 `registerSiteAuthCommands`（已放在本仓库 `clis/_shared/`，与 opencli 上游一致）。
4. 浏览器交互：`requirePage(page)` 断言页面存在；`page.evaluate(\`...\`)` 以**字符串形式**传函数体做 DOM 提取。
5. 参考 `clis/liepin/` 作为完整模板（含 auth / search / utils / 诊断命令）。

## 目录结构

```
opencli-adapters/
├── clis/
│   ├── _shared/site-auth.js            # 登录态 helper（源自 opencli 上游）
│   ├── liepin/                         # 猎聘（自写）
│   ├── indiegogo/                      # Indiegogo
│   ├── kickstarter/                    # Kickstarter
│   ├── kicktraq/                       # Kicktraq
│   └── patents/                        # Google Patents
├── patches/
│   └── boss-whoami-polling-fix.md      # boss whoami 修复补丁（针对上游内置）
├── README.md
├── LICENSE
└── .gitignore
```

## 许可证

- `clis/<site>/` 下各适配器：**MIT © xy111a**
- `clis/_shared/site-auth.js`：源自 [@jackwener/opencli](https://github.com/jackwener/opencli) 上游，保留其原有许可证。
- `patches/`：针对 [@jackwener/opencli](https://github.com/jackwener/opencli) 的修改，遵循上游许可证。
