# Side Panel UI 重设计实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 side panel 顶部的 7 个独立"新建对话"按钮收成一个拆分按钮 + 用户可启用的快捷操作;加上设置浮层、目录重命名/删除、新对话置顶。

**Architecture:** 改动分两层。`storage-model.js` 增加 `renameFolder`、`deleteFolder`、`normalizeSettings`,并把 `upsertVisibleConversations` 里新记录的写入方式从 `push` 改为收集后整体 `unshift`。`sidepanel.html/css/js` 重做顶部 actions 区(齿轮 + 拆分按钮 + 快捷操作),把"新建目录"挪到目录区头部,自定义目录行加 hover 出现的 `✎/×` icon,新增覆盖整个面板的设置浮层 `#settings-modal`,改即生效写回 `chrome.storage.local.settings`。

**Tech Stack:** Chrome Extension MV3、`chrome.storage.local`、原生 HTML/CSS/JavaScript、Node 内置 `node:test` + `node:vm`。

**Spec:** [docs/superpowers/specs/2026-05-28-sidepanel-ui-redesign-design.md](../specs/2026-05-28-sidepanel-ui-redesign-design.md)

---

## 文件结构

- Modify: `storage-model.js` — 新增 `renameFolder`、`deleteFolder`、`normalizeSettings`、`createDefaultSettings`;改 `upsertVisibleConversations` 新记录顺序。
- Modify: `tests/storage-model.test.js` — 新增覆盖。
- Modify: `providers/chatgpt.js`、`providers/gemini.js`、`providers/claude.js` — 新增 `quickActions` 字段。
- Modify: `sidepanel.html` — 顶部结构、目录区头、设置浮层骨架。
- Modify: `sidepanel.css` — 拆分按钮、齿轮、快捷操作、浮层、目录 hover icon。
- Modify: `sidepanel.js` — 顶部渲染、设置浮层、目录重命名/删除、settings 监听。
- Modify: `tests/sidepanel-static.test.js` — 替换"7 个新建按钮"测试,加新结构断言。

---

### Task 1: 存储模型 — 新对话置顶

**Files:**
- Modify: `storage-model.js`
- Modify: `tests/storage-model.test.js`

- [ ] **Step 1: 在 `tests/storage-model.test.js` 末尾追加失败测试**

Append to `tests/storage-model.test.js`:

```javascript
test("upsertVisibleConversations prepends a brand new url to unclassified head", () => {
  const state = model.createInitialState();
  state.folders.unclassified.push({
    provider: "chatgpt",
    account: "user@example.com",
    title: "老对话",
    url: "https://chatgpt.com/c/old"
  });

  const next = model.upsertVisibleConversations(state, "chatgpt", "user@example.com", [
    { title: "新对话", url: "https://chatgpt.com/c/new" },
    { title: "老对话", url: "https://chatgpt.com/c/old" }
  ]);

  assert.deepEqual(
    next.folders.unclassified.map((record) => record.url),
    ["https://chatgpt.com/c/new", "https://chatgpt.com/c/old"]
  );
});

test("upsertVisibleConversations preserves DOM order across multiple brand new urls", () => {
  const state = model.createInitialState();
  state.folders.unclassified.push({
    provider: "chatgpt",
    account: "user@example.com",
    title: "原有",
    url: "https://chatgpt.com/c/old"
  });

  const next = model.upsertVisibleConversations(state, "chatgpt", "user@example.com", [
    { title: "最新", url: "https://chatgpt.com/c/a" },
    { title: "次新", url: "https://chatgpt.com/c/b" },
    { title: "再次", url: "https://chatgpt.com/c/c" },
    { title: "原有", url: "https://chatgpt.com/c/old" }
  ]);

  assert.deepEqual(
    next.folders.unclassified.map((record) => record.url),
    [
      "https://chatgpt.com/c/a",
      "https://chatgpt.com/c/b",
      "https://chatgpt.com/c/c",
      "https://chatgpt.com/c/old"
    ]
  );
});

test("upsertVisibleConversations does not move a brand new url that lives in a custom folder", () => {
  let state = model.createFolder(model.createInitialState(), "coding");
  state.folders.coding.push({
    provider: "chatgpt",
    account: "user@example.com",
    title: "保留在 coding",
    url: "https://chatgpt.com/c/keep"
  });

  const next = model.upsertVisibleConversations(state, "chatgpt", "user@example.com", [
    { title: "保留在 coding", url: "https://chatgpt.com/c/keep" },
    { title: "新进来", url: "https://chatgpt.com/c/new" }
  ]);

  assert.deepEqual(next.folders.coding.map((r) => r.url), ["https://chatgpt.com/c/keep"]);
  assert.deepEqual(next.folders.unclassified.map((r) => r.url), ["https://chatgpt.com/c/new"]);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
node --test tests/storage-model.test.js
```

Expected: 前两个新测试 FAIL(顺序错误);第三个可能 PASS(已存在的行为)。

- [ ] **Step 3: 修改 `upsertVisibleConversations` 让新记录整体 prepend**

In `storage-model.js` replace the `upsertVisibleConversations` function body (currently around lines 101-143) with:

```javascript
  function upsertVisibleConversations(state, provider, account, records) {
    const next = cloneState(state);
    const normalizedAccount = normalizeAccount(account);
    const normalizedRecords = records
      .map((record) => normalizeRecord(record, provider, normalizedAccount))
      .filter((record) => record.url);

    if (normalizedAccount !== UNKNOWN_ACCOUNT) {
      next.activeAccounts[provider] = normalizedAccount;
    }

    if (normalizedAccount !== UNKNOWN_ACCOUNT && normalizedRecords.length > 0) {
      const visibleUrls = new Set(normalizedRecords.map((record) => record.url));
      Object.keys(next.folders).forEach((folderName) => {
        next.folders[folderName] = next.folders[folderName].filter((record) => {
          if (record.provider !== provider || normalizeAccount(record.account) !== normalizedAccount) {
            return true;
          }

          return visibleUrls.has(record.url);
        });
      });
    }

    const newRecords = [];

    normalizedRecords.forEach((normalized) => {
      const location = findRecordLocation(next, provider, normalized.url, normalized.account);
      if (!location) {
        newRecords.push(normalized);
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

    if (newRecords.length > 0) {
      next.folders.unclassified.unshift(...newRecords);
    }

    return next;
  }
```

- [ ] **Step 4: 运行测试确认通过**

Run:

```bash
node --test tests/storage-model.test.js
```

Expected: PASS,新旧测试全部通过。

- [ ] **Step 5: 提交**

```bash
git add storage-model.js tests/storage-model.test.js
git commit -m "feat(model): prepend brand-new conversations to unclassified"
```

---

### Task 2: 存储模型 — deleteFolder

**Files:**
- Modify: `storage-model.js`
- Modify: `tests/storage-model.test.js`

- [ ] **Step 1: 追加失败测试**

Append to `tests/storage-model.test.js`:

```javascript
test("deleteFolder removes an empty custom folder", () => {
  const state = model.createFolder(model.createInitialState(), "temp");
  const next = model.deleteFolder(state, "temp");

  assert.equal(next.folders.temp, undefined);
  assert.deepEqual(Object.keys(next.folders).sort(), ["archived", "unclassified"]);
});

test("deleteFolder appends conversations to unclassified tail and removes the folder", () => {
  let state = model.createFolder(model.createInitialState(), "coding");
  state.folders.unclassified.push({
    provider: "chatgpt",
    account: "u@example.com",
    title: "保留",
    url: "https://chatgpt.com/c/keep"
  });
  state.folders.coding.push(
    { provider: "chatgpt", account: "u@example.com", title: "移走 1", url: "https://chatgpt.com/c/m1" },
    { provider: "chatgpt", account: "u@example.com", title: "移走 2", url: "https://chatgpt.com/c/m2" }
  );

  const next = model.deleteFolder(state, "coding");

  assert.equal(next.folders.coding, undefined);
  assert.deepEqual(
    next.folders.unclassified.map((r) => r.url),
    [
      "https://chatgpt.com/c/keep",
      "https://chatgpt.com/c/m1",
      "https://chatgpt.com/c/m2"
    ]
  );
});

test("deleteFolder refuses to remove system folders", () => {
  const state = model.createInitialState();
  const a = model.deleteFolder(state, "unclassified");
  const b = model.deleteFolder(state, "archived");

  assert.ok(a.folders.unclassified);
  assert.ok(b.folders.archived);
});

test("deleteFolder ignores nonexistent folder names", () => {
  const state = model.createInitialState();
  const next = model.deleteFolder(state, "ghost");

  assert.deepEqual(Object.keys(next.folders).sort(), ["archived", "unclassified"]);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
node --test tests/storage-model.test.js
```

Expected: FAIL,`model.deleteFolder is not a function`。

- [ ] **Step 3: 实现 `deleteFolder`**

In `storage-model.js`, immediately after the `createFolder` function (around line 155 — before `moveConversation`), insert:

```javascript
  function deleteFolder(state, folderName) {
    const next = cloneState(state);

    if (isSystemFolder(folderName) || !next.folders[folderName]) {
      return next;
    }

    const records = next.folders[folderName];
    next.folders.unclassified.push(...records);
    delete next.folders[folderName];

    return next;
  }
```

In the `return { ... }` block at the bottom of the IIFE, add `deleteFolder,` to the exported object (keep alphabetical-ish; right after `createFolder,`).

- [ ] **Step 4: 运行测试确认通过**

Run:

```bash
node --test tests/storage-model.test.js
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add storage-model.js tests/storage-model.test.js
git commit -m "feat(model): add deleteFolder that moves contents to unclassified"
```

---

### Task 3: 存储模型 — renameFolder

**Files:**
- Modify: `storage-model.js`
- Modify: `tests/storage-model.test.js`

- [ ] **Step 1: 追加失败测试**

Append to `tests/storage-model.test.js`:

```javascript
test("renameFolder renames a custom folder and keeps its records", () => {
  const state = model.createFolder(model.createInitialState(), "coding");
  state.folders.coding.push({
    provider: "chatgpt",
    account: "u@example.com",
    title: "保留",
    url: "https://chatgpt.com/c/x"
  });

  const next = model.renameFolder(state, "coding", "research");

  assert.equal(next.folders.coding, undefined);
  assert.equal(next.folders.research.length, 1);
  assert.equal(next.folders.research[0].url, "https://chatgpt.com/c/x");
});

test("renameFolder rejects empty or whitespace newName", () => {
  const state = model.createFolder(model.createInitialState(), "coding");

  const a = model.renameFolder(state, "coding", "");
  const b = model.renameFolder(state, "coding", "   ");

  assert.ok(a.folders.coding);
  assert.ok(b.folders.coding);
});

test("renameFolder refuses to rename system folders", () => {
  const state = model.createInitialState();
  const a = model.renameFolder(state, "unclassified", "other");
  const b = model.renameFolder(state, "archived", "old");

  assert.ok(a.folders.unclassified);
  assert.equal(a.folders.other, undefined);
  assert.ok(b.folders.archived);
  assert.equal(b.folders.old, undefined);
});

test("renameFolder refuses newName that equals a system folder name", () => {
  const state = model.createFolder(model.createInitialState(), "coding");
  const a = model.renameFolder(state, "coding", "unclassified");
  const b = model.renameFolder(state, "coding", "archived");

  assert.ok(a.folders.coding);
  assert.ok(b.folders.coding);
});

test("renameFolder refuses newName when it already exists", () => {
  let state = model.createFolder(model.createInitialState(), "coding");
  state = model.createFolder(state, "research");
  state.folders.coding.push({
    provider: "chatgpt",
    account: "u@example.com",
    title: "X",
    url: "https://chatgpt.com/c/x"
  });

  const next = model.renameFolder(state, "coding", "research");

  assert.ok(next.folders.coding);
  assert.equal(next.folders.research.length, 0);
});

test("renameFolder ignores nonexistent oldName", () => {
  const state = model.createInitialState();
  const next = model.renameFolder(state, "ghost", "newname");

  assert.equal(next.folders.newname, undefined);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
node --test tests/storage-model.test.js
```

Expected: FAIL,`model.renameFolder is not a function`。

- [ ] **Step 3: 实现 `renameFolder`**

In `storage-model.js`, immediately after `deleteFolder` (which Task 2 added), insert:

```javascript
  function renameFolder(state, oldName, rawNewName) {
    const next = cloneState(state);
    const newName = String(rawNewName || "").trim();

    if (isSystemFolder(oldName) || !next.folders[oldName]) {
      return next;
    }

    if (!newName || isSystemFolder(newName) || next.folders[newName]) {
      return next;
    }

    next.folders[newName] = next.folders[oldName];
    delete next.folders[oldName];

    return next;
  }
```

In the exported object at the bottom of the IIFE, add `renameFolder,` right after `deleteFolder,`.

- [ ] **Step 4: 运行测试确认通过**

Run:

```bash
node --test tests/storage-model.test.js
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add storage-model.js tests/storage-model.test.js
git commit -m "feat(model): add renameFolder"
```

---

### Task 4: 存储模型 — settings 默认与归一

**Files:**
- Modify: `storage-model.js`
- Modify: `tests/storage-model.test.js`

- [ ] **Step 1: 追加失败测试**

Append to `tests/storage-model.test.js`:

```javascript
test("createDefaultSettings returns auto + all providers + no quick actions", () => {
  const settings = model.createDefaultSettings(["chatgpt", "gemini"]);

  assert.equal(settings.defaultProvider, "auto");
  assert.deepEqual(settings.enabledProviders, ["chatgpt", "gemini"]);
  assert.deepEqual(settings.enabledQuickActions, []);
});

test("normalizeSettings returns defaults when stored is undefined", () => {
  const result = model.normalizeSettings(undefined, ["chatgpt", "gemini"]);

  assert.equal(result.defaultProvider, "auto");
  assert.deepEqual(result.enabledProviders, ["chatgpt", "gemini"]);
  assert.deepEqual(result.enabledQuickActions, []);
});

test("normalizeSettings drops unknown providers from enabledProviders", () => {
  const result = model.normalizeSettings(
    { defaultProvider: "auto", enabledProviders: ["chatgpt", "ghost", "gemini"], enabledQuickActions: [] },
    ["chatgpt", "gemini"]
  );

  assert.deepEqual(result.enabledProviders, ["chatgpt", "gemini"]);
});

test("normalizeSettings falls back to all providers when enabledProviders ends up empty", () => {
  const result = model.normalizeSettings(
    { defaultProvider: "auto", enabledProviders: [], enabledQuickActions: [] },
    ["chatgpt", "gemini"]
  );

  assert.deepEqual(result.enabledProviders, ["chatgpt", "gemini"]);
});

test("normalizeSettings resets an unknown defaultProvider to auto", () => {
  const result = model.normalizeSettings(
    { defaultProvider: "ghost", enabledProviders: ["chatgpt"], enabledQuickActions: [] },
    ["chatgpt", "gemini"]
  );

  assert.equal(result.defaultProvider, "auto");
});

test("normalizeSettings preserves a valid concrete defaultProvider", () => {
  const result = model.normalizeSettings(
    { defaultProvider: "gemini", enabledProviders: ["chatgpt", "gemini"], enabledQuickActions: [] },
    ["chatgpt", "gemini"]
  );

  assert.equal(result.defaultProvider, "gemini");
});

test("normalizeSettings filters non-string and malformed quick action ids", () => {
  const result = model.normalizeSettings(
    {
      defaultProvider: "auto",
      enabledProviders: ["chatgpt"],
      enabledQuickActions: ["gemini.notebook", null, 42, "no_dot", "claude.project"]
    },
    ["chatgpt"]
  );

  assert.deepEqual(result.enabledQuickActions, ["gemini.notebook", "claude.project"]);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
node --test tests/storage-model.test.js
```

Expected: FAIL,`model.createDefaultSettings is not a function`。

- [ ] **Step 3: 实现 settings 函数**

In `storage-model.js`, right above the `getFolderOrder` function, insert:

```javascript
  function createDefaultSettings(providerNames) {
    return {
      defaultProvider: "auto",
      enabledProviders: [...providerNames],
      enabledQuickActions: []
    };
  }

  function normalizeSettings(stored, providerNames) {
    const known = new Set(providerNames);
    const fallback = createDefaultSettings(providerNames);
    const input = stored || {};

    const defaultProvider = input.defaultProvider === "auto" || known.has(input.defaultProvider)
      ? input.defaultProvider
      : "auto";

    let enabledProviders = Array.isArray(input.enabledProviders)
      ? input.enabledProviders.filter((name) => known.has(name))
      : null;

    if (!enabledProviders || enabledProviders.length === 0) {
      enabledProviders = fallback.enabledProviders;
    }

    const enabledQuickActions = Array.isArray(input.enabledQuickActions)
      ? input.enabledQuickActions.filter((id) => typeof id === "string" && id.includes("."))
      : [];

    return {
      defaultProvider,
      enabledProviders,
      enabledQuickActions
    };
  }
```

In the exported object at the bottom of the IIFE, add `createDefaultSettings,` and `normalizeSettings,` right after `renameFolder,`.

- [ ] **Step 4: 运行测试确认通过**

Run:

```bash
node --test tests/storage-model.test.js
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add storage-model.js tests/storage-model.test.js
git commit -m "feat(model): add settings defaults and normalization"
```

---

### Task 5: Provider 配置 — quickActions 字段

**Files:**
- Modify: `providers/chatgpt.js`
- Modify: `providers/gemini.js`
- Modify: `providers/claude.js`

- [ ] **Step 1: 给 ChatGPT 加 quickActions**

In `providers/chatgpt.js`, inside the `config` object, add after the `badge` line (before `scraping`):

```javascript
    quickActions: [
      { id: "chatgpt.image", label: "图片", url: "https://chatgpt.com/?model=gpt-image-1" },
      { id: "chatgpt.gpts",  label: "GPTs", url: "https://chatgpt.com/gpts" }
    ],
```

- [ ] **Step 2: 给 Gemini 加 quickActions**

In `providers/gemini.js`, after the `badge` line:

```javascript
    quickActions: [
      { id: "gemini.notebook", label: "新建笔记本", url: "https://notebooklm.google.com/" }
    ],
```

- [ ] **Step 3: 给 Claude 加 quickActions**

In `providers/claude.js`, after the `badge` line:

```javascript
    quickActions: [
      { id: "claude.project", label: "新建项目", url: "https://claude.ai/new?project=true" }
    ],
```

- [ ] **Step 4: 手动加载扩展确认无脚本错误**

Run: Chrome 扩展管理页刷新 LLM Navigation。

Expected:
- service worker 没有运行时错误。
- 打开 side panel,功能未变(本任务还没改 sidepanel.js)。
- 在 DevTools console 执行 `window.LLMNavProviders.chatgpt.quickActions` 看到上面 2 条;`window.LLMNavProviders.gemini.quickActions` 看到 1 条;`window.LLMNavProviders.claude.quickActions` 看到 1 条。

- [ ] **Step 5: 提交**

```bash
git add providers/chatgpt.js providers/gemini.js providers/claude.js
git commit -m "feat(providers): declare quickActions for chatgpt, gemini, claude"
```

---

### Task 6: HTML 结构重构 + CSS 骨架

**Files:**
- Modify: `sidepanel.html`
- Modify: `sidepanel.css`
- Modify: `tests/sidepanel-static.test.js`

- [ ] **Step 1: 替换"最简结构"静态测试以匹配新 ID**

In `tests/sidepanel-static.test.js`, replace the test currently titled `"sidepanel html 保留最简结构 + 加载 provider 注册表脚本"` with:

```javascript
test("sidepanel html 含拆分按钮 + 设置浮层 + 目录区头骨架", () => {
  const html = readFile("sidepanel.html");

  assert.match(html, /id="actions"/);
  assert.match(html, /id="settings-button"/);
  assert.match(html, /id="new-chat-main"/);
  assert.match(html, /id="new-chat-caret"/);
  assert.match(html, /id="provider-dropdown"/);
  assert.match(html, /id="quick-actions"/);
  assert.match(html, /id="folder-header"/);
  assert.match(html, /id="new-folder-button"/);
  assert.match(html, /id="folder-form"/);
  assert.match(html, /id="folders"/);
  assert.match(html, /id="settings-modal"/);
  assert.match(html, /id="settings-modal-close"/);
  assert.match(html, /id="settings-modal-body"/);
  assert.match(html, /providers\/chatgpt\.js/);
  assert.match(html, /providers\/gemini\.js/);
  assert.match(html, /providers\/claude\.js/);
  assert.match(html, /providers\/deepseek\.js/);
  assert.match(html, /providers\/grok\.js/);
  assert.match(html, /providers\/kimi\.js/);
  assert.match(html, /providers\/perplexity\.js/);
  assert.match(html, /storage-model\.js/);
  assert.match(html, /sidepanel\.js/);
  assert.equal(/<h1\b/i.test(html), false);
  assert.equal(/账号邮箱/.test(html), false);
  assert.doesNotMatch(html, /id="new-chatgpt"/);
  assert.doesNotMatch(html, /id="new-gemini"/);
  assert.doesNotMatch(html, /id="show-folder-form"/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
node --test tests/sidepanel-static.test.js
```

Expected: FAIL,缺少 `id="settings-button"` 等新 ID。

- [ ] **Step 3: 替换 `sidepanel.html`**

Replace the entire contents of `sidepanel.html`:

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
        <div class="actions-top-row">
          <button id="settings-button" class="icon-button" type="button" aria-label="设置" title="设置">⚙</button>
          <div class="split-button" id="new-chat-split">
            <button id="new-chat-main" class="split-button-main" type="button">新建对话</button>
            <button id="new-chat-caret" class="split-button-caret" type="button" aria-label="切换 provider">▾</button>
            <ul id="provider-dropdown" class="dropdown hidden" role="menu"></ul>
          </div>
        </div>
        <div id="quick-actions" class="quick-actions"></div>
      </section>

      <p id="notice" class="notice hidden"></p>

      <section class="folder-header" id="folder-header" aria-label="目录区头">
        <span class="folder-header-label">目录</span>
        <button id="new-folder-button" class="icon-button" type="button" aria-label="新建目录" title="新建目录">+</button>
      </section>
      <form id="folder-form" class="folder-form hidden" autocomplete="off">
        <input id="folder-name" name="folderName" type="text" maxlength="40" placeholder="目录名称" aria-label="目录名称">
        <button type="submit">创建</button>
      </form>

      <section id="folders" class="folders" aria-label="对话目录"></section>
    </main>

    <div id="settings-modal" class="modal-overlay hidden" role="dialog" aria-modal="true" aria-label="设置">
      <div class="modal-content">
        <div class="modal-header">
          <span class="modal-title">设置</span>
          <button id="settings-modal-close" class="icon-button" type="button" aria-label="关闭设置" title="关闭">×</button>
        </div>
        <div id="settings-modal-body" class="modal-body"></div>
      </div>
    </div>

    <script src="providers/chatgpt.js"></script>
    <script src="providers/gemini.js"></script>
    <script src="providers/claude.js"></script>
    <script src="providers/deepseek.js"></script>
    <script src="providers/grok.js"></script>
    <script src="providers/kimi.js"></script>
    <script src="providers/perplexity.js"></script>
    <script src="storage-model.js"></script>
    <script src="sidepanel.js"></script>
  </body>
</html>
```

- [ ] **Step 4: 运行 HTML 测试确认通过**

Run:

```bash
node --test tests/sidepanel-static.test.js
```

Expected: 新的 "sidepanel html 含拆分按钮…" 测试 PASS;其余 JS 相关测试此时仍会 FAIL(下一个 Task 处理)。

- [ ] **Step 5: 追加 CSS 新元素样式**

Append to `sidepanel.css`:

```css
.actions-top-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.icon-button {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 9999px;
  background: transparent;
  color: rgb(31, 31, 31);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  font-size: 16px;
  line-height: 1;
}

.icon-button:hover {
  background: #f1f3f4;
}

.split-button {
  position: relative;
  flex: 1;
  display: flex;
  align-items: stretch;
  min-width: 0;
}

.split-button-main {
  flex: 1;
  min-width: 0;
  height: 32px;
  border: 0;
  background: transparent;
  color: rgb(0, 0, 0);
  cursor: pointer;
  border-radius: 9999px 0 0 9999px;
  padding: 0 10px;
  text-align: left;
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-family: "Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif;
  font-size: 13px;
  line-height: 17px;
  font-weight: 400;
}

.split-button-caret {
  flex-shrink: 0;
  width: 24px;
  height: 32px;
  border: 0;
  background: transparent;
  cursor: pointer;
  border-radius: 0 9999px 9999px 0;
  padding: 0;
  font-size: 11px;
  color: rgb(31, 31, 31);
}

.split-button-main:hover,
.split-button-caret:hover {
  background: #f1f3f4;
}

.dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  margin: 0;
  padding: 4px 0;
  list-style: none;
  background: #ffffff;
  border: 1px solid #dadce0;
  border-radius: 8px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
  z-index: 10;
}

.dropdown li {
  height: 32px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  cursor: pointer;
}

.dropdown li:hover {
  background: #f1f3f4;
}

.quick-actions {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 4px;
}

.quick-action {
  width: 100%;
  height: 32px;
  border: 0;
  border-radius: 9999px;
  background: transparent;
  color: rgb(0, 0, 0);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
  text-align: left;
  font-family: "Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif;
  font-size: 13px;
  line-height: 17px;
  font-weight: 400;
}

.quick-action:hover {
  background: #f1f3f4;
}

.folder-header {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  margin: 8px 0 4px;
  color: rgb(95, 99, 104);
  font-size: 12px;
  text-transform: uppercase;
}

.folder-header-label {
  flex: 1;
}

.folder-row {
  align-items: center;
}

.folder-actions {
  display: none;
  flex-shrink: 0;
  align-items: center;
  gap: 2px;
}

.folder-row:hover .folder-actions {
  display: inline-flex;
}

.folder-action {
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 9999px;
  background: transparent;
  color: rgb(95, 99, 104);
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.folder-action:hover {
  background: #e0e0e0;
}

.folder-rename-input {
  flex: 1;
  min-width: 0;
  height: 24px;
  border: 1px solid #dadce0;
  border-radius: 4px;
  background: #ffffff;
  color: rgb(31, 31, 31);
  padding: 0 6px;
  font-family: "Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif;
  font-size: 13px;
  line-height: 17px;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 16px;
  z-index: 100;
}

.modal-content {
  width: 100%;
  max-width: 320px;
  max-height: calc(100vh - 32px);
  overflow-y: auto;
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
}

.modal-header {
  display: flex;
  align-items: center;
  padding: 8px 8px 8px 16px;
  border-bottom: 1px solid #f1f3f4;
}

.modal-title {
  flex: 1;
  font-size: 14px;
  font-weight: 500;
}

.modal-body {
  padding: 12px 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.settings-section h3 {
  margin: 0 0 6px;
  font-size: 12px;
  font-weight: 500;
  color: rgb(95, 99, 104);
  text-transform: uppercase;
}

.settings-section label {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  cursor: pointer;
}

.settings-section select {
  width: 100%;
  height: 32px;
  border: 1px solid #dadce0;
  border-radius: 4px;
  background: #ffffff;
  padding: 0 8px;
  font: inherit;
}
```

- [ ] **Step 6: 手动验证扩展加载**

Run: Chrome 扩展管理页刷新 LLM Navigation,然后打开 side panel。

Expected:
- 扩展加载无错误。
- side panel 顶部能看到齿轮 icon、"新建对话" 文字、▾ caret(此时尚未连接逻辑,点击无反应是预期的)。
- 目录区头看到"目录"文字和 `+` icon。
- side panel 下方的目录列表暂时不显示对话条目(因为 sidepanel.js 还没适配新结构,会因为找不到 `#show-folder-form` 抛错;这是预期的,Task 7-10 会修复)。

- [ ] **Step 7: 提交**

```bash
git add sidepanel.html sidepanel.css tests/sidepanel-static.test.js
git commit -m "feat(ui): restructure side panel html and css skeleton"
```

---

### Task 7: Sidepanel JS — 顶部拆分按钮 + 快捷操作

**Files:**
- Modify: `sidepanel.js`
- Modify: `tests/sidepanel-static.test.js`

- [ ] **Step 1: 替换"per-provider 新建按钮"静态测试**

In `tests/sidepanel-static.test.js`,**删除**目前的 `"sidepanel 通过注册表注入 per-provider 新建按钮"` 测试(整段 `test(...)` 调用),用以下两个新测试替换:

```javascript
test("sidepanel 主按钮文字跟随启用的 provider 与当前页面状态", async () => {
  const source = readFile("sidepanel.js");
  const providers = loadProviderRegistry();
  let domContentLoadedListener = null;
  const storedState = {
    folders: { unclassified: [], archived: [] },
    activeAccounts: {},
    settings: {
      defaultProvider: "auto",
      enabledProviders: ["chatgpt", "gemini", "claude", "deepseek", "grok", "kimi", "perplexity"],
      enabledQuickActions: []
    }
  };

  function createElement() {
    return {
      children: [],
      classList: { add() {}, remove() {}, toggle() {} },
      dataset: {},
      style: {},
      textContent: "",
      hidden: false,
      addEventListener() {},
      append(...nodes) { this.children.push(...nodes); },
      appendChild(child) { this.children.push(child); return child; },
      replaceChildren(...nodes) { this.children = [...nodes]; },
      focus() {},
      setAttribute() {},
      removeAttribute() {}
    };
  }

  const elementIds = [
    "actions", "settings-button", "new-chat-main", "new-chat-caret",
    "provider-dropdown", "quick-actions", "folder-header", "new-folder-button",
    "folder-form", "folder-name", "folders", "notice",
    "settings-modal", "settings-modal-close", "settings-modal-body"
  ];
  const elements = Object.fromEntries(elementIds.map((id) => [id, createElement()]));

  const context = {
    window: { LLMNavProviders: providers },
    chrome: {
      runtime: {
        onMessage: { addListener() {} },
        sendMessage(_, cb) { cb({ supported: true, provider: "gemini", hasAccount: true, account: "u@example.com", hasHistory: true }); }
      },
      storage: {
        local: {
          get() { return Promise.resolve(storedState); },
          set() { return Promise.resolve(); }
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
      getElementById(id) { return elements[id]; },
      body: createElement()
    },
    LLMNavModel: model
  };

  vm.runInNewContext(source, context);
  await domContentLoadedListener();

  assert.match(elements["new-chat-main"].textContent, /Gemini/);
});

test("sidepanel 渲染启用的 quickActions 为按钮", async () => {
  const source = readFile("sidepanel.js");
  const providers = loadProviderRegistry();
  let domContentLoadedListener = null;
  const storedState = {
    folders: { unclassified: [], archived: [] },
    activeAccounts: {},
    settings: {
      defaultProvider: "auto",
      enabledProviders: ["chatgpt", "gemini"],
      enabledQuickActions: ["gemini.notebook", "chatgpt.image"]
    }
  };

  function createElement() {
    return {
      children: [],
      classList: { add() {}, remove() {}, toggle() {} },
      dataset: {},
      style: {},
      textContent: "",
      addEventListener() {},
      append(...nodes) { this.children.push(...nodes); },
      appendChild(child) { this.children.push(child); return child; },
      replaceChildren(...nodes) { this.children = [...nodes]; },
      focus() {},
      setAttribute() {},
      removeAttribute() {}
    };
  }

  const elementIds = [
    "actions", "settings-button", "new-chat-main", "new-chat-caret",
    "provider-dropdown", "quick-actions", "folder-header", "new-folder-button",
    "folder-form", "folder-name", "folders", "notice",
    "settings-modal", "settings-modal-close", "settings-modal-body"
  ];
  const elements = Object.fromEntries(elementIds.map((id) => [id, createElement()]));

  const context = {
    window: { LLMNavProviders: providers },
    chrome: {
      runtime: {
        onMessage: { addListener() {} },
        sendMessage(_, cb) { cb({ supported: false }); }
      },
      storage: {
        local: {
          get() { return Promise.resolve(storedState); },
          set() { return Promise.resolve(); }
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
      getElementById(id) { return elements[id]; },
      body: createElement()
    },
    LLMNavModel: model
  };

  vm.runInNewContext(source, context);
  await domContentLoadedListener();

  assert.equal(elements["quick-actions"].children.length, 2);
});
```

同时,删除前面 `"sidepanel script 通过注册表渲染按钮、徽标与文案"` 测试里以下几条已不适用的断言行:

```javascript
  assert.match(script, /renderNewChatButtons/);
```

并把这条 `doesNotMatch` 加进去:

```javascript
  assert.doesNotMatch(script, /renderNewChatButtons/);
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
node --test tests/sidepanel-static.test.js
```

Expected: FAIL,与新测试相关的断言失败(主按钮文字不含 "Gemini",quick-actions 子节点数为 0)。

- [ ] **Step 3: 重写 `sidepanel.js`**

Replace the entire contents of `sidepanel.js` with:

```javascript
const FOLDER_LABELS = {
  unclassified: "未分类",
  archived: "归档"
};

let pageState = { supported: false };
let settings = null;
let collapsedFolders = new Set(["archived"]);
let renderSequence = 0;

function byId(id) {
  return document.getElementById(id);
}

function listProviders() {
  return window.LLMNavProviders;
}

function getProvider(name) {
  return listProviders()[name] || null;
}

function providerNames() {
  return Object.keys(listProviders());
}

function allQuickActions() {
  const result = [];
  providerNames().forEach((name) => {
    const provider = getProvider(name);
    if (provider && Array.isArray(provider.quickActions)) {
      provider.quickActions.forEach((action) => {
        result.push({ provider, action });
      });
    }
  });
  return result;
}

function resolveDefaultProviderName() {
  if (pageState && pageState.supported && pageState.provider && getProvider(pageState.provider)) {
    return pageState.provider;
  }

  if (settings.defaultProvider !== "auto" && getProvider(settings.defaultProvider)) {
    return settings.defaultProvider;
  }

  return settings.enabledProviders[0];
}

document.addEventListener("DOMContentLoaded", init);

async function init() {
  byId("settings-button").addEventListener("click", openSettings);
  byId("new-folder-button").addEventListener("click", showFolderForm);
  byId("folder-form").addEventListener("submit", createFolderFromForm);

  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === "llmnav:pageState") {
      pageState = message.state || { supported: false };
      renderTopActions();
      render();
    }

    if (message && message.type === "llmnav:storageUpdated") {
      render();
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;

    if (changes.settings) {
      settings = LLMNavModel.normalizeSettings(changes.settings.newValue, providerNames());
      renderTopActions();
    }

    if (changes.folders || changes.activeAccounts) {
      render();
    }
  });

  const stored = await chrome.storage.local.get(["settings"]);
  settings = LLMNavModel.normalizeSettings(stored.settings, providerNames());

  pageState = await sendMessage({ type: "llmnav:getPageState" }) || { supported: false };

  renderTopActions();
  await render();
}

function renderTopActions() {
  const defaultName = resolveDefaultProviderName();
  const provider = getProvider(defaultName);
  const main = byId("new-chat-main");
  main.textContent = provider ? `新建对话 · ${provider.label}` : "新建对话";
  main.onclick = () => {
    if (provider) openUrl(provider.newChatUrl);
  };

  const caret = byId("new-chat-caret");
  caret.onclick = (event) => {
    event.stopPropagation();
    toggleProviderDropdown();
  };

  const dropdown = byId("provider-dropdown");
  dropdown.replaceChildren();
  settings.enabledProviders.forEach((name) => {
    const p = getProvider(name);
    if (!p) return;
    const li = document.createElement("li");
    li.textContent = `新建对话 · ${p.label}`;
    li.onclick = () => {
      hideProviderDropdown();
      openUrl(p.newChatUrl);
    };
    dropdown.appendChild(li);
  });

  renderQuickActions();
}

function renderQuickActions() {
  const container = byId("quick-actions");
  container.replaceChildren();

  const enabledIds = new Set(settings.enabledQuickActions);
  allQuickActions().forEach(({ provider, action }) => {
    if (!enabledIds.has(action.id)) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "quick-action";
    button.dataset.actionId = action.id;

    const badge = document.createElement("span");
    badge.className = "conversation-badge";
    badge.textContent = provider.badge.letter;
    badge.style.backgroundColor = provider.badge.color;

    const text = document.createElement("span");
    text.className = "conversation-title";
    text.textContent = `${provider.label} · ${action.label}`;

    button.append(badge, text);
    button.onclick = () => openUrl(action.url);
    container.appendChild(button);
  });
}

function toggleProviderDropdown() {
  const dropdown = byId("provider-dropdown");
  if (dropdown.classList.contains("hidden")) {
    dropdown.classList.remove("hidden");
    setTimeout(() => {
      document.addEventListener("click", hideOnOutsideClick, { once: true });
    }, 0);
  } else {
    dropdown.classList.add("hidden");
  }
}

function hideProviderDropdown() {
  byId("provider-dropdown").classList.add("hidden");
}

function hideOnOutsideClick() {
  hideProviderDropdown();
}

function openSettings() {
  // 在 Task 8 接管;占位避免抛错
  console.log("openSettings: not implemented yet");
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
    showNotice(`当前页面不是支持的 LLM 页面。打开 ${labels.join("、")} 后可同步可见历史。`);
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

- [ ] **Step 4: 运行测试确认通过**

Run:

```bash
node --test tests/sidepanel-static.test.js tests/storage-model.test.js
```

Expected: PASS,所有测试通过(包含两个新增的拆分按钮 / quickActions 测试,以及之前的回归测试)。

- [ ] **Step 5: 手动验证**

Run: Chrome 扩展管理页刷新,打开 side panel,先后打开一个非 LLM 页面、ChatGPT、Gemini。

Expected:
- 非 LLM 页面:主按钮显示 "新建对话 · ChatGPT"(enabledProviders 首项)。
- ChatGPT 页面:主按钮显示 "新建对话 · ChatGPT"。
- Gemini 页面:主按钮显示 "新建对话 · Gemini"。
- 点击主按钮跳转到当前显示 provider 的 newChatUrl。
- 点击 ▾ 弹出含 7 个 provider 的下拉,点击其中一个跳转到对应 URL。
- 目录区头显示"目录"和 `+`;点 `+` 展开输入框可新建目录。
- 设置浮层尚未连接(按齿轮 console 输出占位日志),Task 8 处理。

- [ ] **Step 6: 提交**

```bash
git add sidepanel.js tests/sidepanel-static.test.js
git commit -m "feat(ui): split-button new chat + quick actions rendering"
```

---

### Task 8: Sidepanel JS — 设置浮层

**Files:**
- Modify: `sidepanel.js`
- Modify: `tests/sidepanel-static.test.js`

- [ ] **Step 1: 追加设置浮层静态测试**

Append to `tests/sidepanel-static.test.js`:

```javascript
test("sidepanel script 包含设置浮层渲染与改即生效逻辑", () => {
  const script = readFile("sidepanel.js");

  assert.match(script, /openSettings/);
  assert.match(script, /closeSettings/);
  assert.match(script, /renderSettingsBody/);
  assert.match(script, /normalizeSettings/);
  assert.match(script, /enabledProviders/);
  assert.match(script, /enabledQuickActions/);
  assert.match(script, /defaultProvider/);
  assert.match(script, /chrome\.storage\.local\.set\(\{\s*settings/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
node --test tests/sidepanel-static.test.js
```

Expected: FAIL,缺少 `renderSettingsBody` 等符号。

- [ ] **Step 3: 在 `sidepanel.js` 替换占位 openSettings 并新增 closeSettings / renderSettingsBody / saveSettings**

In `sidepanel.js`, find the `openSettings` placeholder added in Task 7 and replace it (plus add helpers immediately after) with:

```javascript
function openSettings() {
  renderSettingsBody();
  const modal = byId("settings-modal");
  modal.classList.remove("hidden");

  byId("settings-modal-close").onclick = closeSettings;
  modal.onclick = (event) => {
    if (event.target === modal) closeSettings();
  };
  document.addEventListener("keydown", onSettingsKeyDown);
}

function closeSettings() {
  byId("settings-modal").classList.add("hidden");
  document.removeEventListener("keydown", onSettingsKeyDown);
}

function onSettingsKeyDown(event) {
  if (event.key === "Escape") closeSettings();
}

function renderSettingsBody() {
  const body = byId("settings-modal-body");
  body.replaceChildren();

  body.appendChild(renderDefaultProviderSection());
  body.appendChild(renderEnabledProvidersSection());
  body.appendChild(renderQuickActionsSection());
}

function renderDefaultProviderSection() {
  const section = document.createElement("section");
  section.className = "settings-section";

  const title = document.createElement("h3");
  title.textContent = "默认 provider";
  section.appendChild(title);

  const select = document.createElement("select");
  const autoOption = document.createElement("option");
  autoOption.value = "auto";
  autoOption.textContent = "跟随当前页";
  select.appendChild(autoOption);

  providerNames().forEach((name) => {
    const provider = getProvider(name);
    if (!provider) return;
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = provider.label;
    select.appendChild(opt);
  });

  select.value = settings.defaultProvider;
  select.onchange = () => {
    saveSettings({ ...settings, defaultProvider: select.value });
  };
  section.appendChild(select);

  return section;
}

function renderEnabledProvidersSection() {
  const section = document.createElement("section");
  section.className = "settings-section";

  const title = document.createElement("h3");
  title.textContent = "新建对话下拉里显示";
  section.appendChild(title);

  const enabled = new Set(settings.enabledProviders);

  providerNames().forEach((name) => {
    const provider = getProvider(name);
    if (!provider) return;

    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = enabled.has(name);

    const isLastChecked = enabled.size === 1 && enabled.has(name);
    if (isLastChecked) {
      checkbox.disabled = true;
      label.title = "至少保留一个 provider";
    }

    checkbox.onchange = () => {
      const next = new Set(settings.enabledProviders);
      if (checkbox.checked) {
        next.add(name);
      } else {
        next.delete(name);
      }
      saveSettings({ ...settings, enabledProviders: providerNames().filter((p) => next.has(p)) });
    };

    label.append(checkbox, document.createTextNode(provider.label));
    section.appendChild(label);
  });

  return section;
}

function renderQuickActionsSection() {
  const section = document.createElement("section");
  section.className = "settings-section";

  const title = document.createElement("h3");
  title.textContent = "快捷操作";
  section.appendChild(title);

  const enabled = new Set(settings.enabledQuickActions);
  const actions = allQuickActions();

  if (actions.length === 0) {
    const note = document.createElement("p");
    note.textContent = "暂无可用的快捷操作。";
    section.appendChild(note);
    return section;
  }

  actions.forEach(({ provider, action }) => {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = enabled.has(action.id);
    checkbox.onchange = () => {
      const next = new Set(settings.enabledQuickActions);
      if (checkbox.checked) {
        next.add(action.id);
      } else {
        next.delete(action.id);
      }
      saveSettings({ ...settings, enabledQuickActions: [...next] });
    };

    label.append(checkbox, document.createTextNode(`${provider.label} · ${action.label}`));
    section.appendChild(label);
  });

  return section;
}

async function saveSettings(nextSettings) {
  const normalized = LLMNavModel.normalizeSettings(nextSettings, providerNames());
  await chrome.storage.local.set({ settings: normalized });
  // chrome.storage.onChanged 监听器会更新 `settings` 与 UI;此处不直接改本地变量。
}
```

- [ ] **Step 4: 运行测试确认通过**

Run:

```bash
node --test tests/sidepanel-static.test.js
```

Expected: PASS。

- [ ] **Step 5: 手动验证设置浮层**

Run: 重新加载扩展,打开 side panel。

Expected:
- 点击齿轮 → 浮层弹出,3 段分别显示:默认 provider 下拉、新建对话下拉成员复选框列表、快捷操作复选框列表。
- 取消勾选某 provider:主按钮文字、▾ 下拉成员立刻更新。
- 只剩一个勾选时,该复选框 disabled,hover 提示"至少保留一个 provider"。
- 启用 `Gemini · 新建笔记本`:顶部立刻多出一行带 Gemini badge 的按钮,点击跳转到对应 URL。
- 默认 provider 改成具体 provider(比如 Gemini):在非 LLM 标签页主按钮显示 Gemini;切到 ChatGPT 标签页时跟随当前页变为 ChatGPT。
- 点 `×` / 浮层外灰幕 / Esc 都能关闭浮层。

- [ ] **Step 6: 提交**

```bash
git add sidepanel.js tests/sidepanel-static.test.js
git commit -m "feat(ui): in-panel settings modal with live updates"
```

---

### Task 9: Sidepanel JS — 目录重命名 UX

**Files:**
- Modify: `sidepanel.js`
- Modify: `tests/sidepanel-static.test.js`

- [ ] **Step 1: 追加 rename 静态测试**

Append to `tests/sidepanel-static.test.js`:

```javascript
test("sidepanel script 包含目录重命名逻辑", () => {
  const script = readFile("sidepanel.js");

  assert.match(script, /renameFolder/);
  assert.match(script, /folder-action.*rename/);
  assert.match(script, /folder-rename-input/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
node --test tests/sidepanel-static.test.js
```

Expected: FAIL,缺少 `renameFolder` 等关键字。

- [ ] **Step 3: 改 `renderFolder` 加入 hover 出现的 `✎` icon 与 inline 重命名**

In `sidepanel.js`, replace the `renderFolder` function with:

```javascript
function renderFolder(folderName, records) {
  const section = document.createElement("section");
  section.className = "folder";
  section.dataset.folder = folderName;

  const row = document.createElement("button");
  row.type = "button";
  row.className = "folder-row";
  row.addEventListener("click", (event) => {
    if (event.target.closest(".folder-action") || event.target.closest(".folder-rename-input")) {
      return;
    }
    toggleFolder(folderName);
  });
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

  if (!LLMNavModel.SYSTEM_FOLDERS.includes(folderName)) {
    row.appendChild(renderFolderActions(folderName, records, label));
  }

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

function renderFolderActions(folderName, records, labelSpan) {
  const actions = document.createElement("span");
  actions.className = "folder-actions";

  const renameBtn = document.createElement("button");
  renameBtn.type = "button";
  renameBtn.className = "folder-action folder-action-rename";
  renameBtn.title = "重命名";
  renameBtn.textContent = "✎";
  renameBtn.onclick = (event) => {
    event.stopPropagation();
    beginRename(folderName, labelSpan);
  };

  actions.appendChild(renameBtn);
  return actions;
}

function beginRename(folderName, labelSpan) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "folder-rename-input";
  input.value = folderName;
  input.maxLength = 40;

  const restore = () => {
    if (input.parentNode) {
      input.parentNode.replaceChild(labelSpan, input);
    }
  };

  const commit = async () => {
    const newName = input.value.trim();
    if (!newName || newName === folderName) {
      restore();
      return;
    }
    const state = await loadState();
    const next = LLMNavModel.renameFolder(state, folderName, newName);
    await saveState(next);
    await render();
  };

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      input.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      input.removeEventListener("blur", commit);
      restore();
    }
  });

  input.addEventListener("blur", commit);

  labelSpan.parentNode.replaceChild(input, labelSpan);
  input.focus();
  input.select();
}
```

- [ ] **Step 4: 运行测试确认通过**

Run:

```bash
node --test tests/sidepanel-static.test.js
```

Expected: PASS。

- [ ] **Step 5: 手动验证重命名**

Run: 重新加载扩展,打开 side panel。

Expected:
- hover 一个自定义目录行:右侧出现 `✎` icon。
- hover 系统目录(未分类、归档):不出现 `✎`。
- 点 `✎` → label 替换为 input,光标聚焦并全选当前名称。
- 输入新名 Enter:目录改名,内容跟随。
- 改名时按 Esc:回到原名,不改任何状态。
- 改名为空字符串/原名:保持原状,不抛错。
- 改名为已存在的目录名:UI 上看到原名恢复(model 拒绝)。
- 改完刷新 side panel:新名持久化。

- [ ] **Step 6: 提交**

```bash
git add sidepanel.js tests/sidepanel-static.test.js
git commit -m "feat(ui): inline folder rename via hover pencil icon"
```

---

### Task 10: Sidepanel JS — 目录删除 UX

**Files:**
- Modify: `sidepanel.js`
- Modify: `tests/sidepanel-static.test.js`

- [ ] **Step 1: 追加删除静态测试**

Append to `tests/sidepanel-static.test.js`:

```javascript
test("sidepanel script 包含目录删除逻辑", () => {
  const script = readFile("sidepanel.js");

  assert.match(script, /deleteFolder/);
  assert.match(script, /folder-action-delete/);
  assert.match(script, /window\.confirm/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
node --test tests/sidepanel-static.test.js
```

Expected: FAIL。

- [ ] **Step 3: 在 `renderFolderActions` 里加 `×` icon**

In `sidepanel.js`, replace the `renderFolderActions` function (from Task 9) with:

```javascript
function renderFolderActions(folderName, records, labelSpan) {
  const actions = document.createElement("span");
  actions.className = "folder-actions";

  const renameBtn = document.createElement("button");
  renameBtn.type = "button";
  renameBtn.className = "folder-action folder-action-rename";
  renameBtn.title = "重命名";
  renameBtn.textContent = "✎";
  renameBtn.onclick = (event) => {
    event.stopPropagation();
    beginRename(folderName, labelSpan);
  };

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "folder-action folder-action-delete";
  deleteBtn.title = "删除";
  deleteBtn.textContent = "×";
  deleteBtn.onclick = (event) => {
    event.stopPropagation();
    confirmAndDeleteFolder(folderName, records.length);
  };

  actions.append(renameBtn, deleteBtn);
  return actions;
}

async function confirmAndDeleteFolder(folderName, count) {
  if (count > 0) {
    const ok = window.confirm(`移除「${folderName}」?目录内 ${count} 条对话将移到未分类。`);
    if (!ok) return;
  }

  const state = await loadState();
  const next = LLMNavModel.deleteFolder(state, folderName);
  await saveState(next);
  await render();
}
```

- [ ] **Step 4: 运行测试确认通过**

Run:

```bash
node --test tests/sidepanel-static.test.js
```

Expected: PASS。

- [ ] **Step 5: 手动验证删除**

Run: 重新加载扩展,打开 side panel,先创建一个空目录 `temp` 和一个非空目录 `coding`(往里拖一条对话)。

Expected:
- hover 自定义目录:右侧出现 `✎ ×` 两个 icon。
- 点空目录 `temp` 的 `×`:无 confirm,目录消失。
- 点非空目录 `coding` 的 `×`:弹原生 confirm "移除「coding」?目录内 1 条对话将移到未分类。"
- 确认后:`coding` 消失,该对话出现在"未分类"尾部。
- 系统目录(未分类/归档)hover 时不显示 `×`。
- 刷新 side panel:删除结果持久化。

- [ ] **Step 6: 提交**

```bash
git add sidepanel.js tests/sidepanel-static.test.js
git commit -m "feat(ui): hover delete icon with confirm dialog for non-empty folders"
```

---

### Task 11: 闭环回归 + 手动端到端验证

**Files:**
- No file changes expected.

- [ ] **Step 1: 跑所有自动测试**

Run:

```bash
node --test tests/storage-model.test.js tests/sidepanel-static.test.js tests/manifest.test.js tests/providers.test.js tests/content-scraper.test.js
```

Expected: 所有测试 PASS。

- [ ] **Step 2: 重新加载扩展并清空 storage**

Run:
- Chrome 扩展管理页 → LLM Navigation → 刷新。
- 在 side panel DevTools 执行:`chrome.storage.local.clear()`,然后刷新 side panel。

Expected:
- 顶部:齿轮 + 主按钮(显示"新建对话 · ChatGPT",因为非 LLM 页面 + auto 默认 + enabledProviders[0] = chatgpt)+ ▾(下拉 7 个 provider)。
- 无快捷操作行。
- 目录区头"目录 +",其下"未分类 (0)"。

- [ ] **Step 3: 切到 ChatGPT 同步真实数据**

Run: 打开 chatgpt.com,等左栏渲染,回到 side panel。

Expected:
- ChatGPT 原厂左栏被隐藏(已有逻辑)。
- 主按钮文字变为 "新建对话 · ChatGPT"。
- "未分类"出现可见历史条目,顺序与 ChatGPT 左栏一致(最新在顶部)。

- [ ] **Step 4: 验证新对话置顶**

Run: 在 ChatGPT 页面发起一条全新对话,等待标题生成,刷新 ChatGPT 标签页让 content script 重扫,回 side panel。

Expected:
- 新对话出现在"未分类"列表的**第一个位置**。
- 原有对话相对顺序不变。

- [ ] **Step 5: 验证设置浮层改即生效**

Run: 点击齿轮打开设置。

Expected:
- 默认 provider 选 "Gemini":回到非 LLM 标签页(如 about:blank),主按钮显示 "新建对话 · Gemini"。
- 取消勾选 "Grok"、"Kimi":▾ 下拉里只剩 5 项。
- 试图取消最后一个勾选:复选框 disabled。
- 勾选 "Gemini · 新建笔记本":顶部立刻多出一条带 Gemini badge 的快捷操作按钮。

- [ ] **Step 6: 验证目录新建/重命名/删除**

Run: 点 `+` 新建 `coding`;拖一条对话进去;hover `coding` 点 `✎` 改名为 `research` 按 Enter;再 hover 点 `×` 触发 confirm,确认删除。

Expected:
- 新建后 `coding` 出现并展开。
- 拖入对话成功。
- 重命名后变成 `research`,内含对话不变。
- 删除时弹 confirm 含 "1 条对话";确认后目录消失,对话出现在"未分类"尾部。

- [ ] **Step 7: 验证浮层关闭路径**

Run: 打开设置后分别尝试关闭路径。

Expected:
- 点右上 `×`:关闭。
- 点浮层外灰幕:关闭。
- 按 Esc:关闭。

- [ ] **Step 8: 最终提交检查**

Run:

```bash
git status --short
git log --oneline -12
```

Expected:
- `git status --short` 没有意外的未跟踪或未提交源文件。
- `git log --oneline -12` 看到本次计划 Task 1–10 产生的 10 个提交。

---

## 自检结果

- **Spec 覆盖**:Task 1 覆盖"新同步对话置顶";Task 2 覆盖 `deleteFolder` + 系统目录拒绝;Task 3 覆盖 `renameFolder` 各拒绝分支;Task 4 覆盖 settings 默认与归一;Task 5 给 3 个 provider 加 quickActions;Task 6 覆盖新 HTML/CSS 结构;Task 7 覆盖拆分按钮 + 默认 provider 解析 + quickActions 渲染;Task 8 覆盖设置浮层结构 + 改即生效 + 至少 1 provider 约束;Task 9 覆盖重命名 UX(hover ✎ + inline edit);Task 10 覆盖删除 UX(hover × + 空目录直删 / 非空 confirm);Task 11 端到端回归。
- **占位语扫描**:每个代码步骤给出完整的替换文本,Task 7 里 `openSettings` 显式标注"占位避免抛错,Task 8 接管"并在 Task 8 替换。无未完成 TODO。
- **类型/命名一致性**:`renameFolder(state, oldName, newName)`、`deleteFolder(state, name)`、`createDefaultSettings(providerNames)`、`normalizeSettings(stored, providerNames)`、`settings.{defaultProvider,enabledProviders,enabledQuickActions}`、`quickActions: [{id,label,url}]`、HTML id `settings-button` / `new-chat-main` / `new-chat-caret` / `provider-dropdown` / `quick-actions` / `folder-header` / `new-folder-button` / `settings-modal` / `settings-modal-close` / `settings-modal-body` 在跨 Task 之间一致。
