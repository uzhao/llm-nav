# ChatGPT 同步修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 ChatGPT 扩展同步：从新版原生侧栏抓显示名账号、同步缺失删除、隐藏整个原生侧栏，并补充 Side Panel 左右位置说明。

**Architecture:** 保持现有 MV3 原生 Side Panel 架构不变。内容脚本负责从 ChatGPT DOM 提取账号和历史，数据模型负责把一次同步视为当前账号的权威列表并更新本地 storage，Side Panel 继续只渲染 storage。

**Tech Stack:** Chrome Extension Manifest V3、原生 DOM API、`chrome.storage.local`、Node.js `node:test` 静态/模型测试。

---

## 文件结构

- 修改 `content-chatgpt.js`：更新账号选择器、显示名提取、历史列表抓取范围、原生侧栏隐藏样式。
- 修改 `storage-model.js`：让 `upsertVisibleConversations` 在有账号且有抓取结果时删除同账号下本次列表缺失的 ChatGPT 记录。
- 修改 `tests/storage-model.test.js`：新增同步删除行为和空结果保护测试。
- 修改 `tests/manifest.test.js`：新增内容脚本静态断言，防止回退到旧账号选择器或只隐藏 `#history`。
- 修改 `README.md`：补充 Chrome Side Panel 左右位置需要用户自己在 Chrome 设置中调整。

## Task 1: 数据模型同步删除

**Files:**
- Modify: `storage-model.js:101-131`
- Test: `tests/storage-model.test.js`

- [ ] **Step 1: 写失败测试：当前账号缺失记录会被删除**

在 `tests/storage-model.test.js` 中追加：

```javascript
test("upsertVisibleConversations removes records missing from the current account sync", () => {
  const state = model.createFolder(model.createInitialState(), "coding");
  state.folders.unclassified.push(
    { provider: "chatgpt", account: "Jianyang Zhao", title: "保留", url: "https://chatgpt.com/c/keep" },
    { provider: "chatgpt", account: "Jianyang Zhao", title: "删除", url: "https://chatgpt.com/c/remove" },
    { provider: "chatgpt", account: "Other User", title: "其他账号", url: "https://chatgpt.com/c/other" }
  );
  state.folders.coding.push({
    provider: "chatgpt",
    account: "Jianyang Zhao",
    title: "目录内保留",
    url: "https://chatgpt.com/c/folder-keep"
  });
  state.folders.archived.push({
    provider: "gemini",
    account: "Jianyang Zhao",
    title: "其他 provider",
    url: "https://gemini.google.com/app/one"
  });

  const next = model.upsertVisibleConversations(state, "chatgpt", "Jianyang Zhao", [
    { title: "保留新标题", url: "https://chatgpt.com/c/keep" },
    { title: "目录内保留新标题", url: "https://chatgpt.com/c/folder-keep" },
    { title: "新增", url: "https://chatgpt.com/c/new" }
  ]);

  assert.deepEqual(next.folders.unclassified.map((record) => record.url), [
    "https://chatgpt.com/c/keep",
    "https://chatgpt.com/c/other",
    "https://chatgpt.com/c/new"
  ]);
  assert.equal(next.folders.unclassified[0].title, "保留新标题");
  assert.deepEqual(next.folders.coding.map((record) => record.url), ["https://chatgpt.com/c/folder-keep"]);
  assert.equal(next.folders.coding[0].title, "目录内保留新标题");
  assert.deepEqual(next.folders.archived.map((record) => record.provider), ["gemini"]);
});
```

- [ ] **Step 2: 写失败测试：空抓取结果不删除已有记录**

在 `tests/storage-model.test.js` 中追加：

```javascript
test("upsertVisibleConversations keeps existing records when sync has no records", () => {
  const state = model.createInitialState();
  state.folders.unclassified.push({
    provider: "chatgpt",
    account: "Jianyang Zhao",
    title: "已有记录",
    url: "https://chatgpt.com/c/existing"
  });

  const next = model.upsertVisibleConversations(state, "chatgpt", "Jianyang Zhao", []);

  assert.deepEqual(next.folders.unclassified.map((record) => record.url), ["https://chatgpt.com/c/existing"]);
});
```

- [ ] **Step 3: 运行模型测试确认失败**

Run:

```bash
node --test tests/storage-model.test.js
```

Expected: 第一个新增测试失败，因为 `https://chatgpt.com/c/remove` 仍保留。

- [ ] **Step 4: 实现最小模型修改**

把 `storage-model.js` 中 `upsertVisibleConversations` 替换为：

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

    normalizedRecords.forEach((normalized) => {
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
```

- [ ] **Step 5: 运行模型测试确认通过**

Run:

```bash
node --test tests/storage-model.test.js
```

Expected: 全部模型测试 PASS。

## Task 2: ChatGPT DOM 抓取和原生侧栏隐藏

**Files:**
- Modify: `content-chatgpt.js:2-99`
- Test: `tests/manifest.test.js`

- [ ] **Step 1: 写静态失败测试**

在 `tests/manifest.test.js` 中追加：

```javascript
test("content script targets current ChatGPT sidebar account and container", () => {
  const source = fs.readFileSync(path.join(__dirname, "../content-chatgpt.js"), "utf8");

  assert.match(source, /data-testid="accounts-profile-button"/);
  assert.match(source, /querySelector\("#history"\)/);
  assert.match(source, /#stage-slideover-sidebar/);
  assert.doesNotMatch(source, /#history \{\s*display: none !important;\s*\}/);
});
```

- [ ] **Step 2: 运行静态测试确认失败**

Run:

```bash
node --test tests/manifest.test.js
```

Expected: 新测试失败，因为当前内容脚本没有新版账号按钮选择器，也没有隐藏 `#stage-slideover-sidebar`。

- [ ] **Step 3: 实现账号显示名提取**

把 `content-chatgpt.js` 顶部账号选择器和账号函数改成：

```javascript
const PROVIDER = "chatgpt";
const HISTORY_LINK_SELECTOR = 'a[href^="/c/"], a[href^="https://chatgpt.com/c/"], a[href^="https://chat.openai.com/c/"]';
const ACCOUNT_SELECTORS = [
  '[data-testid="accounts-profile-button"]',
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

function normalizeAccountName(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/\s*(?:个人帐户|个人账户|Personal account).*$/i, "")
    .replace(/\s*[,，]?\s*(?:打开|Open).*$/i, "")
    .trim();
}

function scrapeAccount() {
  for (const selector of ACCOUNT_SELECTORS) {
    const element = document.querySelector(selector);
    if (!element) {
      continue;
    }

    const rawText = `${element.getAttribute("aria-label") || ""} ${element.textContent || ""}`;
    const email = extractEmail(rawText);
    if (email) {
      return email;
    }

    const displayName = normalizeAccountName(element.querySelector(".truncate")?.textContent);
    if (displayName) {
      return displayName;
    }

    const ariaName = normalizeAccountName(element.getAttribute("aria-label"));
    if (ariaName) {
      return ariaName;
    }
  }

  return "";
}
```

- [ ] **Step 4: 实现历史根节点抓取**

把 `scrapeVisibleHistory` 改成：

```javascript
function scrapeVisibleHistory() {
  const seen = new Set();
  const records = [];
  const historyRoot = document.querySelector("#history");
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
    records.push({
      title: normalizeTitle(link.textContent),
      url
    });
  });

  return records;
}
```

- [ ] **Step 5: 实现隐藏整个原生侧栏**

把 `hideNativeSidebar` 的 `style.textContent` 改成：

```javascript
  style.textContent = `
    #stage-slideover-sidebar,
    nav[aria-label="Chat history"],
    nav[aria-label="聊天记录"],
    aside:has(a[href^="/c/"]) {
      display: none !important;
    }
  `;
```

- [ ] **Step 6: 运行静态测试确认通过**

Run:

```bash
node --test tests/manifest.test.js
```

Expected: 全部 manifest/content 静态测试 PASS。

## Task 3: README 补充 Side Panel 左右位置说明

**Files:**
- Modify: `README.md:41-52`

- [ ] **Step 1: 修改本地加载说明**

在 `README.md` 的“本地加载插件”步骤 8 后加入一条：

```markdown
8. 如果希望插件显示在浏览器左侧，需要在 Chrome 的 Side Panel 设置中把面板位置切换到左侧；扩展只能打开原生 Side Panel，不能强制指定左右位置。
```

然后把原来的第 8 步及后续步骤顺延编号，确保最终步骤仍是有序列表。

- [ ] **Step 2: 检查 README 关键说明存在**

Run:

```bash
grep -n "不能强制指定左右位置" README.md
```

Expected: 输出包含新增说明所在行。

## Task 4: 全量验证

**Files:**
- Test: `tests/storage-model.test.js`
- Test: `tests/manifest.test.js`
- Test: `tests/sidepanel-static.test.js`

- [ ] **Step 1: 运行全部自动测试**

Run:

```bash
node --test tests/storage-model.test.js tests/manifest.test.js tests/sidepanel-static.test.js
```

Expected: 全部测试 PASS。

- [ ] **Step 2: 检查工作区差异**

Run:

```bash
git diff -- content-chatgpt.js storage-model.js tests/storage-model.test.js tests/manifest.test.js README.md
```

Expected: 差异只包含本计划列出的最小修改。

- [ ] **Step 3: 手动验证 Chrome 扩展**

在 Chrome 中重新加载未打包扩展后验证：

1. 打开 `https://chatgpt.com/` 并等待原始历史列表出现。
2. 打开 LLM Navigation Side Panel。
3. 确认 ChatGPT 原始侧栏整体消失，而不是只删除“最近”列表。
4. 确认 Side Panel 的“未分类”或自定义目录中出现原始 `#history` 内的对话。
5. 打开 DevTools 执行：

```javascript
chrome.storage.local.get(["folders", "activeAccounts"]).then(console.log)
```

Expected: `activeAccounts.chatgpt` 是类似 `Jianyang Zhao` 的显示名。

6. 在 ChatGPT 原始历史列表中删除或移除一个对话后刷新/重新同步。
7. 再次检查 storage 和 Side Panel。

Expected: 当前账号下该 URL 不再存在于本地 `folders` 的任何目录中；其他账号和其他 provider 的记录不受影响。

## 自审

- Spec coverage: 覆盖账号显示名抓取、隐藏整个原生侧栏、同步删除缺失记录、Side Panel 左右位置说明。
- Placeholder scan: 无 TBD、TODO、later、模糊测试步骤。
- Type consistency: 沿用现有 `provider/account/title/url` record 结构；没有引入新 storage schema。
- Scope check: 不改 Side Panel 架构，不做私有接口、不做主动滚动、不做页面内自绘左栏。
