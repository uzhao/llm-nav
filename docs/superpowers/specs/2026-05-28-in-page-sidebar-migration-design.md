# 迁移到页面内注入式 Sidebar (替换 Chrome Side Panel)

## 背景

当前实现使用 Chrome 原生 Side Panel API:浏览器在窗口右侧渲染一个独立的扩展面板,样式上和宿主页面割裂(左右位置不可控、外壳由浏览器渲染、跨标签共享一个面板实例)。Side Panel 也无法在用户打开 LLM 站点时自动接管原生左侧栏 — 必须用户主动点击扩展图标。

迁移方案: content script 在每个 LLM 站点页面里注入一个 Shadow DOM 沙箱,在沙箱内渲染我们的 sidebar UI;同时隐藏 LLM 站点原生左侧栏,推开 body 给我们让位置。视觉上和 LLM 网站融为一体,行为上可以做"识别到 LLM 站点 → 自动替换原生左侧栏"。

## 目标

1. 在 7 个 LLM 站点(ChatGPT/Gemini/Claude/DeepSeek/Grok/Kimi/Perplexity)上自动隐藏原生左侧栏,注入我们的 sidebar,视觉一致。
2. 完全砍掉 Chrome Side Panel 入口和后台 service worker — 简化扩展架构。
3. 复用现有 14 个 commit 的成果:`storage-model.js`、`providers/*.js`、`sidepanel.html`/`css`/`js` 的渲染逻辑。
4. 加入折叠/展开 UX,折叠状态按 origin 持久化。
5. 不引入新的可测试逻辑回归。

## 非目标

- 跨 tab 视觉状态同步(目录折叠、滚动位置)。`chrome.storage.onChanged` 保证数据同步,视觉状态每个 tab 独立。
- 用户可拖拽改宽。第一版固定比例。
- 在非 LLM 站点显示任何 UI。
- 跨设备同步设置(只用 `chrome.storage.local`,不上 `sync`)。

## 设计决策摘要

| 决策点 | 选择 | 原因 |
| --- | --- | --- |
| 是否保留 Chrome Side Panel | 完全砍掉 | 共存会让 mount 逻辑两份维护,且 LLM 用户大部分时间都在 LLM 站点上 |
| 样式隔离 | Shadow DOM(open mode) | 强隔离,宿主页面 CSS 不会污染我们的样式 |
| HTML 模板承载 | `fetch(chrome.runtime.getURL("sidepanel.html"))` → 解析后塞进 shadow root | 维持 HTML/CSS/JS 三件套布局,无需把 HTML 写到 JS 字符串里 |
| 宽度策略 | `min(360px, 22vw)`,`min-width: 260px` | 比例适配大屏 / 窄屏,固定下限避免缩到不可用 |
| 折叠触发 | 顶部 `«` icon(齿轮左边) | 与现有顶部 actions 区融合,不另起一行 |
| 折叠态保留入口 | 左边缘悬浮 `40px × 40px` handle (`»` icon),垂直居中 | 始终可见、随时唤出;不与原生页面元素重叠 |
| 折叠状态持久化 | `localStorage`,key `llmnav:sidebarCollapsed`,按 origin 隔离 | 同站点跨 tab 一致;不同 LLM 站点独立;不需要跨设备同步 |
| push-margin 联动 | 展开 `margin-left: min(360px, 22vw)`;折叠 `margin-left: 40px` | 给浮动 handle 让位置;避免遮挡页面 |
| background.js 命运 | 整个删除 | content script 可以直接读写 `chrome.storage`,不需要中转 |
| 跨 tab 协调 | 仅靠 `storage.onChanged` 自动数据同步,不做额外协调 | 视觉状态独立符合直觉 |
| SPA 路由后被宿主页面破坏 | MutationObserver 兜底重新注入 + body margin 监控 | LLM 站点频繁 pushState,自重注入是必须的 |
| 同时多 tab | 每个 tab 自己的 content script 实例,自己的 Shadow DOM,storage 数据共享 | 实现最简,行为符合直觉 |

## 架构

每个 LLM 站点的 content script bundle 做四件事(目前 1+2 已有):

```
┌──────────── content script (per LLM tab) ────────────┐
│                                                       │
│  1. 抓取可见历史 → chrome.storage.local                 │
│     (现有 content-scraper.js 已经做这件事,            │
│      但通过 chrome.runtime.sendMessage 转到 background;│
│      迁移后直接调 chrome.storage.local.set)            │
│                                                       │
│  2. 隐藏原生左侧栏(注入 <style>)                       │
│     (现有逻辑,用 providers/*.js 的                    │
│      scraping.hideSidebarSelector)                    │
│                                                       │
│  3. 注入 Sidebar (新)                                  │
│     - 创建 host element <div id="llmnav-host">         │
│     - attachShadow({ mode: "open" })                  │
│     - fetch sidepanel.html + sidepanel.css           │
│     - 解析进 shadow root                              │
│     - 调 mountSidebar(shadowRoot)                     │
│                                                       │
│  4. 维护页面 push-margin + 折叠 UX (新)                │
│     - <style> 注入 body margin 规则                    │
│     - 顶部「«」按钮 / 浮动 handle「»」                  │
│     - localStorage 持久化折叠状态                      │
│                                                       │
│  5. MutationObserver 兜底                              │
│     - 监听 body 子树,若我们的 host 节点被移除则重注入   │
│     - 若 body margin 被宿主页面重写则重新加 style       │
└──────────────────────────────────────────────────────┘
```

存储层(`chrome.storage.local`)在多个 tab 之间共享,`storage.onChanged` 自动触发各 tab sidebar 的重新渲染 — 这套机制已经在 sidepanel.js 里就绪,不用改。

## 折叠 UX 细节

### 展开态

- Sidebar 宽度 `min(360px, 22vw)`,`min-width: 260px`
- 顶部 actions 区从左到右: `[«]  [⚙]  [新建对话 ChatGPT ▾]`
- `«` 是一个 `icon-button`,与齿轮同尺寸(32×32),点击折叠

### 折叠态

- Sidebar 整体 `transform: translateX(-100%)` 滑出屏幕(保留 DOM,只藏视觉)
- `body { margin-left: 40px }`,给浮动 handle 让位
- 左边缘出现浮动 handle: `position: fixed; left: 0; top: 50%; transform: translateY(-50%); width: 40px; height: 40px;`,内含 `»` icon
- 点击 handle 重新展开;handle 收回,sidebar 滑入

### 动画

- `transition: transform 200ms ease-out` 应用于 sidebar 主体和 handle 的显隐
- `transition: margin-left 200ms ease-out` 应用于 body

### 持久化

- key: `localStorage.getItem("llmnav:sidebarCollapsed")`(字符串 `"1"` / `"0"`)
- 注入时读取,默认值 `"0"`(展开)
- 状态切换时立即写回

### 跨 tab 同步

- 不主动同步;`storage` 事件不监听 — 同 origin 不同 tab 各自独立
- 用户切换状态影响仅限当前 tab 的视觉;reload 后保留 localStorage 的最近一次状态

## 文件影响

### Create

- `injected-sidebar.js` — content script。负责 Shadow DOM 注入、fetch 模板、调 `mountSidebar`、折叠 UX、MutationObserver 兜底。
- `tests/injected-sidebar.test.js` — Node 测试,验证可拆出的纯逻辑(折叠状态计算、host element 构造、margin 规则生成)。需要 DOM 的部分用 vm/jsdom 桩,沿用现有 `tests/sidepanel-static.test.js` 风格。

### Modify

- `sidepanel.js` — 重构入口:
  - 删除顶层 `document.addEventListener("DOMContentLoaded", init)`
  - 把 `byId(id)` 改为接受一个 root 参数:`byId(root, id) => root.getElementById(id)`,或在 mount 时建立闭包绑定一个 `byId`
  - 把所有 `document.createElement`、`document.addEventListener("keydown", ...)`、`document.getElementById` 用法过一遍,确认能在 shadow root + 宿主 document 混合环境下工作:
    - `document.createElement` 可以照旧(创建未附加节点),被 append 到 shadow 之后自动属于 shadow scope
    - `document.addEventListener("keydown", onSettingsKeyDown)` 用于 Esc 关闭设置浮层 — 需要继续监听 document(Esc 不冒泡到 shadow),保持
    - `document.getElementById` 全部替换为闭包 `byId`,转向 shadow root
  - 导出 `mountSidebar(shadowRoot)` 作为单一入口;不依赖 `window.LLMNavProviders` 之外的全局
  - `openUrl(url)` 改为 `window.location.href = url`(不再用 `chrome.tabs.update`,因为我们就在那个 tab 里)
  - 删除 `sendMessage({ type: "llmnav:getPageState" })` 调用 — 当前 tab 的 provider 在 content script 启动时已知,直接传入 mount 选项
  - 通知逻辑(`renderNoticeForPageState`)简化:in-page 模式下永远 `supported: true`(我们只在 LLM 站点注入),`hasAccount` / `hasHistory` 仍由 scraper 推断后通过 mount 选项或 storage 共享

- `sidepanel.html` — 保留,但作为 template 文件被 fetch:
  - 删除 `<script>` 标签(provider configs + storage-model + sidepanel.js 都由 content script 在外部加载)
  - 删除 `<!doctype html>`、`<html>`、`<head>`、`<body>` 外层(只保留 `<main class="panel">` 起的实际内容 + `<div id="settings-modal">`)
  - 或者:保留完整 HTML 文档,content script fetch 后只把 `<main>` 和 `<div id="settings-modal">` 摘出来塞 shadow root

  **决定**:保留完整文档结构,content script 用 `DOMParser` 解析后取 `body.children` 注入 shadow root。这样开发时还能直接打开 sidepanel.html 预览结构。

- `sidepanel.css` — 几乎不变:
  - 把 `:root { ... font-family ... }` 改为 `:host { ... font-family ... }`(shadow root 的样式 scope)
  - body 相关规则保留,但会被 shadow 内的 `<main>` 视为根行为
  - 新增折叠 / handle / 动画相关样式

- `manifest.json`:
  - 删除 `side_panel` 对象
  - 删除 `permissions` 里的 `sidePanel`
  - 删除 `background` 字段
  - 给每个 provider 的 `content_scripts` 条目加上 `injected-sidebar.js`、`storage-model.js`、`sidepanel.js`、对应 provider config(顺序: provider config → storage-model → sidepanel(导出 mount) → injected-sidebar(调用 mount));`web_accessible_resources` 新增 `sidepanel.html` 和 `sidepanel.css`,允许 fetch
  - `action` 字段保留与否取决于是否还需要扩展工具栏图标 — 决定:**保留**作为"扩展存在感",但点击不做任何事(默认浏览器行为是无视)

- `providers/*.js` — 几乎不变。`scraping.hideSidebarSelector` 字段沿用。

- `content-scraper.js` — 改造或保留:
  - 当前做"抓取 + 发消息给 background"。迁移后改成"抓取 + 直接 `chrome.storage.local.set`"
  - 或者把抓取逻辑直接合并进 `injected-sidebar.js`,删除 `content-scraper.js`
  - **决定**:**合并到 `injected-sidebar.js`**,删 `content-scraper.js`,减少 content script 文件数

- `tests/sidepanel-static.test.js` — 调整:
  - `byId` 改用 shadow root → 测试桩跟着改
  - 删除依赖 `chrome.runtime.sendMessage` / page-state 消息的 mock
  - 保留所有现有"渲染顺序、字段映射、目录操作"语义断言

### Delete

- `background.js`
- `tests/manifest.test.js` 里关于 `side_panel`、`background.service_worker`、`sidePanel` 权限的断言 — 改成断言这些字段不存在
- `sidepanel.html` 中 `<script>` 标签(被 manifest 加载替代)
- `content-scraper.js`(合并到 `injected-sidebar.js`)
- `tests/content-scraper.test.js` 中对应测试 — 改为 `injected-sidebar` 测试覆盖

## 行为规范

### Provider 身份识别

In-page 模式下,content script 启动时通过 `window.LLMNavProvider`(已有约定)直接知道自己运行在哪个 provider —— 每个 provider config 加载时把 `config` 也挂到 `window.LLMNavProvider`(见 [providers/chatgpt.js:27](providers/chatgpt.js#L27))。injected-sidebar 拿这个值作为 `currentProvider`,不再依赖 background 推断 / 消息广播。

### Content script 启动顺序(`document_idle` 时机)

```
1. 读 chrome.storage.local 拿到 settings、folders、activeAccounts
2. 注入隐藏原生侧栏的 <style>(用 provider config 的 hideSidebarSelector)
3. 注入 body push-margin <style>(根据 localStorage 折叠状态)
4. 创建 #llmnav-host 元素,attachShadow open
5. fetch sidepanel.html、sidepanel.css → 解析进 shadow root
6. 调 mountSidebar(shadowRoot, { provider, account, ... })
7. 设置 MutationObserver:
   - 若 #llmnav-host 被移除 → 重做 4-6
   - 若 body 的 style.marginLeft 被宿主页面清空 → 重注入 step 3 的 style
8. 开始抓取可见历史并 chrome.storage.local.set
```

### 折叠/展开

- 默认 = `localStorage.getItem("llmnav:sidebarCollapsed") === "1"` 时折叠
- 折叠操作:`document.body.classList.add("llmnav-collapsed")` + 设置 localStorage
- 展开同理 inverse
- CSS 用 `.llmnav-collapsed` 选择器在 host 元素和 shadow root 内分别控制状态

### 抓取持久化

- 当前 `content-scraper.js` 通过 `chrome.runtime.sendMessage({ type: "llmnav:visibleHistory", ... })` 转交给 background。迁移后:
  - 抓取后直接调 `LLMNavModel.upsertVisibleConversations(currentState, provider, account, records)` → `chrome.storage.local.set({ folders, activeAccounts })`
  - 由 `chrome.storage.onChanged` 触发 sidebar 自身的 `render`(已有逻辑)
- 节流:沿用现有 500ms debounce

### Esc / Click outside 行为

- Esc 关设置浮层:`document.addEventListener("keydown", onSettingsKeyDown)` 监听宿主 document(shadow 不阻止 Esc 冒泡到 document)。保持现有逻辑
- Click outside 关 provider dropdown:已有 `document.addEventListener("click", hideOnOutsideClick, { once: true })` — shadow 内的 click 会冒泡到 document,同样工作

## 测试要点

### `tests/storage-model.test.js`(已有)
- 全部保留,不动

### `tests/injected-sidebar.test.js`(新)
- `collapsed state initialises from localStorage`
- `toggle collapse writes localStorage and updates body class`
- `host element is recreated when MutationObserver detects removal`(用 vm/jsdom 模拟)
- `body margin style is re-injected when host page clears it`
- `mountSidebar is called once per host attach`

### `tests/sidepanel-static.test.js`(调整)
- `loadProviderRegistry` 沿用
- 用 shadow-root-style 的桩替代当前 stub `getElementById`
- 现有断言全部保留(主按钮文字、quickActions 渲染、对话/目录渲染、badge 颜色)
- 删除依赖 page-state 消息的测试细节

### `tests/manifest.test.js`(调整)
- 断言 `manifest.side_panel === undefined`
- 断言 `manifest.background === undefined`
- 断言 `manifest.permissions.includes("sidePanel") === false`
- 断言每个 LLM provider origin 的 content_scripts 条目包含 `injected-sidebar.js`、`storage-model.js`、`sidepanel.js`、对应 provider config
- 断言 `web_accessible_resources` 包含 `sidepanel.html` 和 `sidepanel.css`

### 手动验证清单
- 7 个 LLM 站点各打开一次,确认:
  - 原生左侧栏被隐藏
  - 我们的 sidebar 在左侧出现,宽度合理
  - `«` 折叠 → handle 出现 → `»` 展开,过渡顺滑
  - 折叠状态在 reload 后保留
  - SPA 路由切换(ChatGPT 切对话)后 sidebar 不消失
  - 设置浮层 / 目录重命名 / 删除 等所有 Task 1-10 已有行为仍然工作
- 同时打开两个 ChatGPT tab:
  - 在 A tab 改设置,B tab 顶部按钮文字自动更新
  - 在 A tab 折叠 sidebar,B tab 不受影响
  - 在 A tab 新建目录,B tab 目录列表更新

## 风险与边缘案例

- **LLM 站点 CSP 阻止 Shadow DOM / inline style**: Shadow DOM 是 DOM API 不受 CSP 影响;`<style>` 注入可能被 strict CSP 拦。**决定**:CSS 加载用 CSSOM,`fetch(chrome.runtime.getURL("sidepanel.css")).then(r => r.text())` 拿到 cssText,然后 `const sheet = new CSSStyleSheet(); await sheet.replace(cssText); shadowRoot.adoptedStyleSheets = [sheet]`。同样的方式注入 body push-margin 规则(挂到宿主 document 的 `document.adoptedStyleSheets`)。绕过 CSP。
- **LLM 站点改版 selector 失效**: `providers/*.js` 中的 `hideSidebarSelector` 已经是按 provider 配置的,只需要维护这一处。
- **首次加载时序竞争**: content script 在 `document_idle` 注入,LLM 站点可能还在动态构建左栏。MutationObserver 兜底处理:发现新的原生侧栏元素时重新隐藏。
- **多个 host 实例并发**: 内置幂等检查 — `if (document.getElementById("llmnav-host")) return;` 保证只挂一份。
- **页面 zoom**: `vw` 单位会跟随浏览器 zoom 适应,无需特殊处理。
- **iframe 内的 LLM 站点**: content_scripts 默认不注入到 iframe,manifest 不加 `all_frames: true`,符合预期。
- **数据迁移**: 已存储的 `folders` / `settings` 形态不变,无需迁移。

## 落地策略

实施顺序(每步独立 commit,中间状态可工作):

1. **过渡期共存**(实施期间用,非最终设计):先加 `injected-sidebar.js` + 让 `manifest.json` 同时声明 side panel 和新 content script,让 in-page sidebar 在 ChatGPT 跑通后再做拆除工作 — 避免一次性大改后 side panel 也用不了。
2. **验证 ChatGPT 通路完整可用**(注入、隐藏原生侧栏、抓取、设置浮层、目录操作都正常)
3. **拆除 side panel 装配**:删 `background.js`、`side_panel` manifest 字段、`sidePanel` 权限、`tests/manifest.test.js` 的相关断言
4. **扩展到剩余 6 个 LLM 站点**:逐个加 manifest 条目并验证
5. **删除 `content-scraper.js`**(逻辑已并入 `injected-sidebar.js`),更新对应测试

具体到每个 Task 1-N 的步骤会在 writing-plans 阶段生成。
