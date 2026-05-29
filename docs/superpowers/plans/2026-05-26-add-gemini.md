# 接入 Gemini provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Gemini 接入插件,与 ChatGPT 并列同步本地可见对话,侧边栏跨 provider 合并展示,顶部双按钮区分新建对话入口。

**Architecture:** 沿用 MV3 + Side Panel + 纯 DOM API,无构建工具。模型层 `storage-model.js` 已 provider-aware,新增 `filterFoldersAcrossProviders` 用于一次性按多个 provider/account 过滤。新增 `content-gemini.js` 镜像 `content-chatgpt.js` 的职责。`background.js` 改为按 `PROVIDER_CONFIGS` 表驱动,接受任意已知 provider 上报并按当前 tab origin 反查 provider。`sidepanel.js` 移除单 provider 假设,渲染时为每行加 provider 徽标。

**Tech Stack:** Chrome Extension Manifest V3、原生 DOM API、`chrome.storage.local`、Node.js `node:test` 静态与模型测试。

---

## 文件结构

- 新建 `content-gemini.js`:Gemini 页面内容脚本(抓账号、可见历史,隐藏原生侧栏)。
- 修改 `manifest.json`:加 Gemini host_permissions 与 content_script;更新 description。
- 修改 `background.js`:`PROVIDER_CONFIGS` 表;handleVisibleHistory 接受任意已知 provider;`pageStateFromTab` 反查 provider。
- 修改 `storage-model.js`:新增 `filterFoldersAcrossProviders` 并导出。
- 修改 `sidepanel.html`:拆按钮(`#new-chatgpt` 与 `#new-gemini`),`#show-folder-form` 保留。
- 修改 `sidepanel.js`:移除 `PROVIDER`/`NEW_CHAT_URL`,绑定双按钮,调用 `filterFoldersAcrossProviders`,渲染徽标,notice 文案带 provider 名。
- 修改 `sidepanel.css`:新增 `.conversation-badge`/`.badge-chatgpt`/`.badge-gemini` 样式。
- 新建 `tests/content-gemini.test.js`:静态断言关键 selector + VM 注入上下文失效验证。
- 修改 `tests/manifest.test.js`:断言 Gemini host 与 content_script 注册;断言 background 含 PROVIDER_CONFIGS 与 gemini origin。
- 修改 `tests/storage-model.test.js`:`filterFoldersAcrossProviders` 用例。
- 修改 `tests/sidepanel-static.test.js`:断言双按钮、徽标样式、跨 provider 渲染调用。

测试命令(项目根目录):

```bash
node --test tests/*.test.js
```

跑单个测试:

```bash
node --test --test-name-pattern "<exact test name>" tests/*.test.js
```

---

## Task 1: `filterFoldersAcrossProviders` 数据模型

**Files:**
- Modify: `storage-model.js`
- Test: `tests/storage-model.test.js`

- [ ] **Step 1: 写失败测试 — 按各自账号同时过滤两个 provider**

在 `tests/storage-model.test.js` 末尾追加:

```javascript
test("filterFoldersAcrossProviders filters each provider by its active account", () => {
  const state = model.createFolder(model.createInitialState(), "work");
  state.folders.unclassified.push(
    { provider: "chatgpt", account: "a@example.com", title: "C-A", url: "https://chatgpt.com/c/a" },
    { provider: "chatgpt", account: "b@example.com", title: "C-B", url: "https://chatgpt.com/c/b" },
    { provider: "gemini",  account: "g1@example.com", title: "G-1", url: "https://gemini.google.com/app/1" },
    { provider: "gemini",  account: "g2@example.com", title: "G-2", url: "https://gemini.google.com/app/2" }
  );
  state.folders.work.push(
    { provider: "chatgpt", account: "a@example.com", title: "C-WORK", url: "https://chatgpt.com/c/work" },
    { provider: "gemini",  account: "g1@example.com", title: "G-WORK", url: "https://gemini.google.com/app/work" }
  );
  state.activeAccounts.chatgpt = "a@example.com";
  state.activeAccounts.gemini = "g1@example.com";

  const filtered = model.filterFoldersAcrossProviders(state, {
    chatgpt: { hasAccount: true, account: "a@example.com" },
    gemini:  { hasAccount: true, account: "g1@example.com" }
  });

  assert.deepEqual(filtered.unclassified.map((record) => record.title), ["C-A", "G-1"]);
  assert.deepEqual(filtered.work.map((record) => record.title), ["C-WORK", "G-WORK"]);
  assert.deepEqual(filtered.archived, []);
});

test("filterFoldersAcrossProviders falls back to storage activeAccounts when provider status missing", () => {
  const state = model.createInitialState();
  state.folders.unclassified.push(
    { provider: "gemini", account: "g1@example.com", title: "G-1", url: "https://gemini.google.com/app/1" },
    { provider: "gemini", account: "g2@example.com", title: "G-2", url: "https://gemini.google.com/app/2" }
  );
  state.activeAccounts.gemini = "g1@example.com";

  const filtered = model.filterFoldersAcrossProviders(state, {});

  assert.deepEqual(filtered.unclassified.map((record) => record.title), ["G-1"]);
});

test("filterFoldersAcrossProviders shows all records of a provider when its account is unknown", () => {
  const state = model.createInitialState();
  state.folders.unclassified.push(
    { provider: "chatgpt", account: "a@example.com", title: "C-A", url: "https://chatgpt.com/c/a" },
    { provider: "chatgpt", account: "b@example.com", title: "C-B", url: "https://chatgpt.com/c/b" }
  );
  state.activeAccounts.chatgpt = "a@example.com";

  const filtered = model.filterFoldersAcrossProviders(state, {
    chatgpt: { hasAccount: false, account: "" }
  });

  assert.deepEqual(filtered.unclassified.map((record) => record.title), ["C-A", "C-B"]);
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `node --test --test-name-pattern "filterFoldersAcrossProviders" tests/*.test.js`
Expected: 3 个用例 FAIL,提示 `model.filterFoldersAcrossProviders is not a function`。

- [ ] **Step 3: 实现 `filterFoldersAcrossProviders`**

在 `storage-model.js` 中,`filterFoldersForProvider` 之后插入:

```javascript
  function filterFoldersAcrossProviders(state, providerStatuses) {
    const next = cloneState(state);
    const statuses = providerStatuses || {};
    const providerNames = new Set([
      ...Object.keys(statuses),
      ...Object.keys(next.activeAccounts)
    ]);

    Object.values(next.folders).forEach((records) => {
      records.forEach((record) => providerNames.add(record.provider));
    });

    const filtered = {};
    Object.keys(next.folders).forEach((folderName) => {
      filtered[folderName] = [];
    });

    providerNames.forEach((provider) => {
      const status = statuses[provider];
      const activeAccount = normalizeAccount((status && status.account) || next.activeAccounts[provider]);
      const filterByAccount = !(status && status.hasAccount === false) && activeAccount !== UNKNOWN_ACCOUNT;

      Object.entries(next.folders).forEach(([folderName, records]) => {
        records.forEach((record) => {
          if (record.provider !== provider) {
            return;
          }

          if (filterByAccount && normalizeAccount(record.account) !== activeAccount) {
            return;
          }

          filtered[folderName].push(record);
        });
      });
    });

    return filtered;
  }
```

并在文件末尾的导出对象里追加 `filterFoldersAcrossProviders`:

```javascript
  return {
    UNKNOWN_ACCOUNT,
    SYSTEM_FOLDERS,
    createInitialState,
    cloneState,
    createFolder,
    upsertVisibleConversations,
    moveConversation,
    filterFoldersForProvider,
    filterFoldersAcrossProviders,
    getFolderOrder
  };
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `node --test tests/*.test.js`
Expected: 所有用例 PASS(应为 30 个)。

- [ ] **Step 5: 提交**

```bash
git add storage-model.js tests/storage-model.test.js
git commit -m "$(cat <<'EOF'
feat(model): add filterFoldersAcrossProviders for multi-provider rendering

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Gemini 内容脚本

**Files:**
- Create: `content-gemini.js`
- Create: `tests/content-gemini.test.js`

- [ ] **Step 1: 写失败测试 — 关键 selector 与上下文失效保护**

新建 `tests/content-gemini.test.js`,内容:

```javascript
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function readSource() {
  return fs.readFileSync(path.join(__dirname, "../content-gemini.js"), "utf8");
}

test("gemini content script declares gemini provider", () => {
  assert.match(readSource(), /const PROVIDER = "gemini";/);
});

test("gemini content script targets gemini sidebar selectors", () => {
  const source = readSource();

  assert.match(source, /gem-open-account-menu/);
  assert.match(source, /mavatar-user-name/);
  assert.match(source, /data-test-id="all-conversations"/);
  assert.match(source, /a\[href\^="\/app\/"\]/);
  assert.match(source, /bard-sidenav/);
});

test("gemini content script does not scan whole page text for account email", () => {
  assert.doesNotMatch(readSource(), /document\.body\.innerText/);
});

test("gemini content script scrapes before hiding native sidebar", () => {
  const source = readSource();
  const functionStart = source.indexOf("function sendVisibleHistory() {");
  assert.notEqual(functionStart, -1);
  const functionEnd = source.indexOf("\n}", functionStart);
  const body = source.slice(functionStart, functionEnd);
  assert.ok(body.indexOf("scrapeAccount()") < body.indexOf("hideNativeSidebar()"));
  assert.ok(body.indexOf("scrapeVisibleHistory()") < body.indexOf("hideNativeSidebar()"));
});

test("gemini content script ignores invalidated extension context while syncing", () => {
  const source = readSource();
  const listeners = {};
  const documentElement = { appendChild() {} };
  const context = {
    chrome: {
      runtime: {
        sendMessage() {
          throw new Error("Extension context invalidated.");
        }
      }
    },
    clearTimeout() {},
    document: {
      readyState: "complete",
      documentElement,
      hidden: false,
      addEventListener(type, listener) {
        listeners[`document:${type}`] = listener;
      },
      createElement() { return {}; },
      getElementById() { return null; },
      querySelector() { return null; },
      querySelectorAll() { return []; }
    },
    location: { origin: "https://gemini.google.com" },
    MutationObserver: class { observe() {} },
    setTimeout(listener) { listener(); return 1; },
    URL,
    window: {
      addEventListener(type, listener) {
        listeners[`window:${type}`] = listener;
      }
    }
  };

  assert.doesNotThrow(() => vm.runInNewContext(source, context));
  assert.doesNotThrow(() => listeners["window:focus"]());
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `node --test tests/content-gemini.test.js`
Expected: 全部 FAIL,提示 `ENOENT: ../content-gemini.js`。

- [ ] **Step 3: 创建 `content-gemini.js`**

```javascript
const PROVIDER = "gemini";
const HISTORY_LINK_SELECTOR = 'a[href^="/app/"], a[href^="https://gemini.google.com/app/"]';
const ACCOUNT_SELECTORS = [
  'a[gem-open-account-menu]',
  'a[aria-label*="Google 账号"]',
  'a[aria-label*="Google Account"]'
];
let syncTimer = 0;

function extractEmail(text) {
  const match = String(text || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : "";
}

function normalizeAccountName(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/^Google\s*(?:账号|账户|Account)\s*[:：]?\s*/i, "")
    .replace(/\s*\([^)]*@[^)]*\)\s*$/, "")
    .trim();
}

function scrapeAccount() {
  for (const selector of ACCOUNT_SELECTORS) {
    for (const element of document.querySelectorAll(selector)) {
      const rawText = `${element.getAttribute("aria-label") || ""} ${element.textContent || ""}`;
      const email = extractEmail(rawText);
      if (email) {
        return email;
      }

      const displayName = String(element.querySelector(".mavatar-user-name")?.textContent || "").replace(/\s+/g, " ").trim();
      if (displayName) {
        return displayName;
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
  const historyRoot = document.querySelector('conversations-list[data-test-id="all-conversations"]');
  const sourceRoot = historyRoot || document;

  sourceRoot.querySelectorAll(HISTORY_LINK_SELECTOR).forEach((link) => {
    if (!historyRoot && !isVisible(link)) {
      return;
    }

    const url = normalizeHistoryUrl(link.getAttribute("href"));
    if (!url || seen.has(url)) {
      return;
    }

    seen.add(url);
    const title = pickTitle(link);
    records.push({ title, url });
  });

  return records;
}

function pickTitle(link) {
  const aria = link.getAttribute("aria-label");
  if (aria && aria.trim()) {
    return normalizeTitle(aria);
  }

  const titleNode = link.querySelector(".title-text");
  return normalizeTitle(titleNode ? titleNode.textContent : link.textContent);
}

function normalizeHistoryUrl(href) {
  try {
    const url = new URL(href, location.origin);
    if (!url.pathname.startsWith("/app/")) {
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
  if (document.getElementById("llmnav-hide-gemini-sidebar")) {
    return;
  }

  const style = document.createElement("style");
  style.id = "llmnav-hide-gemini-sidebar";
  style.textContent = `
    bard-sidenav {
      display: none !important;
    }
  `;
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
        provider: PROVIDER,
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
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `node --test tests/content-gemini.test.js`
Expected: 5 个用例全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add content-gemini.js tests/content-gemini.test.js
git commit -m "$(cat <<'EOF'
feat: add gemini content script for sidebar account and history sync

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: manifest 注册 Gemini

**Files:**
- Modify: `manifest.json`
- Test: `tests/manifest.test.js`

- [ ] **Step 1: 写失败测试 — manifest 含 Gemini host 与 content_script**

在 `tests/manifest.test.js` 末尾追加:

```javascript
test("manifest injects Gemini content script", () => {
  const manifest = readManifest();
  const geminiScript = manifest.content_scripts.find((script) => script.js.includes("content-gemini.js"));

  assert.ok(manifest.host_permissions.includes("https://gemini.google.com/*"));
  assert.ok(geminiScript, "gemini content script entry missing");
  assert.ok(geminiScript.matches.includes("https://gemini.google.com/*"));
  assert.equal(geminiScript.run_at, "document_idle");
});

test("manifest description mentions both ChatGPT and Gemini", () => {
  const manifest = readManifest();
  assert.match(manifest.description, /ChatGPT/);
  assert.match(manifest.description, /Gemini/);
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `node --test --test-name-pattern "Gemini" tests/manifest.test.js`
Expected: 2 个用例 FAIL。

- [ ] **Step 3: 更新 `manifest.json`**

完整替换为:

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
      "js": ["content-chatgpt.js"],
      "run_at": "document_idle"
    },
    {
      "matches": ["https://gemini.google.com/*"],
      "js": ["content-gemini.js"],
      "run_at": "document_idle"
    }
  ]
}
```

- [ ] **Step 4: 运行所有测试,确认通过**

Run: `node --test tests/*.test.js`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add manifest.json tests/manifest.test.js
git commit -m "$(cat <<'EOF'
feat(manifest): register gemini content script and host permission

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: background 多 provider 路由

**Files:**
- Modify: `background.js`
- Test: `tests/manifest.test.js`(沿用现有 background 静态断言文件)

- [ ] **Step 1: 写失败测试 — background 表驱动**

在 `tests/manifest.test.js` 末尾追加:

```javascript
test("background routes any registered provider via PROVIDER_CONFIGS", () => {
  const source = fs.readFileSync(path.join(__dirname, "../background.js"), "utf8");

  assert.match(source, /const PROVIDER_CONFIGS\s*=\s*\{/);
  assert.match(source, /chatgpt:\s*\{\s*origins:\s*\[\s*"https:\/\/chatgpt\.com"\s*,\s*"https:\/\/chat\.openai\.com"\s*\]\s*\}/);
  assert.match(source, /gemini:\s*\{\s*origins:\s*\[\s*"https:\/\/gemini\.google\.com"\s*\]\s*\}/);
  assert.doesNotMatch(source, /message\.provider === "chatgpt"/);
  assert.doesNotMatch(source, /isChatGPTUrl\(/);
});

test("background defaults gemini page state to unknown before content sync", () => {
  const source = fs.readFileSync(path.join(__dirname, "../background.js"), "utf8");

  assert.match(source, /provider:\s*providerName/);
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `node --test --test-name-pattern "PROVIDER_CONFIGS|gemini page state" tests/manifest.test.js`
Expected: FAIL(`isChatGPTUrl` 仍存在,且无 `PROVIDER_CONFIGS`)。

- [ ] **Step 3: 重写 `background.js`**

完整替换为:

```javascript
importScripts("storage-model.js");

const PROVIDER_CONFIGS = {
  chatgpt: { origins: ["https://chatgpt.com", "https://chat.openai.com"] },
  gemini:  { origins: ["https://gemini.google.com"] }
};
const providerState = {};

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
  if (message && message.type === "llmnav:visibleHistory" && message.provider in PROVIDER_CONFIGS) {
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
    for (const [name, config] of Object.entries(PROVIDER_CONFIGS)) {
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

- [ ] **Step 4: 运行所有测试,确认通过**

Run: `node --test tests/*.test.js`
Expected: 全部 PASS。原先 "background defaults ChatGPT page state to unknown" 仍通过(`provider: providerName` 在 chatgpt 分支下渲染为字面量 `"chatgpt"` 的情况已被原断言中 `provider: "chatgpt"` 覆盖——若被严格匹配失败,则同步把旧断言中的 `provider: "chatgpt"` 替换为 `provider: providerName` 后再跑)。

- [ ] **Step 5: 若旧 chatgpt 静态断言被新结构破坏,同步更新**

如果 `background defaults ChatGPT page state to unknown before content sync` 用例失败,把它改写为对 `pageStateFromTab` 通用分支的断言:

```javascript
test("background defaults page state to unknown before content sync", () => {
  const source = fs.readFileSync(path.join(__dirname, "../background.js"), "utf8");

  assert.match(source, /if \(!state\) \{[\s\S]*?supported: true,[\s\S]*?provider: providerName,[\s\S]*?hasAccount: false,[\s\S]*?account: "",[\s\S]*?hasHistory: false/);
});
```

并删除原同名 ChatGPT 专用断言。再跑 `node --test tests/*.test.js` 确认全部 PASS。

- [ ] **Step 6: 提交**

```bash
git add background.js tests/manifest.test.js
git commit -m "$(cat <<'EOF'
feat(background): route any registered provider via PROVIDER_CONFIGS

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: sidepanel HTML 与徽标样式

**Files:**
- Modify: `sidepanel.html`
- Modify: `sidepanel.css`
- Test: `tests/sidepanel-static.test.js`

- [ ] **Step 1: 写失败测试 — 双按钮与徽标样式**

在 `tests/sidepanel-static.test.js` 末尾追加:

```javascript
test("sidepanel html exposes per-provider new chat buttons", () => {
  const html = readFile("sidepanel.html");

  assert.match(html, /id="new-chatgpt"/);
  assert.match(html, /id="new-gemini"/);
  assert.doesNotMatch(html, /id="new-chat"/);
});

test("sidepanel css defines provider badges with brand colors", () => {
  const css = readFile("sidepanel.css");

  assert.match(css, /\.conversation-badge\s*\{[\s\S]*border-radius:\s*9999px;[\s\S]*\}/);
  assert.match(css, /\.badge-chatgpt\s*\{[\s\S]*background:\s*#10a37f;[\s\S]*\}/);
  assert.match(css, /\.badge-gemini\s*\{[\s\S]*background:\s*#4285f4;[\s\S]*\}/);
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `node --test --test-name-pattern "per-provider new chat buttons|provider badges" tests/sidepanel-static.test.js`
Expected: 2 个用例 FAIL。

- [ ] **Step 3: 更新 `sidepanel.html`**

把第 10-17 行整段:

```html
      <section class="actions" aria-label="快捷操作">
        <button id="new-chat" type="button">发起新对话</button>
        <button id="show-folder-form" type="button">新建目录</button>
        <form id="folder-form" class="folder-form hidden" autocomplete="off">
          <input id="folder-name" name="folderName" type="text" maxlength="40" placeholder="目录名称" aria-label="目录名称">
          <button type="submit">创建</button>
        </form>
      </section>
```

替换为:

```html
      <section class="actions" aria-label="快捷操作">
        <button id="new-chatgpt" type="button">新建 ChatGPT 对话</button>
        <button id="new-gemini" type="button">新建 Gemini 对话</button>
        <button id="show-folder-form" type="button">新建目录</button>
        <form id="folder-form" class="folder-form hidden" autocomplete="off">
          <input id="folder-name" name="folderName" type="text" maxlength="40" placeholder="目录名称" aria-label="目录名称">
          <button type="submit">创建</button>
        </form>
      </section>
```

- [ ] **Step 4: 在 `sidepanel.css` 末尾追加徽标样式**

```css
.conversation-badge {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border-radius: 9999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  font-size: 11px;
  font-weight: 500;
  line-height: 1;
  align-self: center;
}

.badge-chatgpt {
  background: #10a37f;
}

.badge-gemini {
  background: #4285f4;
}
```

- [ ] **Step 5: 运行所有测试,确认通过**

Run: `node --test tests/*.test.js`
Expected: 全部 PASS(`sidepanel.js` 还在引用 `#new-chat` 的话,后面 Task 6 才修;此处只断言 HTML 与 CSS)。如果有其它静态断言因 HTML/CSS 改动而失败,先记下,在 Task 6 修。

- [ ] **Step 6: 提交**

```bash
git add sidepanel.html sidepanel.css tests/sidepanel-static.test.js
git commit -m "$(cat <<'EOF'
feat(sidepanel): split new-chat into per-provider buttons and add provider badges

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: sidepanel.js 跨 provider 渲染

**Files:**
- Modify: `sidepanel.js`
- Test: `tests/sidepanel-static.test.js`

- [ ] **Step 1: 写失败测试 — 跨 provider 渲染、双按钮绑定、徽标**

在 `tests/sidepanel-static.test.js` 末尾追加:

```javascript
test("sidepanel script binds both new chat buttons and uses filterFoldersAcrossProviders", () => {
  const script = readFile("sidepanel.js");

  assert.match(script, /byId\("new-chatgpt"\)\.addEventListener/);
  assert.match(script, /byId\("new-gemini"\)\.addEventListener/);
  assert.match(script, /https:\/\/chatgpt\.com\//);
  assert.match(script, /https:\/\/gemini\.google\.com\/app/);
  assert.match(script, /filterFoldersAcrossProviders/);
  assert.doesNotMatch(script, /const PROVIDER = "chatgpt";/);
});

test("sidepanel script renders provider badge for each conversation", () => {
  const script = readFile("sidepanel.js");

  assert.match(script, /class="conversation-badge/);
  assert.match(script, /badge-chatgpt/);
  assert.match(script, /badge-gemini/);
});

test("sidepanel renders mixed-provider records under one folder", async () => {
  const source = readFile("sidepanel.js");
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
    const node = {
      tagName: tagName || "div",
      className: "",
      children: [],
      classList: {
        add() {},
        remove() {}
      },
      dataset: {},
      addEventListener() {},
      append(...nodes) { this.children.push(...nodes); },
      appendChild(child) { this.children.push(child); return child; },
      focus() {},
      replaceChildren(...nodes) { this.children = [...nodes]; }
    };
    return node;
  }

  const elements = {
    "new-chatgpt": createElement("button"),
    "new-gemini":  createElement("button"),
    "show-folder-form": createElement("button"),
    "folder-form":      createElement("form"),
    "folder-name":      createElement("input"),
    folders: createElement("section"),
    notice:  createElement("p")
  };

  const context = {
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
        if (type === "DOMContentLoaded") {
          domContentLoadedListener = listener;
        }
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

  const badges = conversationList.children.map((row) => {
    const badge = row.children.find((node) => typeof node.className === "string" && node.className.includes("conversation-badge"));
    return badge ? badge.className : "";
  });

  assert.ok(badges[0].includes("badge-chatgpt"));
  assert.ok(badges[1].includes("badge-gemini"));
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `node --test --test-name-pattern "binds both new chat buttons|provider badge for each conversation|mixed-provider records" tests/sidepanel-static.test.js`
Expected: FAIL。

- [ ] **Step 3: 重写 `sidepanel.js`**

完整替换为:

```javascript
const PROVIDER_NEW_CHAT_URLS = {
  chatgpt: "https://chatgpt.com/",
  gemini:  "https://gemini.google.com/app"
};
const PROVIDER_BADGES = {
  chatgpt: { letter: "C", className: "badge-chatgpt" },
  gemini:  { letter: "G", className: "badge-gemini" }
};
const PROVIDER_LABELS = {
  chatgpt: "ChatGPT",
  gemini:  "Gemini"
};
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

document.addEventListener("DOMContentLoaded", init);

async function init() {
  byId("new-chatgpt").addEventListener("click", () => openUrl(PROVIDER_NEW_CHAT_URLS.chatgpt));
  byId("new-gemini").addEventListener("click", () => openUrl(PROVIDER_NEW_CHAT_URLS.gemini));
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
    showNotice("当前页面不是支持的 LLM 页面。打开 ChatGPT 或 Gemini 后可同步可见历史。");
    return;
  }

  const providerLabel = PROVIDER_LABELS[pageState.provider] || pageState.provider;
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

  const badge = document.createElement("span");
  const badgeConfig = PROVIDER_BADGES[record.provider] || { letter: "?", className: "" };
  badge.className = `conversation-badge ${badgeConfig.className}`.trim();
  badge.textContent = badgeConfig.letter;

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

- [ ] **Step 4: 同步更新原 sidepanel 旧静态断言**

在 `tests/sidepanel-static.test.js` 第一个 test(`sidepanel script includes folder creation, drag move, and tab navigation`)中,把对 `byId("new-chat")` 与 `NEW_CHAT_URL` 的断言改为新结构。检查该用例当前内容,若包含 `new-chat`、`NEW_CHAT_URL`、`PROVIDER` 等已被移除的标识,把它们替换为:

```javascript
  assert.match(script, /byId\("new-chatgpt"\)\.addEventListener/);
  assert.match(script, /byId\("new-gemini"\)\.addEventListener/);
  assert.match(script, /document\.addEventListener\("DOMContentLoaded", init\)/);
  assert.match(script, /chrome\.runtime\.onMessage\.addListener/);
  assert.match(script, /chrome\.storage\.onChanged\.addListener/);
  assert.match(script, /event\.dataTransfer\.setData/);
  assert.match(script, /provider: record\.provider/);
  assert.match(script, /account: record\.account/);
  assert.match(script, /moveConversation\(state, data\.provider, data\.url, targetFolder, data\.account\)/);
```

(保留所有该 test 中不涉及已删除标识的断言。)

- [ ] **Step 5: 运行所有测试,确认通过**

Run: `node --test tests/*.test.js`
Expected: 全部 PASS。

- [ ] **Step 6: 在 Chrome 中手动验证(可选,如果本机能跑插件)**

1. 打开 `chrome://extensions/`,重新加载本扩展。
2. 打开 `https://chatgpt.com/`,等待对话列表出现,确认侧栏被隐藏、Side Panel 中出现 ChatGPT 对话(带绿色 C 徽标)。
3. 打开 `https://gemini.google.com/app`,等待对话列表出现,确认 `bard-sidenav` 被隐藏、Side Panel 中追加 Gemini 对话(带蓝色 G 徽标)。
4. 顶部点击「新建 Gemini 对话」,当前页面应跳到 `https://gemini.google.com/app`。
5. 把一个 Gemini 对话拖到自定义目录,刷新 Side Panel,确认仍在该目录内,徽标仍是 G。

(此步骤不阻塞 commit,仅在本地环境可用时执行;在 PR 描述中注明结果。)

- [ ] **Step 7: 提交**

```bash
git add sidepanel.js tests/sidepanel-static.test.js
git commit -m "$(cat <<'EOF'
feat(sidepanel): render mixed-provider conversations with per-provider new-chat buttons

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## 完成态检查

跑一次全量测试:

```bash
node --test tests/*.test.js
```

期望:全部 PASS,新增用例计数应为原 27 + Task1 新增 3 + Task2 新增 5 + Task3 新增 2 + Task4 新增 2(其中可能合并 1 个旧用例) + Task5 新增 2 + Task6 新增 3,合计约 42-44 个。

git log 应出现 6 个 feat/feat(...) commit,主题分别覆盖 model、content-gemini、manifest、background、sidepanel HTML/CSS、sidepanel JS。
