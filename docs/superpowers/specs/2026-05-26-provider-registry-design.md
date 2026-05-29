# Provider 注册表化重构 设计

日期:2026-05-26

## 背景与目标

接入 Gemini 后,每加一个 provider 仍需要触碰 6-7 个文件,其中 `content-<provider>.js` 是 ~160 行的近全量复制。本次重构的目标是:把 provider 元数据集中到单一注册表,并把 content script 抽出共享框架,使新增一个 provider 退化为「写一份 ~30 行的配置 + 同步几行枚举」。

约束:沿用项目「不引入构建工具、不引入框架」的纪律(见第一版设计),MV3 内容脚本只能通过 manifest 注入、不能 ES module import。

## 范围

### 本次包含

- 新增 `providers/` 目录,每个 provider 一份完整配置文件(含 origins / matches / new-chat URL / label / badge / scraping config)。
- 新增 `content-scraper.js` 共享内容脚本框架,从 `LLMNavProvider` 全局读 config 后运行。
- 删除 `content-chatgpt.js`、`content-gemini.js`(被 `providers/<name>.js + content-scraper.js` 组合替代)。
- `background.js` 改为 `importScripts` 各 provider 配置文件,从 `LLMNavProviders` 注册表读取 origins/路由。
- `sidepanel.js` 移除 `PROVIDER_NEW_CHAT_URLS` / `PROVIDER_BADGES` / `PROVIDER_LABELS` 三个 map,改为查询注册表;顶部按钮由注册表动态注入。
- `sidepanel.html` 顶部按钮变为容器(只保留 `#show-folder-form` 与表单),`<script>` 列每个 provider 配置文件。
- `sidepanel.css` 删除 `.badge-chatgpt` / `.badge-gemini`;徽标颜色改为 JS 内联设置。
- 测试结构调整:统一为 scraper 单元测试 + 注册表一致性测试 + manifest 同步测试。

### 本次不包含

- 不动 `storage-model.js`(已 provider-aware)。
- 不动 UX:界面渲染、徽标颜色、按钮文案、notice 文案、键盘行为完全保持。
- 不接入新的 provider(Claude/Grok/…)——本次只整理结构,新 provider 在后续单独 PR 加入。
- 不引入 build step / bundler / TypeScript。
- 不修改 sidepanel 跨 provider 渲染逻辑(filterFoldersAcrossProviders 保持不动)。

## 用户体验

零变化。所有改动是结构性的,运行时行为与当前 Gemini 落地后的 master 一致。

验证点:重构合并后,在 ChatGPT 和 Gemini 上的同步、徽标颜色、按钮、notice 文案完全等同今天。

## 技术设计

### 注册表与 provider 配置

`providers/<name>.js` 同时承担两种角色:

1. **作为 content script 的第一个被注入文件**:运行后设置 `self.LLMNavProvider = config`,之后 `content-scraper.js` 读取并启动抓取流程。
2. **作为 background / sidepanel 上下文的注册表项**:同步把自己写进 `self.LLMNavProviders[name] = config`。

```javascript
// providers/chatgpt.js
(function (root) {
  const config = {
    name: "chatgpt",
    origins: ["https://chatgpt.com", "https://chat.openai.com"],
    matches: ["https://chatgpt.com/*", "https://chat.openai.com/*"],
    newChatUrl: "https://chatgpt.com/",
    label: "ChatGPT",
    badge: { letter: "C", color: "#10a37f" },
    scraping: {
      accountSelectors: [
        '[data-testid="accounts-profile-button"]',
        '[data-testid="profile-button"]',
        'button[aria-label*="account" i]',
        'button[aria-label*="profile" i]',
        '[aria-label*="@"]'
      ],
      accountDisplaySubSelector: ".truncate",
      historyRootSelector: "#history",
      historyLinkSelector: 'a[href^="/c/"], a[href^="https://chatgpt.com/c/"], a[href^="https://chat.openai.com/c/"]',
      historyPathPrefix: "/c/",
      titleSubSelector: null,
      hideSidebarSelector: '#stage-slideover-sidebar, nav[aria-label="Chat history"], nav[aria-label="聊天记录"], aside:has(a[href^="/c/"])',
      hideStyleId: "llmnav-hide-chatgpt-sidebar"
    }
  };

  root.LLMNavProvider = config;
  root.LLMNavProviders = root.LLMNavProviders || {};
  root.LLMNavProviders[config.name] = config;
})(typeof globalThis !== "undefined" ? globalThis : self);
```

`providers/gemini.js` 同结构,差异字段:

- `origins: ["https://gemini.google.com"]`
- `matches: ["https://gemini.google.com/*"]`
- `newChatUrl: "https://gemini.google.com/app"`
- `label: "Gemini"`
- `badge: { letter: "G", color: "#4285f4" }`
- `scraping.accountSelectors: ['a[gem-open-account-menu]', 'a[aria-label*="Google 账号"]', 'a[aria-label*="Google Account"]']`
- `scraping.accountDisplaySubSelector: ".mavatar-user-name"`
- `scraping.historyRootSelector: 'conversations-list[data-test-id="all-conversations"]'`
- `scraping.historyLinkSelector: 'a[href^="/app/"], a[href^="https://gemini.google.com/app/"]'`
- `scraping.historyPathPrefix: "/app/"`
- `scraping.titleSubSelector: ".title-text"`(优先 aria-label,再这个,再 textContent)
- `scraping.hideSidebarSelector: "bard-sidenav"`
- `scraping.hideStyleId: "llmnav-hide-gemini-sidebar"`

### content-scraper.js

把现有两个内容脚本的共同骨架抽出来,差异化点全部参数化到 `config.scraping`:

```javascript
(function () {
  if (typeof self === "undefined" || !self.LLMNavProvider) {
    return;
  }
  const config = self.LLMNavProvider;
  const { scraping, name } = config;
  let syncTimer = 0;

  function extractEmail(text) { /* 不变 */ }
  function normalizeAccountName(text) { /* 不变,正则匹配多语言"Google 账号"前缀和邮箱括号尾 */ }

  function scrapeAccount() {
    // 遍历 scraping.accountSelectors,每个元素:
    //   1. 提取 email
    //   2. 若 accountDisplaySubSelector,取其文本规范化
    //   3. 取 aria-label 经 normalizeAccountName
  }

  function scrapeVisibleHistory() {
    const historyRoot = document.querySelector(scraping.historyRootSelector);
    const sourceRoot = historyRoot || document;
    // 遍历 sourceRoot.querySelectorAll(scraping.historyLinkSelector)
    // 用 pickTitle 取标题
    // 用 normalizeHistoryUrl 校验路径前缀
  }

  function pickTitle(link) {
    const aria = link.getAttribute("aria-label");
    if (aria && aria.trim()) return normalizeTitle(aria);
    if (scraping.titleSubSelector) {
      const node = link.querySelector(scraping.titleSubSelector);
      if (node) return normalizeTitle(node.textContent);
    }
    return normalizeTitle(link.textContent);
  }

  function normalizeHistoryUrl(href) {
    const url = new URL(href, location.origin);
    if (!url.pathname.startsWith(scraping.historyPathPrefix)) return "";
    url.hash = "";
    url.search = "";
    return url.toString();
  }

  function hideNativeSidebar() {
    if (document.getElementById(scraping.hideStyleId)) return;
    const style = document.createElement("style");
    style.id = scraping.hideStyleId;
    style.textContent = `${scraping.hideSidebarSelector} { display: none !important; }`;
    document.documentElement.appendChild(style);
  }

  function sendVisibleHistory() {
    const account = scrapeAccount();
    const records = scrapeVisibleHistory();
    hideNativeSidebar();
    try {
      chrome.runtime.sendMessage(
        { type: "llmnav:visibleHistory", provider: name, account, records },
        () => { void chrome.runtime.lastError; }
      );
    } catch (error) { void error; }
  }

  function scheduleSync() { clearTimeout(syncTimer); syncTimer = setTimeout(sendVisibleHistory, 500); }
  function start() {
    sendVisibleHistory();
    const observer = new MutationObserver(scheduleSync);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener("focus", scheduleSync);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) scheduleSync(); });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
```

注意几个关键决策:

- **统一清 `url.search`**:历史 ChatGPT 版没清,Gemini 版清了。统一为清——避免同一对话因带 `?model=...` 而被记为两条。这是与现有 ChatGPT 行为的最小、有益偏移(评审遗留 follow-up,本重构顺手解决)。
- **统一 `pickTitle` 顺序**:aria-label → titleSubSelector → textContent。ChatGPT 走 textContent(原行为),Gemini 走 aria-label(原行为)。
- **`isVisible` 已退化**:Gemini 已经在 historyRoot 路径下绕过它。这里也对齐:仅当 `historyRoot` 为空时退化到 `document`,此时仍按可见性过滤。

### background.js

```javascript
importScripts("storage-model.js");
importScripts("providers/chatgpt.js", "providers/gemini.js");

const providerState = {};

function listProviders() {
  return self.LLMNavProviders || {};
}

function resolveProvider(url) {
  try {
    const origin = new URL(url).origin;
    for (const [name, config] of Object.entries(listProviders())) {
      if (config.origins.includes(origin)) return name;
    }
  } catch (error) { void error; }
  return "";
}

// 现有 onMessage 路由不变,只把 `Object.hasOwn(PROVIDER_CONFIGS, ...)` 替换为
// `Object.hasOwn(listProviders(), message.provider)`
```

`PROVIDER_CONFIGS` 常量从 background.js 中删除——注册表是单一来源。

### sidepanel

`sidepanel.html`:

```html
<section class="actions" id="actions" aria-label="快捷操作">
  <button id="show-folder-form" type="button">新建目录</button>
  <form id="folder-form" class="folder-form hidden" autocomplete="off">
    <input id="folder-name" name="folderName" type="text" maxlength="40" placeholder="目录名称" aria-label="目录名称">
    <button type="submit">创建</button>
  </form>
</section>

<!-- script 区按现状 -->
<script src="providers/chatgpt.js"></script>
<script src="providers/gemini.js"></script>
<script src="storage-model.js"></script>
<script src="sidepanel.js"></script>
```

`sidepanel.js` 顶部移除三个 map,新增:

```javascript
function listProviders() {
  return window.LLMNavProviders || {};
}

function getProvider(name) {
  return listProviders()[name] || null;
}

function renderNewChatButtons() {
  const actions = byId("actions");
  const anchor = byId("show-folder-form");
  Object.values(listProviders()).forEach((provider) => {
    const button = document.createElement("button");
    button.type = "button";
    button.id = `new-${provider.name}`;
    button.textContent = `新建 ${provider.label} 对话`;
    button.addEventListener("click", () => openUrl(provider.newChatUrl));
    actions.insertBefore(button, anchor);
  });
}
```

`init` 在绑定 `#show-folder-form` 之前调用 `renderNewChatButtons()`。

`renderConversation` 改为:

```javascript
const provider = getProvider(record.provider);
const badge = document.createElement("span");
badge.className = "conversation-badge";
if (provider) {
  badge.textContent = provider.badge.letter;
  badge.style.backgroundColor = provider.badge.color;
} else {
  badge.textContent = "?";
}
```

`renderNoticeForPageState` 改为从注册表查 label:

```javascript
const provider = getProvider(pageState.provider);
const providerLabel = provider ? provider.label : pageState.provider;
```

不支持页面的 fallback 文案改为按注册表生成:`"当前页面不是支持的 LLM 页面。打开 " + labels.join("、") + " 后可同步可见历史。"`。

### sidepanel.css

删除:

```css
.badge-chatgpt { background: #10a37f; }
.badge-gemini  { background: #4285f4; }
```

保留 `.conversation-badge` 形状规则(背景色由 JS 内联)。

### manifest.json

```json
{
  "host_permissions": [
    "https://chatgpt.com/*",
    "https://chat.openai.com/*",
    "https://gemini.google.com/*"
  ],
  "content_scripts": [
    { "matches": ["https://chatgpt.com/*", "https://chat.openai.com/*"], "js": ["providers/chatgpt.js", "content-scraper.js"], "run_at": "document_idle" },
    { "matches": ["https://gemini.google.com/*"], "js": ["providers/gemini.js", "content-scraper.js"], "run_at": "document_idle" }
  ]
}
```

### 新增 provider 的步骤(以 Claude 为例,本次不实施)

1. 新建 `providers/claude.js`(~30 行,填字段)
2. `manifest.json` 加 `https://claude.ai/*` 到 `host_permissions` + 加一条 `content_scripts` 条目
3. `background.js` 加一行 `importScripts("providers/claude.js")`
4. `sidepanel.html` 加一行 `<script src="providers/claude.js"></script>`

共 4 处机械改动,无重复代码;UI 按钮、徽标颜色、notice 文案自动跟随注册表。

## 错误处理与边界

- content-scraper 加载顺序:manifest 保证 `providers/<name>.js` 在 `content-scraper.js` 之前注入(MV3 文档约定按数组顺序)。万一某个 provider 文件未注入,scraper 检测 `!self.LLMNavProvider` 直接 return。
- sidepanel 渲染按钮时若注册表为空(不应发生),`renderNewChatButtons` 不报错,只是没有 new-chat 按钮——用户仍可用「新建目录」。
- background `resolveProvider` 与注册表为空时正常返回 `""`(回退到 `{supported: false}`)。
- `LLMNavProvider` 与 `LLMNavProviders` 全局名空间冲突风险:都加 `LLMNav` 前缀,在第三方页面里冲突概率极低。

## 测试策略

文件级调整:

- **删除**:`tests/content-gemini.test.js`(内容并入下面 scraper 测试)。
- **新增** `tests/content-scraper.test.js`:VM 注入一个虚拟 `LLMNavProvider` config + scraper 源码,断言 scrapeAccount/scrapeVisibleHistory/hideNativeSidebar 按 config 行为;断言上下文失效 try/catch 仍 work。覆盖 ChatGPT 与 Gemini 两种 config 形态各一组用例。
- **新增** `tests/providers.test.js`:遍历 `providers/` 下每个文件,加载后断言注册表条目含完整字段(name/origins/matches/newChatUrl/label/badge/scraping 全部子键)、origins 与 matches 一致(host 部分匹配)。
- **更新** `tests/manifest.test.js`:断言 `host_permissions` 与 `LLMNavProviders[*].origins` 同步;断言每个 provider 在 `content_scripts` 里恰好一条;断言每条 content_scripts 的 `js` 数组以 `providers/<name>.js` 开头、以 `content-scraper.js` 结尾。
- **更新** `tests/sidepanel-static.test.js`:
  - 「mixed-provider records」用例的 VM 上下文加注入虚拟 `LLMNavProviders` 与 `LLMNavProvider`;断言徽标的 `style.backgroundColor` 设置正确。
  - 「per-provider new chat buttons」用例改为断言 sidepanel.html 不再硬编码按钮(只看 `#actions`、`#show-folder-form`);保留新一条对 sidepanel.js 的断言:含 `renderNewChatButtons`、含 `provider.newChatUrl`、含 `provider.badge.color`。
- **更新** `tests/storage-model.test.js`:无变化(不动模型)。

## 风险与决策

| 风险 | 处理 |
|---|---|
| 共享 scraper 引入回归(同时影响 ChatGPT 与 Gemini) | scraper 测试用两种 config 各跑一遍;计划里包含手工 Chrome 验证步骤 |
| 第三方页面的 `LLMNav*` 全局污染 | 命名加 `LLMNav` 前缀;全局是常见 MV3 模式 |
| manifest 与注册表脱钩(漏注册) | manifest 同步测试在 CI 跑(本项目只有本地 `node --test`,但同步测试在那里执行) |
| sidepanel 按钮动态生成,a11y 或键盘顺序变化 | 通过 `insertBefore` 到 `#show-folder-form` 锚点;DOM 顺序与今天硬编码 HTML 等价 |
| `url.search = ""` 对 ChatGPT 历史的影响 | 评审遗留 follow-up;若某些链接依赖 query 参数(目前未观察到),退路是把该字段做成 provider config 的开关 |

## 验收

- 全量测试通过,数量从当前 45 调整为重构后的预期数(scraper 测试合并、注册表测试新增、sidepanel 测试调整,数量级相近)。
- 手工:`chrome://extensions` 重新加载扩展,在 ChatGPT 与 Gemini 上分别打开 Side Panel,确认徽标、按钮、对话同步、notice 文案与重构前一致。
- 代码组织:`providers/<name>.js` 各文件长度 ≤ 50 行(纯配置);`content-scraper.js` ≤ 180 行;`sidepanel.js` 长度不显著增长。
