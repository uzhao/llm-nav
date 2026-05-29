# 批量接入 5 个 provider 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 claude、deepseek、grok、kimi、perplexity 这 5 个 LLM provider 完整接入扩展(配置文件 + manifest + background + sidepanel + 测试同步),按照 `docs/adding-provider.md` 描述的流程批量执行。

**Architecture:** 完全照搬 `providers/chatgpt.js` 与 `providers/gemini.js` 的模板,每个新 provider 一个独立配置文件。Manifest / background / sidepanel.html / 3 处测试做机械同步。不动 `content-scraper.js` 共享框架(已确认 claude 用 `accountDisplaySubSelector` 直接抓显示名,无需扩展 `normalizeAccountName`)。

**Tech Stack:** Vanilla JS,Chrome Extension MV3,`node:test`,`node:vm` 沙箱加载 provider 注册表。

**参考 spec:** `docs/superpowers/specs/2026-05-28-add-5-providers-design.md`

---

## 选择器调研结果(已从 `sidebar/<name>.html` 抽出)

下表是各 provider 完整 `scraping` 字段定值,plan 的所有 Task 直接使用,不再二次研究。

### claude
- `accountSelectors`: `['[data-testid="user-menu-button"]']`
- `accountDisplaySubSelector`: `'.block.truncate.text-start'`
- `historyRootSelector`: `'nav[aria-label="Sidebar"]'`
- `historyLinkSelector`: `'a[href^="/chat/"]'`
- `historyPathPrefix`: `'/chat/'`
- `titleSubSelector`: `null`(链接内只有 textContent,scraper 自动 fallback)
- `hideSidebarSelector`: `'nav[aria-label="Sidebar"]'`
- `hideStyleId`: `'llmnav-hide-claude-sidebar'`

### deepseek
- `accountSelectors`: `['div:has(> div > img[src*="/user-avatar/"])']`(用 `:has()` 抓 `<img alt="" src="...user-avatar/...">` 的祖父 div,其 textContent 含用户名)
- `accountDisplaySubSelector`: `null`
- `historyRootSelector`: `'div:has(> a[href^="/a/chat/s/"])'`
- `historyLinkSelector`: `'a[href^="/a/chat/s/"]'`
- `historyPathPrefix`: `'/a/chat/s/'`
- `titleSubSelector`: `null`
- `hideSidebarSelector`: `'body > div:has(a[href^="/a/chat/s/"])'`(deepseek 用混淆类名,无稳定 ID/aria-label,只能用 `:has()` 兜底)
- `hideStyleId`: `'llmnav-hide-deepseek-sidebar'`
- **风险**:deepseek 整个 DOM 用混淆类名(`dc04ec1d`、`_2afd28d` 等),若发布后选择器变更,需用户在浏览器 inspect 后重填。

### grok
- `accountSelectors`: `['button:has(img[alt="pfp"])']`(底部账号按钮,textContent 含 `Li Qing uzhao@ucdavis.edu`,email 走 `extractEmail`)
- `accountDisplaySubSelector`: `null`
- `historyRootSelector`: `'div[data-variant="sidebar"]'`
- `historyLinkSelector`: `'a[href^="/c/"]'`
- `historyPathPrefix`: `'/c/'`
- `titleSubSelector`: `'span.truncate'`(链接内有 `<span class="...truncate">`,直接用 textContent 也可,但显式更稳)
- `hideSidebarSelector`: `'div[data-variant="sidebar"]'`
- `hideStyleId`: `'llmnav-hide-grok-sidebar'`

### kimi
- `accountSelectors`: `['.user-info-container']`
- `accountDisplaySubSelector`: `'.user-name'`
- `historyRootSelector`: `'aside.sidebar'`
- `historyLinkSelector`: `'a.chat-info-item[href^="/chat/"]'`(必须用 `.chat-info-item` 排除 `/chat/history` 这种非对话链接)
- `historyPathPrefix`: `'/chat/'`
- `titleSubSelector`: `'.chat-name'`
- `hideSidebarSelector`: `'aside.sidebar'`
- `hideStyleId`: `'llmnav-hide-kimi-sidebar'`

### perplexity
- `accountSelectors`: `['button:has(img[alt="用户头像"])', 'button:has(img[alt="User avatar"])']`(中英文双兜底)
- `accountDisplaySubSelector`: `'.font-sans.truncate'`(button 内含 `Jianyang Zhao` 的 div)
- `historyRootSelector`: `'nav[aria-label="主导航"], nav[aria-label="Main navigation"]'`
- `historyLinkSelector`: `'a[href^="/search/"]'`
- `historyPathPrefix`: `'/search/'`
- `titleSubSelector`: `null`(scraper 优先用 `aria-label`,perplexity 链接 `aria-label` 就是标题)
- `hideSidebarSelector`: `'nav[aria-label="主导航"], nav[aria-label="Main navigation"]'`
- `hideStyleId`: `'llmnav-hide-perplexity-sidebar'`

---

## 任务清单

### Task 1: 把 5 个新 provider 名加进 providers.test.js 的 REGISTERED_NAMES,确认 fail

**Files:**
- Modify: `tests/providers.test.js:25`

- [ ] **Step 1: 修改 `REGISTERED_NAMES` 数组**

把第 25 行从:
```javascript
const REGISTERED_NAMES = ["chatgpt", "gemini"];
```
改为:
```javascript
const REGISTERED_NAMES = ["chatgpt", "gemini", "claude", "deepseek", "grok", "kimi", "perplexity"];
```

- [ ] **Step 2: 跑测试确认新 provider 的测试 fail**

Run: `node --test tests/providers.test.js`
Expected: 15 个新测试 fail(每个新 provider 3 个,共 15),原因是 `loadProvider` 读不到 `providers/<name>.js` 文件,抛 `ENOENT`。

- [ ] **Step 3: 不 commit,直接进 Task 2**

---

### Task 2: 创建 `providers/claude.js`

**Files:**
- Create: `providers/claude.js`

- [ ] **Step 1: 写文件**

```javascript
(function (root) {
  const config = {
    name: "claude",
    origins: ["https://claude.ai"],
    matches: ["https://claude.ai/*"],
    newChatUrl: "https://claude.ai/new",
    label: "Claude",
    badge: { letter: "C", color: "#cc785c" },
    scraping: {
      accountSelectors: ['[data-testid="user-menu-button"]'],
      accountDisplaySubSelector: ".block.truncate.text-start",
      historyRootSelector: 'nav[aria-label="Sidebar"]',
      historyLinkSelector: 'a[href^="/chat/"]',
      historyPathPrefix: "/chat/",
      titleSubSelector: null,
      hideSidebarSelector: 'nav[aria-label="Sidebar"]',
      hideStyleId: "llmnav-hide-claude-sidebar"
    }
  };

  root.LLMNavProvider = config;
  root.LLMNavProviders = root.LLMNavProviders || {};
  root.LLMNavProviders[config.name] = config;
})(typeof self !== "undefined" ? self : globalThis);
```

- [ ] **Step 2: 跑 claude 相关测试,确认 pass**

Run: `node --test tests/providers.test.js`
Expected: claude 的 3 个测试 pass,其余 4 个 provider 的 12 个测试仍 fail。

---

### Task 3: 创建 `providers/deepseek.js`

**Files:**
- Create: `providers/deepseek.js`

- [ ] **Step 1: 写文件**

```javascript
(function (root) {
  const config = {
    name: "deepseek",
    origins: ["https://chat.deepseek.com"],
    matches: ["https://chat.deepseek.com/*"],
    newChatUrl: "https://chat.deepseek.com/",
    label: "DeepSeek",
    badge: { letter: "D", color: "#4d6bfe" },
    scraping: {
      accountSelectors: ['div:has(> div > img[src*="/user-avatar/"])'],
      accountDisplaySubSelector: null,
      historyRootSelector: 'div:has(> a[href^="/a/chat/s/"])',
      historyLinkSelector: 'a[href^="/a/chat/s/"]',
      historyPathPrefix: "/a/chat/s/",
      titleSubSelector: null,
      hideSidebarSelector: 'body > div:has(a[href^="/a/chat/s/"])',
      hideStyleId: "llmnav-hide-deepseek-sidebar"
    }
  };

  root.LLMNavProvider = config;
  root.LLMNavProviders = root.LLMNavProviders || {};
  root.LLMNavProviders[config.name] = config;
})(typeof self !== "undefined" ? self : globalThis);
```

- [ ] **Step 2: 跑测试**

Run: `node --test tests/providers.test.js`
Expected: claude + deepseek 6 个测试 pass,其余 9 个 fail。

---

### Task 4: 创建 `providers/grok.js`

**Files:**
- Create: `providers/grok.js`

- [ ] **Step 1: 写文件**

```javascript
(function (root) {
  const config = {
    name: "grok",
    origins: ["https://grok.com"],
    matches: ["https://grok.com/*"],
    newChatUrl: "https://grok.com/",
    label: "Grok",
    badge: { letter: "G", color: "#000000" },
    scraping: {
      accountSelectors: ['button:has(img[alt="pfp"])'],
      accountDisplaySubSelector: null,
      historyRootSelector: 'div[data-variant="sidebar"]',
      historyLinkSelector: 'a[href^="/c/"]',
      historyPathPrefix: "/c/",
      titleSubSelector: "span.truncate",
      hideSidebarSelector: 'div[data-variant="sidebar"]',
      hideStyleId: "llmnav-hide-grok-sidebar"
    }
  };

  root.LLMNavProvider = config;
  root.LLMNavProviders = root.LLMNavProviders || {};
  root.LLMNavProviders[config.name] = config;
})(typeof self !== "undefined" ? self : globalThis);
```

- [ ] **Step 2: 跑测试**

Run: `node --test tests/providers.test.js`
Expected: claude + deepseek + grok 9 个测试 pass。

---

### Task 5: 创建 `providers/kimi.js`

**Files:**
- Create: `providers/kimi.js`

- [ ] **Step 1: 写文件**

```javascript
(function (root) {
  const config = {
    name: "kimi",
    origins: ["https://www.kimi.com"],
    matches: ["https://www.kimi.com/*"],
    newChatUrl: "https://www.kimi.com/?chat_enter_method=new_chat",
    label: "Kimi",
    badge: { letter: "K", color: "#1B83FB" },
    scraping: {
      accountSelectors: [".user-info-container"],
      accountDisplaySubSelector: ".user-name",
      historyRootSelector: "aside.sidebar",
      historyLinkSelector: 'a.chat-info-item[href^="/chat/"]',
      historyPathPrefix: "/chat/",
      titleSubSelector: ".chat-name",
      hideSidebarSelector: "aside.sidebar",
      hideStyleId: "llmnav-hide-kimi-sidebar"
    }
  };

  root.LLMNavProvider = config;
  root.LLMNavProviders = root.LLMNavProviders || {};
  root.LLMNavProviders[config.name] = config;
})(typeof self !== "undefined" ? self : globalThis);
```

- [ ] **Step 2: 跑测试**

Run: `node --test tests/providers.test.js`
Expected: 4 个 provider 共 12 个测试 pass。

---

### Task 6: 创建 `providers/perplexity.js`

**Files:**
- Create: `providers/perplexity.js`

- [ ] **Step 1: 写文件**

```javascript
(function (root) {
  const config = {
    name: "perplexity",
    origins: ["https://www.perplexity.ai"],
    matches: ["https://www.perplexity.ai/*"],
    newChatUrl: "https://www.perplexity.ai/",
    label: "Perplexity",
    badge: { letter: "P", color: "#20808d" },
    scraping: {
      accountSelectors: ['button:has(img[alt="用户头像"])', 'button:has(img[alt="User avatar"])'],
      accountDisplaySubSelector: ".font-sans.truncate",
      historyRootSelector: 'nav[aria-label="主导航"], nav[aria-label="Main navigation"]',
      historyLinkSelector: 'a[href^="/search/"]',
      historyPathPrefix: "/search/",
      titleSubSelector: null,
      hideSidebarSelector: 'nav[aria-label="主导航"], nav[aria-label="Main navigation"]',
      hideStyleId: "llmnav-hide-perplexity-sidebar"
    }
  };

  root.LLMNavProvider = config;
  root.LLMNavProviders = root.LLMNavProviders || {};
  root.LLMNavProviders[config.name] = config;
})(typeof self !== "undefined" ? self : globalThis);
```

- [ ] **Step 2: 跑测试,确认 providers.test.js 全部 pass(合并测试除外)**

Run: `node --test tests/providers.test.js`
Expected: 7 个 provider × 3 = 21 个 per-provider 测试全 pass。**但合并测试(`LLMNavProviders 在多次加载后能合并多个 provider`)仍 fail** —— 只加载了 chatgpt + gemini,断言期望只有 2 个 key。

---

### Task 7: 更新 `tests/providers.test.js` 合并测试,跑全文件,commit 全部 7 个 provider

**Files:**
- Modify: `tests/providers.test.js:60-67`

- [ ] **Step 1: 修改合并测试**

把第 60-67 行改为:

```javascript
test("LLMNavProviders 在多次加载后能合并多个 provider", () => {
  const context = { self: {} };
  ["chatgpt", "gemini", "claude", "deepseek", "grok", "kimi", "perplexity"].forEach((name) => {
    const source = fs.readFileSync(path.join(__dirname, `../providers/${name}.js`), "utf8");
    vm.runInNewContext(source, context);
  });
  assert.deepEqual(
    Object.keys(context.self.LLMNavProviders).sort(),
    ["chatgpt", "claude", "deepseek", "gemini", "grok", "kimi", "perplexity"]
  );
});
```

- [ ] **Step 2: 跑全文件确认 pass**

Run: `node --test tests/providers.test.js`
Expected: 22 个测试全 pass(7 provider × 3 per-provider + 1 合并)。

- [ ] **Step 3: Commit**

```bash
git add providers/claude.js providers/deepseek.js providers/grok.js providers/kimi.js providers/perplexity.js tests/providers.test.js
git commit -m "$(cat <<'EOF'
feat(providers): add claude, deepseek, grok, kimi, perplexity configs

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: 更新 `manifest.json`(host_permissions + content_scripts)

**Files:**
- Modify: `manifest.json:7-32`

- [ ] **Step 1: 修改文件**

(`tests/manifest.test.js` 的 `loadProviderRegistry` 当前还只加载 chatgpt+gemini,所以"manifest 与注册表同步"系列测试此刻还能 pass。Task 9 才会把 registry 扩到 7 个 provider。这里先直接更新 manifest,跳过中间状态的测试验证。)

把整个文件改为:

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
    "https://gemini.google.com/*",
    "https://claude.ai/*",
    "https://chat.deepseek.com/*",
    "https://grok.com/*",
    "https://www.kimi.com/*",
    "https://www.perplexity.ai/*"
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
    },
    {
      "matches": ["https://claude.ai/*"],
      "js": ["providers/claude.js", "content-scraper.js"],
      "run_at": "document_idle"
    },
    {
      "matches": ["https://chat.deepseek.com/*"],
      "js": ["providers/deepseek.js", "content-scraper.js"],
      "run_at": "document_idle"
    },
    {
      "matches": ["https://grok.com/*"],
      "js": ["providers/grok.js", "content-scraper.js"],
      "run_at": "document_idle"
    },
    {
      "matches": ["https://www.kimi.com/*"],
      "js": ["providers/kimi.js", "content-scraper.js"],
      "run_at": "document_idle"
    },
    {
      "matches": ["https://www.perplexity.ai/*"],
      "js": ["providers/perplexity.js", "content-scraper.js"],
      "run_at": "document_idle"
    }
  ]
}
```

注意:`description` 字段保留原文不动(spec 已明确,本次不更新)。

- [ ] **Step 2: 不在此处跑测试,直接进 Task 9**

manifest 已扩 host/scripts,background 与 test 文件待 Task 9 同步,完成后一起跑 manifest.test.js 验证。

---

### Task 9: 更新 `background.js` + `tests/manifest.test.js`,commit

**Files:**
- Modify: `background.js:2`
- Modify: `tests/manifest.test.js:11-16` (`loadProviderRegistry`)
- Modify: `tests/manifest.test.js:73` (`importScripts` regex)

- [ ] **Step 1: 改 `background.js`**

第 2 行从:
```javascript
importScripts("providers/chatgpt.js", "providers/gemini.js");
```
改为:
```javascript
importScripts(
  "providers/chatgpt.js",
  "providers/gemini.js",
  "providers/claude.js",
  "providers/deepseek.js",
  "providers/grok.js",
  "providers/kimi.js",
  "providers/perplexity.js"
);
```

- [ ] **Step 2: 改 `tests/manifest.test.js` 的 `loadProviderRegistry`**

第 11-16 行:

```javascript
function loadProviderRegistry() {
  const context = { self: {} };
  ["chatgpt", "gemini", "claude", "deepseek", "grok", "kimi", "perplexity"].forEach((name) => {
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, `../providers/${name}.js`), "utf8"), context);
  });
  return context.self.LLMNavProviders;
}
```

- [ ] **Step 3: 改 `tests/manifest.test.js` 的 importScripts 正则**

第 73 行从:
```javascript
assert.match(source, /importScripts\("providers\/chatgpt\.js",\s*"providers\/gemini\.js"\)/);
```
改为:
```javascript
assert.match(source, /importScripts\([\s\S]*?"providers\/chatgpt\.js"[\s\S]*?"providers\/gemini\.js"[\s\S]*?"providers\/claude\.js"[\s\S]*?"providers\/deepseek\.js"[\s\S]*?"providers\/grok\.js"[\s\S]*?"providers\/kimi\.js"[\s\S]*?"providers\/perplexity\.js"[\s\S]*?\)/);
```

- [ ] **Step 4: 跑 manifest.test.js 确认全 pass**

Run: `node --test tests/manifest.test.js`
Expected: 10 个测试全 pass。

- [ ] **Step 5: Commit**

```bash
git add manifest.json background.js tests/manifest.test.js
git commit -m "$(cat <<'EOF'
feat: wire 5 new providers into manifest and background

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: 更新 `sidepanel.html` + `tests/sidepanel-static.test.js`,commit

**Files:**
- Modify: `sidepanel.html:20-23`
- Modify: `tests/sidepanel-static.test.js:12-17` (`loadProviderRegistry`)
- Modify: `tests/sidepanel-static.test.js:19-34` (HTML 断言加 5 个 `assert.match`)
- Modify: `tests/sidepanel-static.test.js:282-348` (per-provider 新建按钮测试改为 7)

- [ ] **Step 1: 改 `sidepanel.html` 第 20-23 行**

```html
    <script src="providers/chatgpt.js"></script>
    <script src="providers/gemini.js"></script>
    <script src="providers/claude.js"></script>
    <script src="providers/deepseek.js"></script>
    <script src="providers/grok.js"></script>
    <script src="providers/kimi.js"></script>
    <script src="providers/perplexity.js"></script>
    <script src="storage-model.js"></script>
    <script src="sidepanel.js"></script>
```

- [ ] **Step 2: 改 `tests/sidepanel-static.test.js` 第 12-17 行**

```javascript
function loadProviderRegistry() {
  const context = { self: {} };
  ["chatgpt", "gemini", "claude", "deepseek", "grok", "kimi", "perplexity"].forEach((name) => {
    vm.runInNewContext(readFile(`providers/${name}.js`), context);
  });
  return context.self.LLMNavProviders;
}
```

- [ ] **Step 3: 改第一个测试(`sidepanel html 保留最简结构 + 加载 provider 注册表脚本`)断言**

在第 27 行 `assert.match(html, /providers\/gemini\.js/);` 之后插入 5 行:

```javascript
  assert.match(html, /providers\/claude\.js/);
  assert.match(html, /providers\/deepseek\.js/);
  assert.match(html, /providers\/grok\.js/);
  assert.match(html, /providers\/kimi\.js/);
  assert.match(html, /providers\/perplexity\.js/);
```

- [ ] **Step 4: 改最后一个测试(`sidepanel 通过注册表注入 per-provider 新建按钮`)**

把第 344-347 行从:
```javascript
  const buttons = elements.actions.children.filter((child) => child !== elements["show-folder-form"] && child !== elements["folder-form"]);
  assert.equal(buttons.length, 2);
  assert.ok(buttons.some((btn) => btn.textContent === "新建 ChatGPT 对话"));
  assert.ok(buttons.some((btn) => btn.textContent === "新建 Gemini 对话"));
```
改为:
```javascript
  const buttons = elements.actions.children.filter((child) => child !== elements["show-folder-form"] && child !== elements["folder-form"]);
  assert.equal(buttons.length, 7);
  ["ChatGPT", "Gemini", "Claude", "DeepSeek", "Grok", "Kimi", "Perplexity"].forEach((label) => {
    assert.ok(buttons.some((btn) => btn.textContent === `新建 ${label} 对话`), `缺少 ${label} 新建按钮`);
  });
```

- [ ] **Step 5: 跑 sidepanel-static.test.js 确认全 pass**

Run: `node --test tests/sidepanel-static.test.js`
Expected: 全 pass。

- [ ] **Step 6: Commit**

```bash
git add sidepanel.html tests/sidepanel-static.test.js
git commit -m "$(cat <<'EOF'
feat: register 5 new providers in sidepanel scripts

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: 跑全量测试 + 写手动验收说明

**Files:**
- (无文件改动,验证步骤)

- [ ] **Step 1: 跑全量测试**

Run: `node --test tests/*.test.js`
Expected: 全 pass。预期总数比之前 +18(providers.test.js +15,sidepanel-static.test.js +5 行断言但仍在原 7 个 test cases 内 → 不算新 test;manifest.test.js +5 host_permissions 与 +5 content_scripts 在已有循环里 → 不算新 test)。实际上 providers.test.js 增加 15 个 test(5 provider × 3),其它文件总数不变。

如果有任何 fail,定位并修复后再 commit。

- [ ] **Step 2: 写手动验收清单(只在 PR 描述里附,不入库)**

PR 描述里附以下表格(用户在浏览器中逐项核对):

| Provider | 加载扩展后打开站点 | 徽标字母 & 颜色 | 新建按钮跳转 | 历史抓取 | 侧边栏隐藏 |
|---|---|---|---|---|---|
| claude | https://claude.ai/ | C / 橙 #cc785c | claude.ai/new | ✓/✗ | ✓/✗ |
| deepseek | https://chat.deepseek.com/ | D / 蓝 #4d6bfe | chat.deepseek.com/ | ✓/✗ | ✓/✗ |
| grok | https://grok.com/ | G / 黑 | grok.com/ | ✓/✗ | ✓/✗ |
| kimi | https://www.kimi.com/ | K / 蓝 #1B83FB | kimi.com/?chat_enter_method=new_chat | ✓/✗ | ✓/✗ |
| perplexity | https://www.perplexity.ai/ | P / 青 #20808d | perplexity.ai/ | ✓/✗ | ✓/✗ |

回归检查:打开 ChatGPT 和 Gemini 各一次,确认它们仍正常工作。

- [ ] **Step 3: 如果验收发现某 provider 选择器失效**

最常见原因:站点 DOM 与 `sidebar/<name>.html` 快照不一致。处理:
- 用户在浏览器 F12 inspect 实际站点,定位正确的选择器
- 修改对应 `providers/<name>.js` 的 `scraping.*` 字段
- 重新加载扩展确认

特别提醒:**deepseek 用混淆类名,最可能需要调整**。

---

## 已知边界与回滚

- 任何一个 provider 接入失败不会影响其它 —— 5 个 provider 的 `providers/<name>.js` 互相独立,manifest/background/sidepanel 中各自占一行/一段。
- 单个 provider 回滚:从 `manifest.json` 的 `content_scripts` / `host_permissions`、`background.js` 的 `importScripts`、`sidepanel.html` 的 `<script>` 中各删除对应行,删除 `providers/<name>.js`,并把对应 provider 名从 3 处测试中移除。
- 不需要改 `content-scraper.js`(已确认 claude 用 accountDisplaySubSelector 直接抓显示名,其它 provider 用 email extractor 或 displayName 抓取均无需新 strip 规则)。
- URL 归一化保持现状(`url.search` 与 `url.hash` 清空)。kimi 链接带 `?chat_enter_method=history` 会被清空,只剩 `/chat/<uuid>`,符合预期。
