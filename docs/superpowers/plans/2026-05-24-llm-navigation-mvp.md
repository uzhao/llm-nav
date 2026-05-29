# LLM Navigation MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个 Manifest V3 Chrome 扩展，完成 ChatGPT 可见历史同步、本地单层目录分类、Side Panel 跳转和账号隔离。

**Architecture:** 扩展由一个后台 service worker、一个 ChatGPT content script、一个原生 side panel 和一个可测试的纯 JavaScript 存储模型组成。content script 只负责抓取 ChatGPT 当前已渲染的可见历史并隐藏原厂左栏；background 接收同步消息并写入 `chrome.storage.local`；side panel 只依赖统一存储结构和当前页面状态渲染 UI。

**Tech Stack:** Chrome Extension Manifest V3、Chrome Side Panel API、`chrome.storage.local`、原生 HTML/CSS/JavaScript、Node 内置 `node:test`。

---

## 文件结构

- Create: `storage-model.js` — 纯数据模型，负责目录初始化、同步去重、账号过滤、新建目录和移动对话；可在 Node 测试与扩展运行时复用。
- Create: `tests/storage-model.test.js` — 使用 Node 内置测试覆盖存储规则和账号规则。
- Create: `manifest.json` — 声明 MV3、side panel、storage/tabs/activeTab 权限、ChatGPT host permission 和 ChatGPT content script。
- Create: `tests/manifest.test.js` — 静态验证 manifest 中的关键配置。
- Create: `background.js` — 启用 side panel，维护当前页面状态，接收 content script 消息并写入 storage。
- Create: `content-chatgpt.js` — 抓取 ChatGPT 可见历史和账号，注入 CSS 隐藏 ChatGPT 原厂左栏，向 background 发送统一记录。
- Create: `sidepanel.html` — 极简 side panel 结构，不显示插件大标题或账号邮箱。
- Create: `sidepanel.css` — Gemini 左栏风格的轻量布局、目录行、对话行和拖拽状态。
- Create: `sidepanel.js` — 渲染目录和对话，处理新建目录、展开/收起、拖拽移动和当前标签页跳转。
- Create: `tests/sidepanel-static.test.js` — 静态验证 side panel 的信息架构和关键交互入口。

---

### Task 1: 存储模型和同步规则

**Files:**
- Create: `storage-model.js`
- Create: `tests/storage-model.test.js`

- [ ] **Step 1: 写失败测试**

Create `tests/storage-model.test.js`:

```javascript
const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../storage-model.js");

test("initial state contains system folders", () => {
  const state = model.createInitialState();

  assert.deepEqual(Object.keys(state.folders), ["unclassified", "archived"]);
  assert.deepEqual(state.folders.unclassified, []);
  assert.deepEqual(state.folders.archived, []);
  assert.deepEqual(state.activeAccounts, {});
});

test("createFolder trims names and rejects empty or system folders", () => {
  const state = model.createInitialState();
  const withCoding = model.createFolder(state, " coding ");
  const withEmpty = model.createFolder(withCoding, "   ");
  const withSystem = model.createFolder(withEmpty, "archived");

  assert.ok(withSystem.folders.coding);
  assert.equal(Object.keys(withSystem.folders).filter((name) => name === "archived").length, 1);
  assert.equal(Object.keys(withSystem.folders).includes(""), false);
});

test("upsertVisibleConversations stores new ChatGPT records in unclassified", () => {
  const next = model.upsertVisibleConversations(model.createInitialState(), "chatgpt", "user@example.com", [
    { title: "Python 问题", url: "https://chatgpt.com/c/one" },
    { title: "JS 问题", url: "https://chatgpt.com/c/two" }
  ]);

  assert.equal(next.activeAccounts.chatgpt, "user@example.com");
  assert.deepEqual(next.folders.unclassified, [
    {
      provider: "chatgpt",
      account: "user@example.com",
      title: "Python 问题",
      url: "https://chatgpt.com/c/one"
    },
    {
      provider: "chatgpt",
      account: "user@example.com",
      title: "JS 问题",
      url: "https://chatgpt.com/c/two"
    }
  ]);
});

test("upsertVisibleConversations updates title without changing folder", () => {
  const state = model.createFolder(model.createInitialState(), "coding");
  state.folders.coding.push({
    provider: "chatgpt",
    account: "user@example.com",
    title: "旧标题",
    url: "https://chatgpt.com/c/one"
  });

  const next = model.upsertVisibleConversations(state, "chatgpt", "user@example.com", [
    { title: "新标题", url: "https://chatgpt.com/c/one" }
  ]);

  assert.equal(next.folders.coding.length, 1);
  assert.equal(next.folders.coding[0].title, "新标题");
  assert.equal(next.folders.unclassified.length, 0);
});

test("upsertVisibleConversations upgrades unknown account without duplicate records", () => {
  const state = model.createInitialState();
  state.folders.unclassified.push({
    provider: "chatgpt",
    account: "unknown",
    title: "临时标题",
    url: "https://chatgpt.com/c/one"
  });

  const next = model.upsertVisibleConversations(state, "chatgpt", "user@example.com", [
    { title: "确认标题", url: "https://chatgpt.com/c/one" }
  ]);

  assert.equal(next.folders.unclassified.length, 1);
  assert.equal(next.folders.unclassified[0].account, "user@example.com");
  assert.equal(next.folders.unclassified[0].title, "确认标题");
});

test("filterFoldersForProvider filters by active account when account is known", () => {
  const state = model.createInitialState();
  state.activeAccounts.chatgpt = "a@example.com";
  state.folders.unclassified.push(
    { provider: "chatgpt", account: "a@example.com", title: "A", url: "https://chatgpt.com/c/a" },
    { provider: "chatgpt", account: "b@example.com", title: "B", url: "https://chatgpt.com/c/b" },
    { provider: "gemini", account: "a@example.com", title: "G", url: "https://gemini.google.com/app/g" }
  );

  const visible = model.filterFoldersForProvider(state, "chatgpt", { hasAccount: true, account: "a@example.com" });

  assert.deepEqual(visible.unclassified.map((record) => record.title), ["A"]);
});

test("filterFoldersForProvider shows all provider records when account is unknown", () => {
  const state = model.createInitialState();
  state.activeAccounts.chatgpt = "a@example.com";
  state.folders.unclassified.push(
    { provider: "chatgpt", account: "a@example.com", title: "A", url: "https://chatgpt.com/c/a" },
    { provider: "chatgpt", account: "b@example.com", title: "B", url: "https://chatgpt.com/c/b" },
    { provider: "gemini", account: "a@example.com", title: "G", url: "https://gemini.google.com/app/g" }
  );

  const visible = model.filterFoldersForProvider(state, "chatgpt", { hasAccount: false, account: "" });

  assert.deepEqual(visible.unclassified.map((record) => record.title), ["A", "B"]);
});

test("moveConversation moves a record from its current folder to target folder", () => {
  const state = model.createFolder(model.createInitialState(), "coding");
  state.folders.unclassified.push({
    provider: "chatgpt",
    account: "user@example.com",
    title: "Python 问题",
    url: "https://chatgpt.com/c/one"
  });

  const next = model.moveConversation(state, "chatgpt", "https://chatgpt.com/c/one", "coding");

  assert.equal(next.folders.unclassified.length, 0);
  assert.deepEqual(next.folders.coding.map((record) => record.url), ["https://chatgpt.com/c/one"]);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
node --test tests/storage-model.test.js
```

Expected: FAIL，错误包含 `Cannot find module '../storage-model.js'`。

- [ ] **Step 3: 实现最小存储模型**

Create `storage-model.js`:

```javascript
(function (root, factory) {
  const api = factory();

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  root.LLMNavModel = api;
})(typeof globalThis !== "undefined" ? globalThis : self, function () {
  const UNKNOWN_ACCOUNT = "unknown";
  const SYSTEM_FOLDERS = ["unclassified", "archived"];

  function createInitialState() {
    return {
      folders: {
        unclassified: [],
        archived: []
      },
      activeAccounts: {}
    };
  }

  function normalizeAccount(account) {
    const value = String(account || "").trim();
    return value || UNKNOWN_ACCOUNT;
  }

  function normalizeTitle(title) {
    const value = String(title || "").replace(/\s+/g, " ").trim();
    return value || "未命名对话";
  }

  function normalizeUrl(url) {
    return String(url || "").trim();
  }

  function cloneState(state) {
    const input = state || {};
    const sourceFolders = input.folders || {};
    const folders = {};

    Object.keys(sourceFolders).forEach((folderName) => {
      folders[folderName] = Array.isArray(sourceFolders[folderName])
        ? sourceFolders[folderName].map((record) => ({
            provider: record.provider,
            account: normalizeAccount(record.account),
            title: normalizeTitle(record.title),
            url: normalizeUrl(record.url)
          }))
        : [];
    });

    SYSTEM_FOLDERS.forEach((folderName) => {
      if (!Array.isArray(folders[folderName])) {
        folders[folderName] = [];
      }
    });

    return {
      folders,
      activeAccounts: { ...(input.activeAccounts || {}) }
    };
  }

  function normalizeRecord(record, provider, account) {
    return {
      provider,
      account: normalizeAccount(account),
      title: normalizeTitle(record.title),
      url: normalizeUrl(record.url)
    };
  }

  function isSystemFolder(folderName) {
    return SYSTEM_FOLDERS.includes(folderName);
  }

  function findRecordLocation(state, provider, url, account) {
    const normalizedUrl = normalizeUrl(url);
    const normalizedAccount = normalizeAccount(account);

    for (const [folderName, records] of Object.entries(state.folders)) {
      const index = records.findIndex((record) => record.provider === provider && record.url === normalizedUrl && normalizeAccount(record.account) === normalizedAccount);
      if (index !== -1) {
        return { folderName, index };
      }
    }

    if (normalizedAccount !== UNKNOWN_ACCOUNT) {
      for (const [folderName, records] of Object.entries(state.folders)) {
        const index = records.findIndex((record) => record.provider === provider && record.url === normalizedUrl && normalizeAccount(record.account) === UNKNOWN_ACCOUNT);
        if (index !== -1) {
          return { folderName, index };
        }
      }
    }

    for (const [folderName, records] of Object.entries(state.folders)) {
      const index = records.findIndex((record) => record.provider === provider && record.url === normalizedUrl);
      if (index !== -1) {
        return { folderName, index };
      }
    }

    return null;
  }

  function upsertVisibleConversations(state, provider, account, records) {
    const next = cloneState(state);
    const normalizedAccount = normalizeAccount(account);

    if (normalizedAccount !== UNKNOWN_ACCOUNT) {
      next.activeAccounts[provider] = normalizedAccount;
    }

    records.forEach((record) => {
      const normalized = normalizeRecord(record, provider, normalizedAccount);
      if (!normalized.url) {
        return;
      }

      const location = findRecordLocation(next, provider, normalized.url, normalized.account);
      if (!location) {
        next.folders.unclassified.push(normalized);
        return;
      }

      const existing = next.folders[location.folderName][location.index];
      const existingAccount = normalizeAccount(existing.account);
      next.folders[location.folderName][location.index] = {
        provider,
        account: existingAccount === UNKNOWN_ACCOUNT && normalized.account !== UNKNOWN_ACCOUNT ? normalized.account : existingAccount,
        title: normalized.title,
        url: normalized.url
      };
    });

    return next;
  }

  function createFolder(state, rawName) {
    const folderName = String(rawName || "").trim();
    const next = cloneState(state);

    if (!folderName || isSystemFolder(folderName) || next.folders[folderName]) {
      return next;
    }

    next.folders[folderName] = [];
    return next;
  }

  function moveConversation(state, provider, url, targetFolder) {
    const next = cloneState(state);
    const normalizedUrl = normalizeUrl(url);

    if (!next.folders[targetFolder]) {
      return next;
    }

    let movedRecord = null;

    for (const folderName of Object.keys(next.folders)) {
      const index = next.folders[folderName].findIndex((record) => record.provider === provider && record.url === normalizedUrl);
      if (index !== -1) {
        const removed = next.folders[folderName].splice(index, 1);
        movedRecord = removed[0];
        break;
      }
    }

    if (movedRecord) {
      next.folders[targetFolder].push(movedRecord);
    }

    return next;
  }

  function filterFoldersForProvider(state, provider, accountStatus) {
    const next = cloneState(state);
    const activeAccount = normalizeAccount((accountStatus && accountStatus.account) || next.activeAccounts[provider]);
    const shouldFilterByAccount = !(accountStatus && accountStatus.hasAccount === false) && activeAccount !== UNKNOWN_ACCOUNT;
    const filtered = {};

    Object.entries(next.folders).forEach(([folderName, records]) => {
      filtered[folderName] = records.filter((record) => {
        if (record.provider !== provider) {
          return false;
        }

        if (!shouldFilterByAccount) {
          return true;
        }

        return normalizeAccount(record.account) === activeAccount;
      });
    });

    return filtered;
  }

  function getFolderOrder(folders) {
    const names = Object.keys(folders);
    const customFolders = names.filter((name) => !isSystemFolder(name)).sort((left, right) => left.localeCompare(right));
    return ["unclassified", ...customFolders, "archived"].filter((name) => names.includes(name));
  }

  return {
    UNKNOWN_ACCOUNT,
    SYSTEM_FOLDERS,
    createInitialState,
    cloneState,
    createFolder,
    upsertVisibleConversations,
    moveConversation,
    filterFoldersForProvider,
    getFolderOrder
  };
});
```

- [ ] **Step 4: 运行测试并确认通过**

Run:

```bash
node --test tests/storage-model.test.js
```

Expected: PASS，8 个子测试全部通过。

- [ ] **Step 5: 提交本任务**

```bash
git add storage-model.js tests/storage-model.test.js
git commit -m "feat: add storage model"
```

---

### Task 2: MV3 骨架和 Side Panel 外壳

**Files:**
- Create: `manifest.json`
- Create: `background.js`
- Create: `sidepanel.html`
- Create: `sidepanel.css`
- Create: `sidepanel.js`
- Create: `tests/manifest.test.js`

- [ ] **Step 1: 写 manifest 失败测试**

Create `tests/manifest.test.js`:

```javascript
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function readManifest() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "../manifest.json"), "utf8"));
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
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
node --test tests/manifest.test.js
```

Expected: FAIL，错误包含 `ENOENT` 和 `manifest.json`。

- [ ] **Step 3: 创建 MV3 外壳文件**

Create `manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "LLM Navigation",
  "version": "0.1.0",
  "description": "本地管理 ChatGPT 对话入口。",
  "permissions": ["sidePanel", "storage", "tabs", "activeTab"],
  "background": {
    "service_worker": "background.js"
  },
  "side_panel": {
    "default_path": "sidepanel.html"
  },
  "action": {
    "default_title": "LLM Navigation"
  }
}
```

Create `background.js`:

```javascript
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});
```

Create `sidepanel.html`:

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
      <section class="actions" aria-label="快捷操作">
        <button id="new-chat" type="button">发起新对话</button>
        <button id="show-folder-form" type="button">新建目录</button>
      </section>
      <p id="notice" class="notice">打开 ChatGPT 页面后会同步可见历史。</p>
      <section id="folders" class="folders" aria-label="对话目录"></section>
    </main>
    <script src="sidepanel.js"></script>
  </body>
</html>
```

Create `sidepanel.css`:

```css
:root {
  color-scheme: light;
  font-family: Arial, "Microsoft YaHei", sans-serif;
  font-size: 14px;
}

body {
  margin: 0;
  background: #f8fafd;
  color: #1f1f1f;
}

button,
input {
  font: inherit;
}

.panel {
  box-sizing: border-box;
  min-height: 100vh;
  padding: 12px;
}

.actions {
  display: grid;
  gap: 8px;
  margin-bottom: 12px;
}

.actions button {
  width: 100%;
  border: 0;
  border-radius: 18px;
  background: #eef3fd;
  color: #1a3d7c;
  cursor: pointer;
  padding: 9px 12px;
  text-align: left;
}

.notice {
  margin: 8px 0 12px;
  border-radius: 12px;
  background: #fff7e0;
  color: #5f4700;
  padding: 8px 10px;
  line-height: 1.5;
}

.folders {
  display: grid;
  gap: 4px;
}
```

Create `sidepanel.js`:

```javascript
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("new-chat").addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (tab && tab.id) {
        chrome.tabs.update(tab.id, { url: "https://chatgpt.com/" });
      }
    });
  });
});
```

- [ ] **Step 4: 运行 manifest 测试并确认通过**

Run:

```bash
node --test tests/manifest.test.js
```

Expected: PASS。

- [ ] **Step 5: 手动加载扩展外壳**

Run: 在 Chrome 打开扩展管理页，启用开发者模式，选择项目根目录 `/home/papillon/projects/llm_nav` 作为 unpacked extension。

Expected:
- 扩展可以加载，没有 manifest 错误。
- 点击扩展图标后可以打开 side panel。
- side panel 只显示两行顶部操作和一条轻提示，不显示账号邮箱或插件大标题。

- [ ] **Step 6: 提交本任务**

```bash
git add manifest.json background.js sidepanel.html sidepanel.css sidepanel.js tests/manifest.test.js
git commit -m "feat: add extension shell"
```

---

### Task 3: ChatGPT 内容脚本和后台同步

**Files:**
- Modify: `manifest.json`
- Modify: `tests/manifest.test.js`
- Modify: `background.js`
- Create: `content-chatgpt.js`

- [ ] **Step 1: 扩展 manifest 测试覆盖 ChatGPT content script**

Replace `tests/manifest.test.js`:

```javascript
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function readManifest() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "../manifest.json"), "utf8"));
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

test("manifest injects ChatGPT content script", () => {
  const manifest = readManifest();
  const chatgptScript = manifest.content_scripts.find((script) => script.js.includes("content-chatgpt.js"));

  assert.ok(manifest.host_permissions.includes("https://chatgpt.com/*"));
  assert.ok(manifest.host_permissions.includes("https://chat.openai.com/*"));
  assert.ok(chatgptScript.matches.includes("https://chatgpt.com/*"));
  assert.ok(chatgptScript.matches.includes("https://chat.openai.com/*"));
  assert.equal(chatgptScript.run_at, "document_idle");
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
node --test tests/manifest.test.js
```

Expected: FAIL，错误指向 `host_permissions` 或 `content_scripts` 未配置。

- [ ] **Step 3: 更新 manifest 声明 ChatGPT 注入**

Replace `manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "LLM Navigation",
  "version": "0.1.0",
  "description": "本地管理 ChatGPT 对话入口。",
  "permissions": ["sidePanel", "storage", "tabs", "activeTab"],
  "host_permissions": ["https://chatgpt.com/*", "https://chat.openai.com/*"],
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
    }
  ]
}
```

- [ ] **Step 4: 实现后台同步入口**

Replace `background.js`:

```javascript
importScripts("storage-model.js");

const CHATGPT_ORIGINS = ["https://chatgpt.com", "https://chat.openai.com"];
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
  if (message && message.type === "llmnav:visibleHistory" && message.provider === "chatgpt") {
    handleVisibleHistory(message).then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message && message.type === "llmnav:getPageState") {
    getCurrentPageState().then((state) => {
      sendResponse(state);
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
  if (!tab || !isChatGPTUrl(tab.url)) {
    return { supported: false };
  }

  const state = providerState.chatgpt || {};
  return {
    supported: true,
    provider: "chatgpt",
    hasAccount: state.hasAccount !== false,
    account: state.account || "",
    hasHistory: state.hasHistory !== false
  };
}

function isChatGPTUrl(url) {
  try {
    return CHATGPT_ORIGINS.includes(new URL(url).origin);
  } catch (error) {
    return false;
  }
}

function notify(message) {
  chrome.runtime.sendMessage(message, () => {
    void chrome.runtime.lastError;
  });
}
```

- [ ] **Step 5: 实现 ChatGPT content script**

Create `content-chatgpt.js`:

```javascript
const PROVIDER = "chatgpt";
const HISTORY_LINK_SELECTOR = 'a[href^="/c/"], a[href^="https://chatgpt.com/c/"], a[href^="https://chat.openai.com/c/"]';
const ACCOUNT_SELECTORS = [
  '[data-testid="profile-button"]',
  'button[aria-label*="account" i]',
  'button[aria-label*="profile" i]',
  '[aria-label*="@"]'
];
let syncTimer = 0;

function extractEmail(text) {
  const match = String(text || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : "";
}

function scrapeAccount() {
  for (const selector of ACCOUNT_SELECTORS) {
    const element = document.querySelector(selector);
    if (!element) {
      continue;
    }

    const email = extractEmail(`${element.getAttribute("aria-label") || ""} ${element.textContent || ""}`);
    if (email) {
      return email;
    }
  }

  return extractEmail(document.body.innerText || "");
}

function scrapeVisibleHistory() {
  const seen = new Set();
  const records = [];

  document.querySelectorAll(HISTORY_LINK_SELECTOR).forEach((link) => {
    if (!isVisible(link)) {
      return;
    }

    const url = normalizeHistoryUrl(link.getAttribute("href"));
    if (!url || seen.has(url)) {
      return;
    }

    seen.add(url);
    records.push({
      title: normalizeTitle(link.textContent),
      url
    });
  });

  return records;
}

function normalizeHistoryUrl(href) {
  try {
    const url = new URL(href, location.origin);
    if (!url.pathname.startsWith("/c/")) {
      return "";
    }

    url.hash = "";
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
  if (document.getElementById("llmnav-hide-chatgpt-sidebar")) {
    return;
  }

  const style = document.createElement("style");
  style.id = "llmnav-hide-chatgpt-sidebar";
  style.textContent = `
    nav[aria-label="Chat history"],
    nav[aria-label="聊天记录"],
    aside:has(a[href^="/c/"]),
    #history {
      display: none !important;
    }
  `;
  document.documentElement.appendChild(style);
}

function sendVisibleHistory() {
  hideNativeSidebar();
  chrome.runtime.sendMessage(
    {
      type: "llmnav:visibleHistory",
      provider: PROVIDER,
      account: scrapeAccount(),
      records: scrapeVisibleHistory()
    },
    () => {
      void chrome.runtime.lastError;
    }
  );
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

- [ ] **Step 6: 运行自动测试**

Run:

```bash
node --test tests/storage-model.test.js tests/manifest.test.js
```

Expected: PASS，存储模型测试和 manifest 测试全部通过。

- [ ] **Step 7: 手动验证同步入口**

Run: 重新加载 unpacked extension，打开 ChatGPT 页面，打开扩展 service worker DevTools 和当前页面 DevTools。

Expected:
- ChatGPT 页面没有 content script 运行时错误。
- service worker 没有 `importScripts` 或 storage 运行时错误。
- `chrome.storage.local.get(["folders", "activeAccounts"])` 能看到 `folders.unclassified`、`folders.archived` 和 `activeAccounts`。
- 如果页面已渲染历史链接，`folders.unclassified` 中出现 `provider: "chatgpt"`、`title`、`url`、`account` 字段。
- ChatGPT 原厂左侧栏被隐藏；如果 CSS 选择器没有匹配，storage 同步仍然成功。

- [ ] **Step 8: 提交本任务**

```bash
git add manifest.json tests/manifest.test.js background.js content-chatgpt.js
git commit -m "feat: sync visible chatgpt history"
```

---

### Task 4: Side Panel 目录 UI、跳转和拖拽移动

**Files:**
- Modify: `sidepanel.html`
- Modify: `sidepanel.css`
- Modify: `sidepanel.js`
- Create: `tests/sidepanel-static.test.js`

- [ ] **Step 1: 写 side panel 静态失败测试**

Create `tests/sidepanel-static.test.js`:

```javascript
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function readFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("sidepanel keeps minimal information architecture", () => {
  const html = readFile("sidepanel.html");

  assert.match(html, /id="new-chat"/);
  assert.match(html, /id="show-folder-form"/);
  assert.match(html, /id="folder-form"/);
  assert.match(html, /id="folders"/);
  assert.match(html, /storage-model\.js/);
  assert.equal(/<h1\b/i.test(html), false);
  assert.equal(/账号邮箱/.test(html), false);
});

test("sidepanel script includes folder creation, drag move, and tab navigation", () => {
  const script = readFile("sidepanel.js");

  assert.match(script, /createFolder/);
  assert.match(script, /dragstart/);
  assert.match(script, /drop/);
  assert.match(script, /chrome\.tabs\.update/);
  assert.match(script, /llmnav:getPageState/);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
node --test tests/sidepanel-static.test.js
```

Expected: FAIL，错误指向缺少 `folder-form` 或 `storage-model.js`。

- [ ] **Step 3: 替换 side panel HTML**

Replace `sidepanel.html`:

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
      <section class="actions" aria-label="快捷操作">
        <button id="new-chat" type="button">发起新对话</button>
        <button id="show-folder-form" type="button">新建目录</button>
        <form id="folder-form" class="folder-form hidden" autocomplete="off">
          <input id="folder-name" name="folderName" type="text" maxlength="40" placeholder="目录名称" aria-label="目录名称">
          <button type="submit">创建</button>
        </form>
      </section>
      <p id="notice" class="notice hidden"></p>
      <section id="folders" class="folders" aria-label="对话目录"></section>
    </main>
    <script src="storage-model.js"></script>
    <script src="sidepanel.js"></script>
  </body>
</html>
```

- [ ] **Step 4: 替换 side panel CSS**

Replace `sidepanel.css`:

```css
:root {
  color-scheme: light;
  font-family: Arial, "Microsoft YaHei", sans-serif;
  font-size: 14px;
}

body {
  margin: 0;
  background: #f8fafd;
  color: #1f1f1f;
}

button,
input {
  font: inherit;
}

button {
  color: inherit;
}

.panel {
  box-sizing: border-box;
  min-height: 100vh;
  padding: 12px;
}

.actions {
  display: grid;
  gap: 8px;
  margin-bottom: 12px;
}

.actions button,
.folder-form button {
  border: 0;
  border-radius: 18px;
  background: #eef3fd;
  color: #1a3d7c;
  cursor: pointer;
  padding: 9px 12px;
  text-align: left;
}

.actions button:hover,
.folder-form button:hover,
.folder-row:hover,
.conversation-row:hover {
  background: #e2ecfb;
}

.folder-form {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 6px;
}

.folder-form input {
  min-width: 0;
  border: 1px solid #d5dce8;
  border-radius: 18px;
  background: #ffffff;
  padding: 8px 10px;
}

.notice {
  margin: 8px 0 12px;
  border-radius: 12px;
  background: #fff7e0;
  color: #5f4700;
  padding: 8px 10px;
  line-height: 1.5;
}

.hidden {
  display: none !important;
}

.folders {
  display: grid;
  gap: 4px;
}

.folder {
  display: grid;
  gap: 2px;
}

.folder-row,
.conversation-row {
  width: 100%;
  border: 0;
  border-radius: 18px;
  background: transparent;
  cursor: pointer;
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  padding: 8px 10px;
  text-align: left;
}

.folder-row {
  font-weight: 600;
}

.folder.drag-over .folder-row {
  background: #d8e6fb;
  outline: 2px solid #8ab4f8;
}

.folder-label,
.conversation-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.folder-count {
  color: #5f6368;
  font-weight: 400;
}

.conversation-list {
  display: grid;
  gap: 1px;
  margin-left: 10px;
}

.conversation-row {
  color: #3c4043;
}
```

- [ ] **Step 5: 替换 side panel JavaScript**

Replace `sidepanel.js`:

```javascript
const PROVIDER = "chatgpt";
const NEW_CHAT_URL = "https://chatgpt.com/";
const FOLDER_LABELS = {
  unclassified: "未分类",
  archived: "归档"
};

let pageState = { supported: false };
let collapsedFolders = new Set(["archived"]);

function byId(id) {
  return document.getElementById(id);
}

document.addEventListener("DOMContentLoaded", init);

async function init() {
  byId("new-chat").addEventListener("click", () => openUrl(NEW_CHAT_URL));
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
  const container = byId("folders");
  container.replaceChildren();

  if (!pageState.supported) {
    showNotice("当前页面不是支持的 LLM 页面。打开 ChatGPT 后可同步可见历史。");
    return;
  }

  const state = await loadState();
  const folders = LLMNavModel.filterFoldersForProvider(state, PROVIDER, pageState);

  renderNoticeForPageState();

  LLMNavModel.getFolderOrder(folders).forEach((folderName) => {
    if (folderName === "archived" && folders[folderName].length === 0) {
      return;
    }

    container.appendChild(renderFolder(folderName, folders[folderName]));
  });
}

function renderNoticeForPageState() {
  const messages = [];

  if (pageState.hasAccount === false) {
    messages.push("无法获取 ChatGPT 账号，当前显示 ChatGPT 的全部本地对话，可能包含其他账号。");
  }

  if (pageState.hasHistory === false) {
    messages.push("未检测到可见历史，已保留已有本地数据。");
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
      url: record.url
    }));
  });

  const title = document.createElement("span");
  title.className = "conversation-title";
  title.textContent = record.title;

  row.appendChild(title);
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
  const next = LLMNavModel.moveConversation(state, data.provider, data.url, targetFolder);
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

- [ ] **Step 6: 运行自动测试**

Run:

```bash
node --test tests/storage-model.test.js tests/manifest.test.js tests/sidepanel-static.test.js
```

Expected: PASS，全部测试通过。

- [ ] **Step 7: 手动验证 side panel 交互**

Run: 重新加载 unpacked extension，打开 ChatGPT 页面并打开 side panel。

Expected:
- 顶部只显示“发起新对话”和“新建目录”。
- side panel 不显示账号邮箱和插件大标题。
- 未分类分组默认展开。
- 归档分组在没有记录时不显示。
- 点击目录行可以展开或收起。
- 点击“新建目录”后出现输入框；输入 `coding` 并创建后，目录显示出来。
- 输入空目录名、`unclassified` 或 `archived` 后，不会创建新目录。
- 拖拽一条对话到 `coding` 目录后，该对话从未分类移动到 `coding`。
- 刷新 side panel 后，目录和移动结果仍保存在 `chrome.storage.local`。
- 点击对话行后，当前标签页跳转到该记录的 URL。

- [ ] **Step 8: 提交本任务**

```bash
git add sidepanel.html sidepanel.css sidepanel.js tests/sidepanel-static.test.js
git commit -m "feat: add side panel navigation"
```

---

### Task 5: 第一版闭环验证

**Files:**
- No file changes expected.

- [ ] **Step 1: 运行全部自动测试**

Run:

```bash
node --test tests/storage-model.test.js tests/manifest.test.js tests/sidepanel-static.test.js
```

Expected: PASS，所有测试通过。

- [ ] **Step 2: 重新加载扩展**

Run: 在 Chrome 扩展管理页点击 LLM Navigation 的刷新按钮，然后打开 ChatGPT 页面。

Expected:
- 扩展重新加载成功。
- ChatGPT 标签页没有 content script 错误。
- 扩展 service worker 没有运行时错误。

- [ ] **Step 3: 验证 ChatGPT 可见历史同步**

Run: 在 ChatGPT 页面等待左侧历史列表渲染，然后打开 side panel。

Expected:
- ChatGPT 原厂左侧栏被隐藏。
- side panel 的未分类分组显示当前可见历史。
- `chrome.storage.local.get(["folders", "activeAccounts"])` 中每条记录都有 `provider: "chatgpt"`、`account`、`title`、`url`。
- 当前可见历史之外的旧本地记录不会被删除。

- [ ] **Step 4: 验证目录持久化和移动持久化**

Run: 新建目录 `coding`，把一条对话拖到 `coding`，刷新 ChatGPT 标签页，再重新打开 side panel。

Expected:
- `coding` 目录仍存在。
- 被移动的对话仍位于 `coding`。
- 未分类分组不再显示这条已移动的对话。

- [ ] **Step 5: 验证账号过滤规则**

Run: 在 DevTools 中执行以下 storage 写入，模拟两个账号的本地记录和当前账号。

```javascript
chrome.storage.local.set({
  folders: {
    unclassified: [
      { provider: "chatgpt", account: "a@example.com", title: "A", url: "https://chatgpt.com/c/a" },
      { provider: "chatgpt", account: "b@example.com", title: "B", url: "https://chatgpt.com/c/b" },
      { provider: "gemini", account: "a@example.com", title: "G", url: "https://gemini.google.com/app/g" }
    ],
    archived: []
  },
  activeAccounts: {
    chatgpt: "a@example.com"
  }
});
```

Expected:
- 当 content script 能抓到 `a@example.com` 时，side panel 只显示标题 `A`。
- 当 content script 抓不到账号时，side panel 显示账号风险提示，并显示标题 `A` 和 `B`。
- Gemini 记录不显示在 ChatGPT 第一版 side panel 中。

- [ ] **Step 6: 验证非支持页面状态**

Run: 切换到非 ChatGPT 页面并打开 side panel。

Expected:
- side panel 显示“当前页面不是支持的 LLM 页面。打开 ChatGPT 后可同步可见历史。”
- 不渲染同步状态和对话目录。

- [ ] **Step 7: 最终提交验证记录**

```bash
git status --short
git log --oneline -5
```

Expected:
- `git status --short` 没有意外的未跟踪或未提交源码文件。
- 最近提交包含本计划中 Task 1 到 Task 4 的提交。

---

## 自检结果

- 规格覆盖：Task 2 覆盖 MV3、side panel 和原生文件；Task 3 覆盖 ChatGPT 可见历史抓取、隐藏原厂左栏、统一记录和 storage 同步；Task 4 覆盖目录渲染、新建目录、展开收起、拖拽移动和跳转；Task 5 覆盖账号规则、非支持页面、刷新持久化和最终手动验证。
- 占位语扫描：计划中的每个代码步骤都给出完整文件内容或完整测试内容，没有保留未完成标记。
- 类型一致性：统一记录字段固定为 `provider`、`account`、`title`、`url`；消息类型固定为 `llmnav:visibleHistory`、`llmnav:getPageState`、`llmnav:storageUpdated`、`llmnav:pageState`；系统目录固定为 `unclassified` 和 `archived`。
