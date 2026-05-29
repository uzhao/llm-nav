# Provider 注册表化重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 provider 元数据集中到 `providers/<name>.js` 注册表,抽出 `content-scraper.js` 共享框架,使新增 provider 退化为「写一份 ~30 行配置 + 几行机械同步」,运行时行为保持与重构前一致。

**Architecture:**
- 每个 provider 一份 `providers/<name>.js` 同时承担两种角色:作为 content script 第一个被注入的脚本时设置 `self.LLMNavProvider`,作为 background/sidepanel `<script>` 时把自己写进 `self.LLMNavProviders[name]` 注册表。
- 共享 `content-scraper.js` 读 `self.LLMNavProvider` 后跑统一的抓取生命周期(scrapeAccount → scrapeVisibleHistory → hideNativeSidebar → sendMessage,MutationObserver / focus / visibilitychange 触发节流重抓)。
- `background.js` 用 `importScripts` 加载 providers,从 `self.LLMNavProviders` 查路由;`sidepanel.html` 用 `<script>` 标签加载 providers,`sidepanel.js` 用注册表渲染按钮、徽标、文案。

**Tech Stack:** 原生 JavaScript(无构建工具)、Chrome Extension MV3、`node --test` + `node:assert/strict` + `vm.runInNewContext`。

**约束:** 不引入构建工具 / 框架 / TypeScript。沿用项目「全局命名空间 + IIFE」模式。中文注释,英文 logging。

---

## 文件结构

**新增**
- `providers/chatgpt.js` — ChatGPT 完整配置(origins / matches / newChatUrl / label / badge / scraping)
- `providers/gemini.js` — Gemini 完整配置
- `content-scraper.js` — 共享抓取框架,读 `self.LLMNavProvider` 启动
- `tests/providers.test.js` — 注册表一致性
- `tests/content-scraper.test.js` — 用虚拟 config 跑 scraper

**修改**
- `background.js` — 用 `importScripts("providers/...")` + `self.LLMNavProviders`
- `sidepanel.html` — 去掉硬编码 new-chat 按钮,加 provider `<script>`
- `sidepanel.js` — 删除 `PROVIDER_NEW_CHAT_URLS` / `PROVIDER_BADGES` / `PROVIDER_LABELS`,改用注册表
- `sidepanel.css` — 删除 `.badge-chatgpt` / `.badge-gemini`
- `manifest.json` — 每条 `content_scripts` 变为 `["providers/<name>.js", "content-scraper.js"]`
- `tests/manifest.test.js` — 改为注册表 / 文件结构同步断言
- `tests/sidepanel-static.test.js` — 注入虚拟 `LLMNavProviders`,断言 inline 背景色 / 动态按钮

**删除**
- `content-chatgpt.js`
- `content-gemini.js`
- `tests/content-gemini.test.js`

---

## 任务排序与中间状态

每个任务结束时,**全量测试必须通过** (`node --test tests/*.test.js`)。中间状态(Task 1–4 完成、Task 5 未完成)下,manifest 仍然指向 `content-chatgpt.js` / `content-gemini.js`,扩展运行时与重构前完全一致。Task 5 一次性切换 manifest 并删除旧文件。

---

### Task 1: 新增 providers/chatgpt.js + providers/gemini.js + 注册表一致性测试

**Files:**
- Create: `providers/chatgpt.js`
- Create: `providers/gemini.js`
- Create: `tests/providers.test.js`

- [ ] **Step 1: 写注册表一致性测试**

写入 `tests/providers.test.js`:

```javascript
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadProvider(name) {
  const source = fs.readFileSync(path.join(__dirname, `../providers/${name}.js`), "utf8");
  const context = { self: {} };
  vm.runInNewContext(source, context);
  return context.self;
}

const REQUIRED_SCRAPING_KEYS = [
  "accountSelectors",
  "accountDisplaySubSelector",
  "historyRootSelector",
  "historyLinkSelector",
  "historyPathPrefix",
  "titleSubSelector",
  "hideSidebarSelector",
  "hideStyleId"
];

const REGISTERED_NAMES = ["chatgpt", "gemini"];

REGISTERED_NAMES.forEach((name) => {
  test(`providers/${name}.js 注册到 LLMNavProvider 与 LLMNavProviders`, () => {
    const ns = loadProvider(name);
    assert.ok(ns.LLMNavProvider, "LLMNavProvider 未设置");
    assert.equal(ns.LLMNavProvider.name, name);
    assert.ok(ns.LLMNavProviders, "LLMNavProviders 未设置");
    assert.strictEqual(ns.LLMNavProviders[name], ns.LLMNavProvider);
  });

  test(`providers/${name}.js 含完整字段`, () => {
    const config = loadProvider(name).LLMNavProvider;
    assert.ok(Array.isArray(config.origins) && config.origins.length > 0);
    assert.ok(Array.isArray(config.matches) && config.matches.length > 0);
    assert.equal(typeof config.newChatUrl, "string");
    assert.equal(typeof config.label, "string");
    assert.equal(typeof config.badge.letter, "string");
    assert.match(config.badge.color, /^#[0-9a-fA-F]{3,8}$/);

    REQUIRED_SCRAPING_KEYS.forEach((key) => {
      assert.ok(Object.hasOwn(config.scraping, key), `scraping.${key} 缺失`);
    });
  });

  test(`providers/${name}.js origins 与 matches host 部分一致`, () => {
    const config = loadProvider(name).LLMNavProvider;
    const originHosts = config.origins.map((origin) => new URL(origin).host);
    const matchHosts = config.matches.map((match) => match.replace(/^https?:\/\//, "").replace(/\/.*$/, ""));
    originHosts.forEach((host) => {
      assert.ok(matchHosts.includes(host), `origins 中的 ${host} 未出现在 matches`);
    });
  });
});

test("LLMNavProviders 在多次加载后能合并多个 provider", () => {
  const context = { self: {} };
  const chatgptSource = fs.readFileSync(path.join(__dirname, "../providers/chatgpt.js"), "utf8");
  const geminiSource = fs.readFileSync(path.join(__dirname, "../providers/gemini.js"), "utf8");
  vm.runInNewContext(chatgptSource, context);
  vm.runInNewContext(geminiSource, context);
  assert.deepEqual(Object.keys(context.self.LLMNavProviders).sort(), ["chatgpt", "gemini"]);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/providers.test.js`
Expected: FAIL — `providers/chatgpt.js` 与 `providers/gemini.js` 都不存在。

- [ ] **Step 3: 创建 providers/chatgpt.js**

```bash
mkdir -p providers
```

写入 `providers/chatgpt.js`:

```javascript
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

- [ ] **Step 4: 创建 providers/gemini.js**

写入 `providers/gemini.js`:

```javascript
(function (root) {
  const config = {
    name: "gemini",
    origins: ["https://gemini.google.com"],
    matches: ["https://gemini.google.com/*"],
    newChatUrl: "https://gemini.google.com/app",
    label: "Gemini",
    badge: { letter: "G", color: "#4285f4" },
    scraping: {
      accountSelectors: [
        'a[gem-open-account-menu]',
        'a[aria-label*="Google 账号"]',
        'a[aria-label*="Google Account"]'
      ],
      accountDisplaySubSelector: ".mavatar-user-name",
      historyRootSelector: 'conversations-list[data-test-id="all-conversations"]',
      historyLinkSelector: 'a[href^="/app/"], a[href^="https://gemini.google.com/app/"]',
      historyPathPrefix: "/app/",
      titleSubSelector: ".title-text",
      hideSidebarSelector: "bard-sidenav",
      hideStyleId: "llmnav-hide-gemini-sidebar"
    }
  };

  root.LLMNavProvider = config;
  root.LLMNavProviders = root.LLMNavProviders || {};
  root.LLMNavProviders[config.name] = config;
})(typeof globalThis !== "undefined" ? globalThis : self);
```

- [ ] **Step 5: 跑测试确认通过**

Run: `node --test tests/providers.test.js`
Expected: 全部 PASS(7 个 test:每个 provider 3 个 + 合并 1 个)。

Run: `node --test tests/*.test.js`
Expected: 全量测试通过(原有测试不受影响,因为 manifest / background / sidepanel 都未改)。

- [ ] **Step 6: 提交**

```bash
git add providers/ tests/providers.test.js
git commit -m "$(cat <<'EOF'
feat: introduce provider registry under providers/

每个 provider 一份 ~35 行配置文件,同时承担 content script
的 LLMNavProvider 与 background/sidepanel 的 LLMNavProviders[name]
两种角色。本次仅新增文件,运行时尚未引用。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 新增 content-scraper.js + scraper 测试

**Files:**
- Create: `content-scraper.js`
- Create: `tests/content-scraper.test.js`

- [ ] **Step 1: 写 scraper 测试**

写入 `tests/content-scraper.test.js`:

```javascript
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SCRAPER_SOURCE = fs.readFileSync(path.join(__dirname, "../content-scraper.js"), "utf8");

const CHATGPT_CONFIG = {
  name: "chatgpt",
  scraping: {
    accountSelectors: ['[data-testid="accounts-profile-button"]'],
    accountDisplaySubSelector: ".truncate",
    historyRootSelector: "#history",
    historyLinkSelector: 'a[href^="/c/"]',
    historyPathPrefix: "/c/",
    titleSubSelector: null,
    hideSidebarSelector: "#stage-slideover-sidebar",
    hideStyleId: "llmnav-hide-chatgpt-sidebar"
  }
};

const GEMINI_CONFIG = {
  name: "gemini",
  scraping: {
    accountSelectors: ['a[gem-open-account-menu]'],
    accountDisplaySubSelector: ".mavatar-user-name",
    historyRootSelector: 'conversations-list[data-test-id="all-conversations"]',
    historyLinkSelector: 'a[href^="/app/"]',
    historyPathPrefix: "/app/",
    titleSubSelector: ".title-text",
    hideSidebarSelector: "bard-sidenav",
    hideStyleId: "llmnav-hide-gemini-sidebar"
  }
};

function makeLink({ href, text = "", ariaLabel = null, title = null }) {
  return {
    getAttribute(name) {
      if (name === "href") return href;
      if (name === "aria-label") return ariaLabel;
      return null;
    },
    get textContent() { return text; },
    querySelector(selector) {
      if (title && selector === ".title-text") {
        return { textContent: title };
      }
      return null;
    },
    getClientRects() { return [{}]; }
  };
}

function makeAccountElement({ ariaLabel = "", text = "", display = null, displayClass = null }) {
  return {
    getAttribute(name) {
      if (name === "aria-label") return ariaLabel;
      return null;
    },
    get textContent() { return text; },
    querySelector(selector) {
      if (display && (
        (displayClass && selector === `.${displayClass}`) ||
        (!displayClass && (selector === ".truncate" || selector === ".mavatar-user-name"))
      )) {
        return { textContent: display };
      }
      return null;
    }
  };
}

function runScraperOnce({ config, accountElements = [], historyLinks = [], hasHistoryRoot = true, sendMessageImpl }) {
  const sentMessages = [];
  const appendedNodes = [];
  const listeners = {};
  const styleEl = { id: "", textContent: "", appendChild() {} };

  const context = {
    self: { LLMNavProvider: config },
    chrome: {
      runtime: {
        sendMessage: sendMessageImpl || ((message, cb) => {
          sentMessages.push(message);
          if (cb) cb();
        }),
        lastError: null
      }
    },
    clearTimeout() {},
    setTimeout(fn) { fn(); return 1; },
    URL,
    document: {
      readyState: "complete",
      hidden: false,
      documentElement: { appendChild(node) { appendedNodes.push(node); } },
      getElementById() { return null; },
      createElement() { return styleEl; },
      addEventListener(type, listener) { listeners[`document:${type}`] = listener; },
      querySelector(selector) {
        if (hasHistoryRoot && selector === config.scraping.historyRootSelector) {
          return {
            querySelectorAll: () => historyLinks
          };
        }
        return null;
      },
      querySelectorAll(selector) {
        if (config.scraping.accountSelectors.includes(selector)) return accountElements;
        if (selector === config.scraping.historyLinkSelector && !hasHistoryRoot) return historyLinks;
        return [];
      }
    },
    location: { origin: "https://example.test" },
    window: { addEventListener(type, listener) { listeners[`window:${type}`] = listener; } },
    MutationObserver: class { observe() {} }
  };

  vm.runInNewContext(SCRAPER_SOURCE, context);
  return { sentMessages, appendedNodes, styleEl, listeners };
}

test("scraper 在没有 LLMNavProvider 时 silently return", () => {
  const context = {
    self: {},
    chrome: { runtime: { sendMessage() { throw new Error("不应被调用"); } } },
    document: { readyState: "complete", addEventListener() {} },
    window: { addEventListener() {} }
  };
  assert.doesNotThrow(() => vm.runInNewContext(SCRAPER_SOURCE, context));
});

test("scraper 用 ChatGPT config 抓取 history 与 account email", () => {
  const accountEl = makeAccountElement({ ariaLabel: "alice@example.com", text: "" });
  const link = makeLink({ href: "/c/abc123", text: "测试对话" });
  const { sentMessages } = runScraperOnce({
    config: CHATGPT_CONFIG,
    accountElements: [accountEl],
    historyLinks: [link]
  });
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].provider, "chatgpt");
  assert.equal(sentMessages[0].account, "alice@example.com");
  assert.deepEqual(sentMessages[0].records, [
    { title: "测试对话", url: "https://example.test/c/abc123" }
  ]);
});

test("scraper 用 ChatGPT config 回退到 displayName 与 ariaName", () => {
  const accountEl = makeAccountElement({ ariaLabel: "Open account menu", display: "Alice Display", displayClass: "truncate" });
  const { sentMessages } = runScraperOnce({
    config: CHATGPT_CONFIG,
    accountElements: [accountEl],
    historyLinks: []
  });
  assert.equal(sentMessages[0].account, "Alice Display");
});

test("scraper 用 Gemini config 抓取 title 优先 aria-label", () => {
  const link = makeLink({ href: "/app/xyz", text: "fallback", ariaLabel: "首选标题", title: "次选标题" });
  const { sentMessages } = runScraperOnce({
    config: GEMINI_CONFIG,
    accountElements: [],
    historyLinks: [link]
  });
  assert.equal(sentMessages[0].provider, "gemini");
  assert.deepEqual(sentMessages[0].records, [
    { title: "首选标题", url: "https://example.test/app/xyz" }
  ]);
});

test("scraper 用 Gemini config 在无 aria-label 时回退 titleSubSelector", () => {
  const link = makeLink({ href: "/app/xyz", text: "fallback", ariaLabel: null, title: "次选标题" });
  const { sentMessages } = runScraperOnce({
    config: GEMINI_CONFIG,
    accountElements: [],
    historyLinks: [link]
  });
  assert.equal(sentMessages[0].records[0].title, "次选标题");
});

test("scraper 清除 url.search 与 url.hash", () => {
  const link = makeLink({ href: "/c/abc?model=gpt-4#frag", text: "带参数" });
  const { sentMessages } = runScraperOnce({
    config: CHATGPT_CONFIG,
    accountElements: [],
    historyLinks: [link]
  });
  assert.equal(sentMessages[0].records[0].url, "https://example.test/c/abc");
});

test("scraper 过滤不匹配 historyPathPrefix 的链接", () => {
  const goodLink = makeLink({ href: "/c/abc", text: "good" });
  const badLink = makeLink({ href: "/other/xyz", text: "bad" });
  const { sentMessages } = runScraperOnce({
    config: CHATGPT_CONFIG,
    accountElements: [],
    historyLinks: [goodLink, badLink]
  });
  assert.deepEqual(sentMessages[0].records.map((r) => r.url), ["https://example.test/c/abc"]);
});

test("scraper hideNativeSidebar 注入带正确 id 与 selector 的 style", () => {
  const { appendedNodes, styleEl } = runScraperOnce({
    config: GEMINI_CONFIG,
    accountElements: [],
    historyLinks: []
  });
  assert.equal(appendedNodes.length, 1);
  assert.equal(styleEl.id, "llmnav-hide-gemini-sidebar");
  assert.match(styleEl.textContent, /bard-sidenav/);
  assert.match(styleEl.textContent, /display:\s*none\s*!important/);
});

test("scraper 在 chrome.runtime.sendMessage 抛错时不崩溃", () => {
  assert.doesNotThrow(() => runScraperOnce({
    config: CHATGPT_CONFIG,
    accountElements: [],
    historyLinks: [],
    sendMessageImpl() { throw new Error("Extension context invalidated."); }
  }));
});

test("scraper 在 focus / visibilitychange 触发重抓", () => {
  const link = makeLink({ href: "/c/one", text: "一" });
  const { sentMessages, listeners } = runScraperOnce({
    config: CHATGPT_CONFIG,
    accountElements: [],
    historyLinks: [link]
  });
  assert.equal(sentMessages.length, 1);
  listeners["window:focus"]();
  assert.equal(sentMessages.length, 2);
  listeners["document:visibilitychange"]();
  assert.equal(sentMessages.length, 3);
});

test("scraper 在 sendVisibleHistory 中先抓后藏 sidebar", () => {
  assert.match(
    SCRAPER_SOURCE,
    /function sendVisibleHistory\(\)\s*\{[\s\S]*?scrapeAccount\(\)[\s\S]*?scrapeVisibleHistory\(\)[\s\S]*?hideNativeSidebar\(\)[\s\S]*?chrome\.runtime\.sendMessage/
  );
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/content-scraper.test.js`
Expected: FAIL — `content-scraper.js` 不存在。

- [ ] **Step 3: 创建 content-scraper.js**

写入 `content-scraper.js`:

```javascript
(function () {
  if (typeof self === "undefined" || !self.LLMNavProvider) {
    return;
  }

  const config = self.LLMNavProvider;
  const scraping = config.scraping;
  const providerName = config.name;
  let syncTimer = 0;

  function extractEmail(text) {
    const match = String(text || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    return match ? match[0].toLowerCase() : "";
  }

  function normalizeAccountName(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .replace(/^Google\s*(?:账号|账户|Account)\s*[:：]?\s*/i, "")
      .replace(/\s*(?:个人帐户|个人账户|Personal account).*$/i, "")
      .replace(/\s*[,,]?\s*(?:打开|Open).*$/i, "")
      .replace(/\s*\([^)]*@[^)]*\)\s*$/, "")
      .trim();
  }

  function scrapeAccount() {
    for (const selector of scraping.accountSelectors) {
      for (const element of document.querySelectorAll(selector)) {
        const rawText = `${element.getAttribute("aria-label") || ""} ${element.textContent || ""}`;
        const email = extractEmail(rawText);
        if (email) {
          return email;
        }

        if (scraping.accountDisplaySubSelector) {
          const node = element.querySelector(scraping.accountDisplaySubSelector);
          const displayName = normalizeAccountName(node ? node.textContent : "");
          if (displayName) {
            return displayName;
          }
        }

        const ariaName = normalizeAccountName(element.getAttribute("aria-label"));
        if (ariaName) {
          return ariaName;
        }
      }
    }

    return "";
  }

  function scrapeVisibleHistory() {
    const seen = new Set();
    const records = [];
    const historyRoot = document.querySelector(scraping.historyRootSelector);
    const sourceRoot = historyRoot || document;

    sourceRoot.querySelectorAll(scraping.historyLinkSelector).forEach((link) => {
      if (!historyRoot && !isVisible(link)) {
        return;
      }

      const url = normalizeHistoryUrl(link.getAttribute("href"));
      if (!url || seen.has(url)) {
        return;
      }

      seen.add(url);
      records.push({
        title: pickTitle(link),
        url
      });
    });

    return records;
  }

  function pickTitle(link) {
    const aria = link.getAttribute("aria-label");
    if (aria && aria.trim()) {
      return normalizeTitle(aria);
    }

    if (scraping.titleSubSelector) {
      const node = link.querySelector(scraping.titleSubSelector);
      if (node) {
        return normalizeTitle(node.textContent);
      }
    }

    return normalizeTitle(link.textContent);
  }

  function normalizeHistoryUrl(href) {
    try {
      const url = new URL(href, location.origin);
      if (!url.pathname.startsWith(scraping.historyPathPrefix)) {
        return "";
      }

      url.hash = "";
      url.search = "";
      return url.toString();
    } catch (error) {
      return "";
    }
  }

  function normalizeTitle(title) {
    return String(title || "").replace(/\s+/g, " ").trim() || "未命名对话";
  }

  function isVisible(element) {
    return element.getClientRects().length > 0;
  }

  function hideNativeSidebar() {
    if (document.getElementById(scraping.hideStyleId)) {
      return;
    }

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
        {
          type: "llmnav:visibleHistory",
          provider: providerName,
          account,
          records
        },
        () => {
          void chrome.runtime.lastError;
        }
      );
    } catch (error) {
      void error;
    }
  }

  function scheduleSync() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(sendVisibleHistory, 500);
  }

  function start() {
    sendVisibleHistory();

    const observer = new MutationObserver(scheduleSync);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    window.addEventListener("focus", scheduleSync);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        scheduleSync();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/content-scraper.test.js`
Expected: 全部 PASS(11 个 test)。

Run: `node --test tests/*.test.js`
Expected: 全量测试通过。

- [ ] **Step 5: 提交**

```bash
git add content-scraper.js tests/content-scraper.test.js
git commit -m "$(cat <<'EOF'
feat: extract shared content-scraper framework

把两份 content-<provider>.js 的共同骨架抽出,差异点全部参数化到
LLMNavProvider.scraping。本次仅新增文件,manifest 尚未引用。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: background.js 改为注册表驱动

**Files:**
- Modify: `background.js`
- Modify: `tests/manifest.test.js`(替换 PROVIDER_CONFIGS 相关断言)

- [ ] **Step 1: 改测试以覆盖新结构**

打开 `tests/manifest.test.js`,找到以下整个测试并替换:

```javascript
test("background routes any registered provider via PROVIDER_CONFIGS", () => {
  const source = fs.readFileSync(path.join(__dirname, "../background.js"), "utf8");

  assert.match(source, /const PROVIDER_CONFIGS\s*=\s*\{/);
  assert.match(source, /chatgpt:\s*\{\s*origins:\s*\[\s*"https:\/\/chatgpt\.com"\s*,\s*"https:\/\/chat\.openai\.com"\s*\]\s*\}/);
  assert.match(source, /gemini:\s*\{\s*origins:\s*\[\s*"https:\/\/gemini\.google\.com"\s*\]\s*\}/);
  assert.doesNotMatch(source, /message\.provider === "chatgpt"/);
  assert.doesNotMatch(source, /isChatGPTUrl\(/);
});
```

替换为:

```javascript
test("background imports provider registry and routes via LLMNavProviders", () => {
  const source = fs.readFileSync(path.join(__dirname, "../background.js"), "utf8");

  assert.match(source, /importScripts\("providers\/chatgpt\.js",\s*"providers\/gemini\.js"\)/);
  assert.match(source, /self\.LLMNavProviders/);
  assert.match(source, /Object\.hasOwn\(\s*listProviders\(\),\s*message\.provider\s*\)/);
  assert.doesNotMatch(source, /const PROVIDER_CONFIGS\s*=/);
  assert.doesNotMatch(source, /message\.provider === "chatgpt"/);
  assert.doesNotMatch(source, /isChatGPTUrl\(/);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/manifest.test.js`
Expected: FAIL — 新断言不匹配现有 `background.js`。

- [ ] **Step 3: 重写 background.js**

完整重写 `background.js`:

```javascript
importScripts("storage-model.js");
importScripts("providers/chatgpt.js", "providers/gemini.js");

const providerState = {};

function listProviders() {
  return self.LLMNavProviders || {};
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  updateActiveTabState(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" || changeInfo.url) {
    updateActiveTabState(tabId, tab);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === "llmnav:visibleHistory" && Object.hasOwn(listProviders(), message.provider)) {
    handleVisibleHistory(message)
      .then(() => {
        sendResponse({ ok: true });
      })
      .catch(() => {
        sendResponse({ ok: false });
      });
    return true;
  }

  if (message && message.type === "llmnav:getPageState") {
    getCurrentPageState()
      .then((state) => {
        sendResponse(state);
      })
      .catch(() => {
        sendResponse({ supported: false });
      });
    return true;
  }

  return false;
});

async function handleVisibleHistory(message) {
  const stored = await chrome.storage.local.get(["folders", "activeAccounts"]);
  const next = LLMNavModel.upsertVisibleConversations(
    { folders: stored.folders, activeAccounts: stored.activeAccounts },
    message.provider,
    message.account,
    message.records || []
  );

  await chrome.storage.local.set({
    folders: next.folders,
    activeAccounts: next.activeAccounts
  });

  providerState[message.provider] = {
    supported: true,
    provider: message.provider,
    hasAccount: Boolean(message.account && message.account.trim()),
    account: message.account || "",
    hasHistory: Array.isArray(message.records) && message.records.length > 0
  };

  notify({ type: "llmnav:storageUpdated" });
  notify({ type: "llmnav:pageState", state: providerState[message.provider] });
}

async function updateActiveTabState(tabId, knownTab) {
  const tab = knownTab || await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) {
    return;
  }

  notify({
    type: "llmnav:pageState",
    state: pageStateFromTab(tab)
  });
}

async function getCurrentPageState() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  return pageStateFromTab(tab);
}

function pageStateFromTab(tab) {
  const providerName = resolveProvider(tab && tab.url);
  if (!providerName) {
    return { supported: false };
  }

  const state = providerState[providerName];
  if (!state) {
    return {
      supported: true,
      provider: providerName,
      hasAccount: false,
      account: "",
      hasHistory: false
    };
  }

  return {
    supported: true,
    provider: providerName,
    hasAccount: Boolean(state.hasAccount),
    account: state.account || "",
    hasHistory: Boolean(state.hasHistory)
  };
}

function resolveProvider(url) {
  try {
    const origin = new URL(url).origin;
    for (const [name, config] of Object.entries(listProviders())) {
      if (config.origins.includes(origin)) {
        return name;
      }
    }
  } catch (error) {
    void error;
  }
  return "";
}

function notify(message) {
  chrome.runtime.sendMessage(message, () => {
    void chrome.runtime.lastError;
  });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/*.test.js`
Expected: 全量测试通过。原有 background 相关测试(`background defaults page state to unknown`、`background async message handlers return failure responses`、`background defaults gemini page state to unknown`)仍然成立,因为重构保留了 `providerState`、`pageStateFromTab`、`provider: providerName` 等结构。

- [ ] **Step 5: 提交**

```bash
git add background.js tests/manifest.test.js
git commit -m "$(cat <<'EOF'
refactor: background reads providers from LLMNavProviders registry

importScripts 加载每个 provider 配置文件后,通过 self.LLMNavProviders
路由消息与解析 URL。删除内联的 PROVIDER_CONFIGS 常量。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: sidepanel.{html,css,js} 改为注册表驱动

**Files:**
- Modify: `sidepanel.html`
- Modify: `sidepanel.css`
- Modify: `sidepanel.js`
- Modify: `tests/sidepanel-static.test.js`

- [ ] **Step 1: 改 sidepanel-static.test.js**

完整重写 `tests/sidepanel-static.test.js`:

```javascript
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const model = require("../storage-model.js");

function readFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

function loadProviderRegistry() {
  const context = { self: {} };
  vm.runInNewContext(readFile("providers/chatgpt.js"), context);
  vm.runInNewContext(readFile("providers/gemini.js"), context);
  return context.self.LLMNavProviders;
}

test("sidepanel html 保留最简结构 + 加载 provider 注册表脚本", () => {
  const html = readFile("sidepanel.html");

  assert.match(html, /id="actions"/);
  assert.match(html, /id="show-folder-form"/);
  assert.match(html, /id="folder-form"/);
  assert.match(html, /id="folders"/);
  assert.match(html, /providers\/chatgpt\.js/);
  assert.match(html, /providers\/gemini\.js/);
  assert.match(html, /storage-model\.js/);
  assert.match(html, /sidepanel\.js/);
  assert.equal(/<h1\b/i.test(html), false);
  assert.equal(/账号邮箱/.test(html), false);
  assert.doesNotMatch(html, /id="new-chatgpt"/);
  assert.doesNotMatch(html, /id="new-gemini"/);
});

test("sidepanel script 通过注册表渲染按钮、徽标与文案", () => {
  const script = readFile("sidepanel.js");

  assert.match(script, /createFolder/);
  assert.match(script, /dragstart/);
  assert.match(script, /drop/);
  assert.match(script, /chrome\.tabs\.update/);
  assert.match(script, /llmnav:getPageState/);
  assert.match(script, /chrome\.runtime\.onMessage\.addListener/);
  assert.match(script, /chrome\.storage\.onChanged\.addListener/);
  assert.match(script, /event\.dataTransfer\.setData/);
  assert.match(script, /provider: record\.provider/);
  assert.match(script, /account: record\.account/);
  assert.match(script, /moveConversation\(state, data\.provider, data\.url, targetFolder, data\.account\)/);
  assert.match(script, /renderNewChatButtons/);
  assert.match(script, /window\.LLMNavProviders/);
  assert.match(script, /provider\.newChatUrl/);
  assert.match(script, /provider\.badge\.color/);
  assert.match(script, /provider\.badge\.letter/);
  assert.match(script, /provider\.label/);
  assert.match(script, /filterFoldersAcrossProviders/);
  assert.doesNotMatch(script, /const PROVIDER_NEW_CHAT_URLS/);
  assert.doesNotMatch(script, /const PROVIDER_BADGES/);
  assert.doesNotMatch(script, /const PROVIDER_LABELS/);
});

test("sidepanel css 保留 Google sidebar 字体与行度量", () => {
  const css = readFile("sidepanel.css");

  assert.match(css, /font-family:\s*"Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif;/);
  assert.match(css, /font-size:\s*13px;/);
  assert.match(css, /line-height:\s*17px;/);
  assert.match(css, /-webkit-font-smoothing:\s*antialiased;/);
  assert.match(css, /\.folders\s*{[\s\S]*display:\s*flex;[\s\S]*flex-direction:\s*column;[\s\S]*padding:\s*0;/);
  assert.match(css, /\.folder-row,\n\.conversation-row\s*{[\s\S]*display:\s*flex;[\s\S]*height:\s*32px;[\s\S]*border-radius:\s*9999px;[\s\S]*padding:\s*0 8px;/);
});

test("sidepanel css 把字体应用到 row 与文本标签", () => {
  const css = readFile("sidepanel.css");

  assert.match(css, /\.folder-row,\n\.conversation-row\s*{[\s\S]*font-family:\s*"Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif;[\s\S]*font-size:\s*13px;[\s\S]*line-height:\s*17px;/);
  assert.match(css, /\.folder-label,\n\.conversation-title\s*{[\s\S]*font-family:\s*"Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif;[\s\S]*font-size:\s*13px;[\s\S]*line-height:\s*17px;/);
});

test("sidepanel css 把字体应用到按钮", () => {
  const css = readFile("sidepanel.css");

  assert.match(css, /\.actions button,\n\.folder-form button\s*{[^}]*font-family:\s*"Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif;[^}]*font-size:\s*13px;[^}]*line-height:\s*17px;[^}]*font-weight:\s*400;/);
});

test("sidepanel css 定义 badge 形状但不内置颜色类", () => {
  const css = readFile("sidepanel.css");

  assert.match(css, /\.conversation-badge\s*\{[\s\S]*border-radius:\s*9999px;[\s\S]*\}/);
  assert.doesNotMatch(css, /\.badge-chatgpt/);
  assert.doesNotMatch(css, /\.badge-gemini/);
});

test("sidepanel 忽略已过期的重叠渲染", async () => {
  const source = readFile("sidepanel.js");
  const providers = loadProviderRegistry();
  const messageListeners = [];
  const pendingStorageGets = [];
  let domContentLoadedListener = null;
  let immediateStorage = true;
  const storedState = {
    folders: {
      unclassified: [
        { provider: "chatgpt", account: "user@example.com", title: "聊天记录", url: "https://chatgpt.com/c/one" }
      ],
      archived: []
    },
    activeAccounts: { chatgpt: "user@example.com" }
  };

  async function flushPromises() {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  function createElement() {
    const node = {
      children: [],
      classList: { add() {}, remove() {} },
      dataset: {},
      style: {},
      addEventListener() {},
      append(...nodes) { this.children.push(...nodes); },
      appendChild(child) { this.children.push(child); return child; },
      insertBefore(child) { this.children.push(child); return child; },
      focus() {},
      replaceChildren(...nodes) { this.children = [...nodes]; }
    };
    return node;
  }

  const elements = {
    actions: createElement(),
    "show-folder-form": createElement(),
    "folder-form": createElement(),
    "folder-name": createElement(),
    folders: createElement(),
    notice: createElement()
  };

  const context = {
    window: { LLMNavProviders: providers },
    chrome: {
      runtime: {
        onMessage: { addListener(listener) { messageListeners.push(listener); } },
        sendMessage(message, callback) {
          callback({ supported: true, provider: "chatgpt", hasAccount: true, account: "user@example.com", hasHistory: true });
        }
      },
      storage: {
        local: {
          get() {
            if (immediateStorage) return Promise.resolve(storedState);
            return new Promise((resolve) => {
              pendingStorageGets.push(() => resolve(storedState));
            });
          }
        },
        onChanged: { addListener() {} }
      },
      tabs: { query() {} }
    },
    document: {
      addEventListener(type, listener) {
        if (type === "DOMContentLoaded") domContentLoadedListener = listener;
      },
      createElement,
      getElementById(id) { return elements[id]; }
    },
    LLMNavModel: model
  };

  vm.runInNewContext(source, context);
  await domContentLoadedListener();
  assert.equal(elements.folders.children.length, 1);

  immediateStorage = false;
  messageListeners[0]({ type: "llmnav:storageUpdated" });
  messageListeners[0]({ type: "llmnav:storageUpdated" });
  assert.equal(pendingStorageGets.length, 2);

  pendingStorageGets[1]();
  await flushPromises();
  pendingStorageGets[0]();
  await flushPromises();

  assert.equal(elements.folders.children.length, 1);
});

test("sidepanel 渲染混合 provider 记录并设置 inline badge 颜色", async () => {
  const source = readFile("sidepanel.js");
  const providers = loadProviderRegistry();
  const messageListeners = [];
  let domContentLoadedListener = null;
  const storedState = {
    folders: {
      unclassified: [
        { provider: "chatgpt", account: "u@example.com", title: "ChatGPT 聊天", url: "https://chatgpt.com/c/a" },
        { provider: "gemini",  account: "u@example.com", title: "Gemini 聊天",  url: "https://gemini.google.com/app/a" }
      ],
      archived: []
    },
    activeAccounts: { chatgpt: "u@example.com", gemini: "u@example.com" }
  };

  function createElement(tagName) {
    return {
      tagName: tagName || "div",
      className: "",
      children: [],
      classList: { add() {}, remove() {} },
      dataset: {},
      style: {},
      addEventListener() {},
      append(...nodes) { this.children.push(...nodes); },
      appendChild(child) { this.children.push(child); return child; },
      insertBefore(child, ref) {
        const idx = this.children.indexOf(ref);
        if (idx === -1) this.children.push(child);
        else this.children.splice(idx, 0, child);
        return child;
      },
      focus() {},
      replaceChildren(...nodes) { this.children = [...nodes]; }
    };
  }

  const elements = {
    actions: createElement("section"),
    "show-folder-form": createElement("button"),
    "folder-form":      createElement("form"),
    "folder-name":      createElement("input"),
    folders: createElement("section"),
    notice:  createElement("p")
  };
  elements.actions.children.push(elements["show-folder-form"], elements["folder-form"]);

  const context = {
    window: { LLMNavProviders: providers },
    chrome: {
      runtime: {
        onMessage: { addListener(listener) { messageListeners.push(listener); } },
        sendMessage(message, callback) {
          callback({ supported: true, provider: "chatgpt", hasAccount: true, account: "u@example.com", hasHistory: true });
        }
      },
      storage: {
        local: { get() { return Promise.resolve(storedState); } },
        onChanged: { addListener() {} }
      },
      tabs: { query() {} }
    },
    document: {
      addEventListener(type, listener) {
        if (type === "DOMContentLoaded") domContentLoadedListener = listener;
      },
      createElement,
      getElementById(id) { return elements[id]; }
    },
    LLMNavModel: model
  };

  vm.runInNewContext(source, context);
  await domContentLoadedListener();

  const folderSection = elements.folders.children[0];
  assert.ok(folderSection, "至少渲染一个目录");
  const conversationList = folderSection.children.find((node) => node.className === "conversation-list");
  assert.ok(conversationList, "未分类目录应展开后渲染对话列表");
  assert.equal(conversationList.children.length, 2);

  const badges = conversationList.children.map((row) =>
    row.children.find((node) => node.className === "conversation-badge")
  );
  assert.equal(badges[0].textContent, "C");
  assert.equal(badges[0].style.backgroundColor, "#10a37f");
  assert.equal(badges[1].textContent, "G");
  assert.equal(badges[1].style.backgroundColor, "#4285f4");
});

test("sidepanel 通过注册表注入 per-provider 新建按钮", async () => {
  const source = readFile("sidepanel.js");
  const providers = loadProviderRegistry();
  let domContentLoadedListener = null;
  const storedState = { folders: { unclassified: [], archived: [] }, activeAccounts: {} };

  function createElement() {
    return {
      children: [],
      classList: { add() {}, remove() {} },
      dataset: {},
      style: {},
      addEventListener() {},
      append(...nodes) { this.children.push(...nodes); },
      appendChild(child) { this.children.push(child); return child; },
      insertBefore(child, ref) {
        const idx = this.children.indexOf(ref);
        if (idx === -1) this.children.push(child);
        else this.children.splice(idx, 0, child);
        return child;
      },
      focus() {},
      replaceChildren(...nodes) { this.children = [...nodes]; }
    };
  }

  const elements = {
    actions: createElement(),
    "show-folder-form": createElement(),
    "folder-form": createElement(),
    "folder-name": createElement(),
    folders: createElement(),
    notice: createElement()
  };
  elements.actions.children.push(elements["show-folder-form"]);

  const context = {
    window: { LLMNavProviders: providers },
    chrome: {
      runtime: {
        onMessage: { addListener() {} },
        sendMessage(_, cb) { cb({ supported: false }); }
      },
      storage: {
        local: { get() { return Promise.resolve(storedState); } },
        onChanged: { addListener() {} }
      },
      tabs: { query() {} }
    },
    document: {
      addEventListener(type, listener) {
        if (type === "DOMContentLoaded") domContentLoadedListener = listener;
      },
      createElement,
      getElementById(id) { return elements[id]; }
    },
    LLMNavModel: model
  };

  vm.runInNewContext(source, context);
  await domContentLoadedListener();

  const buttons = elements.actions.children.filter((child) => child !== elements["show-folder-form"] && child !== elements["folder-form"]);
  assert.equal(buttons.length, 2);
  assert.ok(buttons.some((btn) => btn.textContent === "新建 ChatGPT 对话"));
  assert.ok(buttons.some((btn) => btn.textContent === "新建 Gemini 对话"));
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/sidepanel-static.test.js`
Expected: FAIL — 现有 `sidepanel.html` / `sidepanel.css` / `sidepanel.js` 仍然硬编码按钮、含 `.badge-chatgpt` 类、含 `PROVIDER_NEW_CHAT_URLS` 等。

- [ ] **Step 3: 重写 sidepanel.html**

完整重写 `sidepanel.html`:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="stylesheet" href="sidepanel.css">
  </head>
  <body>
    <main class="panel">
      <section class="actions" id="actions" aria-label="快捷操作">
        <button id="show-folder-form" type="button">新建目录</button>
        <form id="folder-form" class="folder-form hidden" autocomplete="off">
          <input id="folder-name" name="folderName" type="text" maxlength="40" placeholder="目录名称" aria-label="目录名称">
          <button type="submit">创建</button>
        </form>
      </section>
      <p id="notice" class="notice hidden"></p>
      <section id="folders" class="folders" aria-label="对话目录"></section>
    </main>
    <script src="providers/chatgpt.js"></script>
    <script src="providers/gemini.js"></script>
    <script src="storage-model.js"></script>
    <script src="sidepanel.js"></script>
  </body>
</html>
```

- [ ] **Step 4: 改 sidepanel.css(删除 badge 颜色类)**

打开 `sidepanel.css`,找到末尾以下两块并删除:

```css
.badge-chatgpt {
  background: #10a37f;
}

.badge-gemini {
  background: #4285f4;
}
```

`.conversation-badge` 规则保留不动(形状仍由 CSS 控制,颜色改成 JS inline 设置)。

- [ ] **Step 5: 完整重写 sidepanel.js**

写入 `sidepanel.js`:

```javascript
const FOLDER_LABELS = {
  unclassified: "未分类",
  archived: "归档"
};

let pageState = { supported: false };
let collapsedFolders = new Set(["archived"]);
let renderSequence = 0;

function byId(id) {
  return document.getElementById(id);
}

function listProviders() {
  return window.LLMNavProviders || {};
}

function getProvider(name) {
  return listProviders()[name] || null;
}

document.addEventListener("DOMContentLoaded", init);

async function init() {
  renderNewChatButtons();
  byId("show-folder-form").addEventListener("click", showFolderForm);
  byId("folder-form").addEventListener("submit", createFolderFromForm);

  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === "llmnav:pageState") {
      pageState = message.state || { supported: false };
      render();
    }

    if (message && message.type === "llmnav:storageUpdated") {
      render();
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && (changes.folders || changes.activeAccounts)) {
      render();
    }
  });

  pageState = await sendMessage({ type: "llmnav:getPageState" }) || { supported: false };
  await render();
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

function showFolderForm() {
  const form = byId("folder-form");
  form.classList.remove("hidden");
  byId("folder-name").focus();
}

async function createFolderFromForm(event) {
  event.preventDefault();

  const input = byId("folder-name");
  const state = await loadState();
  const next = LLMNavModel.createFolder(state, input.value);

  await saveState(next);
  input.value = "";
  byId("folder-form").classList.add("hidden");
  await render();
}

async function render() {
  const sequence = ++renderSequence;
  const container = byId("folders");
  container.replaceChildren();

  const state = await loadState();
  if (sequence !== renderSequence) {
    return;
  }

  const providerStatuses = {};
  if (pageState && pageState.supported && pageState.provider) {
    providerStatuses[pageState.provider] = {
      hasAccount: Boolean(pageState.hasAccount),
      account: pageState.account || ""
    };
  }

  const folders = LLMNavModel.filterFoldersAcrossProviders(state, providerStatuses);

  renderNoticeForPageState();

  LLMNavModel.getFolderOrder(folders).forEach((folderName) => {
    if (folderName === "archived" && folders[folderName].length === 0) {
      return;
    }

    container.appendChild(renderFolder(folderName, folders[folderName]));
  });
}

function renderNoticeForPageState() {
  if (!pageState || !pageState.supported) {
    const labels = Object.values(listProviders()).map((provider) => provider.label);
    const joined = labels.length > 0 ? labels.join("、") : "支持的 LLM";
    showNotice(`当前页面不是支持的 LLM 页面。打开 ${joined} 后可同步可见历史。`);
    return;
  }

  const provider = getProvider(pageState.provider);
  const providerLabel = provider ? provider.label : pageState.provider;
  const messages = [];

  if (pageState.hasAccount === false) {
    messages.push(`无法获取 ${providerLabel} 账号,当前显示 ${providerLabel} 的全部本地对话,可能包含其他账号。`);
  }

  if (pageState.hasHistory === false) {
    messages.push("未检测到可见历史,已保留已有本地数据。");
  }

  if (messages.length > 0) {
    showNotice(messages.join(" "));
  } else {
    hideNotice();
  }
}

function renderFolder(folderName, records) {
  const section = document.createElement("section");
  section.className = "folder";
  section.dataset.folder = folderName;

  const row = document.createElement("button");
  row.type = "button";
  row.className = "folder-row";
  row.addEventListener("click", () => toggleFolder(folderName));
  row.addEventListener("dragover", (event) => {
    event.preventDefault();
    section.classList.add("drag-over");
  });
  row.addEventListener("dragleave", () => {
    section.classList.remove("drag-over");
  });
  row.addEventListener("drop", async (event) => {
    event.preventDefault();
    section.classList.remove("drag-over");
    await handleDrop(event, folderName);
  });

  const label = document.createElement("span");
  label.className = "folder-label";
  label.textContent = `${collapsedFolders.has(folderName) ? "▸" : "▾"} ${FOLDER_LABELS[folderName] || folderName}`;

  const count = document.createElement("span");
  count.className = "folder-count";
  count.textContent = String(records.length);

  row.append(label, count);
  section.appendChild(row);

  if (!collapsedFolders.has(folderName)) {
    const list = document.createElement("div");
    list.className = "conversation-list";
    records.forEach((record) => {
      list.appendChild(renderConversation(record));
    });
    section.appendChild(list);
  }

  return section;
}

function renderConversation(record) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "conversation-row";
  row.draggable = true;
  row.title = record.title;
  row.addEventListener("click", () => openUrl(record.url));
  row.addEventListener("dragstart", (event) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/json", JSON.stringify({
      provider: record.provider,
      url: record.url,
      account: record.account
    }));
  });

  const provider = getProvider(record.provider);
  const badge = document.createElement("span");
  badge.className = "conversation-badge";
  if (provider) {
    badge.textContent = provider.badge.letter;
    badge.style.backgroundColor = provider.badge.color;
  } else {
    badge.textContent = "?";
  }

  const title = document.createElement("span");
  title.className = "conversation-title";
  title.textContent = record.title;

  row.append(badge, title);
  return row;
}

function toggleFolder(folderName) {
  if (collapsedFolders.has(folderName)) {
    collapsedFolders.delete(folderName);
  } else {
    collapsedFolders.add(folderName);
  }

  render();
}

async function handleDrop(event, targetFolder) {
  const raw = event.dataTransfer.getData("application/json");
  if (!raw) {
    return;
  }

  const data = JSON.parse(raw);
  const state = await loadState();
  const next = LLMNavModel.moveConversation(state, data.provider, data.url, targetFolder, data.account);
  await saveState(next);
  await render();
}

function openUrl(url) {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (tab && tab.id) {
      chrome.tabs.update(tab.id, { url });
    }
  });
}

async function loadState() {
  const stored = await chrome.storage.local.get(["folders", "activeAccounts"]);
  return LLMNavModel.cloneState({
    folders: stored.folders,
    activeAccounts: stored.activeAccounts
  });
}

async function saveState(state) {
  await chrome.storage.local.set({
    folders: state.folders,
    activeAccounts: state.activeAccounts
  });
}

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }

      resolve(response);
    });
  });
}

function showNotice(message) {
  const notice = byId("notice");
  notice.textContent = message;
  notice.classList.remove("hidden");
}

function hideNotice() {
  const notice = byId("notice");
  notice.textContent = "";
  notice.classList.add("hidden");
}
```

- [ ] **Step 6: 跑测试确认通过**

Run: `node --test tests/sidepanel-static.test.js`
Expected: 全部 PASS。

Run: `node --test tests/*.test.js`
Expected: 全量测试通过。

- [ ] **Step 7: 提交**

```bash
git add sidepanel.html sidepanel.css sidepanel.js tests/sidepanel-static.test.js
git commit -m "$(cat <<'EOF'
refactor: sidepanel renders buttons/badges/labels from registry

sidepanel.html 只保留 #actions 容器,sidepanel.js 通过
window.LLMNavProviders 动态注入按钮、徽标颜色与 notice 文案。
sidepanel.css 删除 .badge-chatgpt / .badge-gemini 颜色类
(颜色由 JS inline 设置)。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: 切换 manifest + 删除 legacy 文件

**Files:**
- Modify: `manifest.json`
- Modify: `tests/manifest.test.js`(替换 content-script 相关断言)
- Delete: `content-chatgpt.js`
- Delete: `content-gemini.js`
- Delete: `tests/content-gemini.test.js`

- [ ] **Step 1: 重写 tests/manifest.test.js**

完整重写 `tests/manifest.test.js`(保留 background 相关测试,替换 content-script 相关测试,新增 manifest-registry 同步测试):

```javascript
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function readManifest() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "../manifest.json"), "utf8"));
}

function loadProviderRegistry() {
  const context = { self: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../providers/chatgpt.js"), "utf8"), context);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../providers/gemini.js"), "utf8"), context);
  return context.self.LLMNavProviders;
}

test("manifest declares MV3 side panel shell", () => {
  const manifest = readManifest();

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.side_panel.default_path, "sidepanel.html");
  assert.equal(manifest.background.service_worker, "background.js");
  assert.ok(manifest.permissions.includes("sidePanel"));
  assert.ok(manifest.permissions.includes("storage"));
  assert.ok(manifest.permissions.includes("tabs"));
  assert.ok(manifest.permissions.includes("activeTab"));
});

test("manifest description mentions both ChatGPT and Gemini", () => {
  const manifest = readManifest();
  assert.match(manifest.description, /ChatGPT/);
  assert.match(manifest.description, /Gemini/);
});

test("manifest host_permissions 与注册表 origins 同步", () => {
  const manifest = readManifest();
  const registry = loadProviderRegistry();
  Object.values(registry).forEach((provider) => {
    provider.origins.forEach((origin) => {
      const host = new URL(origin).host;
      assert.ok(
        manifest.host_permissions.includes(`https://${host}/*`),
        `host_permissions 缺少 ${host}`
      );
    });
  });
});

test("manifest content_scripts 与注册表一一对应", () => {
  const manifest = readManifest();
  const registry = loadProviderRegistry();
  const providers = Object.values(registry);

  assert.equal(manifest.content_scripts.length, providers.length);

  providers.forEach((provider) => {
    const entries = manifest.content_scripts.filter((script) => script.js.includes(`providers/${provider.name}.js`));
    assert.equal(entries.length, 1, `${provider.name} 应恰好对应一条 content_scripts`);
    const entry = entries[0];
    assert.equal(entry.js[0], `providers/${provider.name}.js`);
    assert.equal(entry.js[entry.js.length - 1], "content-scraper.js");
    assert.equal(entry.run_at, "document_idle");
    provider.matches.forEach((match) => {
      assert.ok(entry.matches.includes(match), `${provider.name} matches 缺少 ${match}`);
    });
  });
});

test("background imports provider registry and routes via LLMNavProviders", () => {
  const source = fs.readFileSync(path.join(__dirname, "../background.js"), "utf8");

  assert.match(source, /importScripts\("providers\/chatgpt\.js",\s*"providers\/gemini\.js"\)/);
  assert.match(source, /self\.LLMNavProviders/);
  assert.match(source, /Object\.hasOwn\(\s*listProviders\(\),\s*message\.provider\s*\)/);
  assert.doesNotMatch(source, /const PROVIDER_CONFIGS\s*=/);
  assert.doesNotMatch(source, /message\.provider === "chatgpt"/);
  assert.doesNotMatch(source, /isChatGPTUrl\(/);
});

test("background async message handlers return failure responses", () => {
  const source = fs.readFileSync(path.join(__dirname, "../background.js"), "utf8");

  assert.match(source, /handleVisibleHistory\(message\)[\s\S]*?\.catch\(\(\) => \{[\s\S]*?sendResponse\(\{ ok: false \}\);/);
  assert.match(source, /getCurrentPageState\(\)[\s\S]*?\.catch\(\(\) => \{[\s\S]*?sendResponse\(\{ supported: false \}\);/);
});

test("background defaults page state to unknown before content sync", () => {
  const source = fs.readFileSync(path.join(__dirname, "../background.js"), "utf8");

  assert.match(source, /if \(!state\) \{[\s\S]*?supported: true,[\s\S]*?provider: providerName,[\s\S]*?hasAccount: false,[\s\S]*?account: "",[\s\S]*?hasHistory: false/);
});

test("background uses providerName from resolveProvider", () => {
  const source = fs.readFileSync(path.join(__dirname, "../background.js"), "utf8");

  assert.match(source, /provider:\s*providerName/);
});

test("legacy content-<provider>.js 已被删除", () => {
  assert.equal(fs.existsSync(path.join(__dirname, "../content-chatgpt.js")), false);
  assert.equal(fs.existsSync(path.join(__dirname, "../content-gemini.js")), false);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/manifest.test.js`
Expected: FAIL — 现有 `manifest.json` 仍指向 `content-chatgpt.js` / `content-gemini.js`,旧 `content-<provider>.js` 文件仍存在。

- [ ] **Step 3: 重写 manifest.json**

完整重写 `manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "LLM Navigation",
  "version": "0.1.0",
  "description": "本地管理 ChatGPT、Gemini 对话入口。",
  "permissions": ["sidePanel", "storage", "tabs", "activeTab"],
  "host_permissions": [
    "https://chatgpt.com/*",
    "https://chat.openai.com/*",
    "https://gemini.google.com/*"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "side_panel": {
    "default_path": "sidepanel.html"
  },
  "action": {
    "default_title": "LLM Navigation"
  },
  "content_scripts": [
    {
      "matches": ["https://chatgpt.com/*", "https://chat.openai.com/*"],
      "js": ["providers/chatgpt.js", "content-scraper.js"],
      "run_at": "document_idle"
    },
    {
      "matches": ["https://gemini.google.com/*"],
      "js": ["providers/gemini.js", "content-scraper.js"],
      "run_at": "document_idle"
    }
  ]
}
```

- [ ] **Step 4: 删除 legacy 文件**

```bash
rm content-chatgpt.js content-gemini.js tests/content-gemini.test.js
```

- [ ] **Step 5: 跑测试确认通过**

Run: `node --test tests/*.test.js`
Expected: 全量测试通过。文件树下不再有 `content-chatgpt.js` / `content-gemini.js` / `tests/content-gemini.test.js`。

- [ ] **Step 6: 手工 Chrome 验证**

1. `chrome://extensions` → 重新加载扩展(LLM Navigation)。
2. 打开 ChatGPT,触发 Side Panel,确认:
   - 「新建 ChatGPT 对话」「新建 Gemini 对话」按钮顺序与文案与重构前一致;
   - 对话徽标 `C` 绿底正常显示;
   - 当前账号的对话列表与重构前一致(可能因 `url.search` 清理而合并掉带 `?model=...` 的重复条目)。
3. 打开 Gemini,确认:
   - 徽标 `G` 蓝底显示;
   - 同步逻辑正常,notice 文案与重构前一致。
4. 在两边各拖拽一条对话到自建目录,确认 drag-drop 行为不变。

(若发现回归,回到对应任务排查,**不要**在本任务里堆叠修复——开新提交。)

- [ ] **Step 7: 提交**

```bash
git add manifest.json tests/manifest.test.js
git rm content-chatgpt.js content-gemini.js tests/content-gemini.test.js
git commit -m "$(cat <<'EOF'
refactor: switch content_scripts to provider/scraper bundle, remove legacy

manifest.json 每条 content_scripts 改为 [providers/<name>.js,
content-scraper.js],删除 content-chatgpt.js、content-gemini.js
与 tests/content-gemini.test.js。新 provider 接入流程退化为
4 处机械改动(详见 docs/superpowers/specs/2026-05-26-provider-registry-design.md)。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## 验收

- `node --test tests/*.test.js` 全量通过。
- 文件树:`providers/chatgpt.js`、`providers/gemini.js`、`content-scraper.js` 存在;`content-chatgpt.js`、`content-gemini.js`、`tests/content-gemini.test.js` 不存在。
- 手工 Chrome 验证两个 provider 行为均与重构前一致(徽标、按钮、同步、notice、拖拽)。
- 新增一个 provider 的成本检验:在脑内或纸面草拟 `providers/claude.js`,确认只需 4 处机械改动(新建 `providers/claude.js`、manifest 加 host + content_scripts 一条、`background.js` 加一行 `importScripts`、`sidepanel.html` 加一行 `<script>`)。
