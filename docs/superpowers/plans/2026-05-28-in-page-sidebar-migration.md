# In-Page Sidebar 迁移实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Chrome Side Panel 宿主替换为 content script 在 LLM 页面里注入的 Shadow DOM sidebar,复用现有 [sidepanel.js](../../../sidepanel.js)/`html`/`css` 的渲染逻辑,加上折叠 UX,删 `background.js` + Chrome side panel 装配。

**Architecture:** [sidepanel.js](../../../sidepanel.js) 重构为可挂载到任意 root(`document` 或 `shadowRoot`)的模块,通过 `window.LLMNavSidebar.mount(root, options)` 暴露入口。Side panel 模式保留 DOMContentLoaded 自动挂载兜底,injected 模式由新 `injected-sidebar.js` 显式调用 mount。CSS 用 `adoptedStyleSheets` 注入,绕过 LLM 站点 CSP。

**Tech Stack:** Chrome MV3 content scripts、Shadow DOM、Constructable StyleSheets、`chrome.storage.local`、`localStorage`、原生 HTML/CSS/JS、Node `node:test` + `node:vm`。

**Spec:** [docs/superpowers/specs/2026-05-28-in-page-sidebar-migration-design.md](../specs/2026-05-28-in-page-sidebar-migration-design.md)

---

## 文件结构

- Modify: `sidepanel.js` — 重构暴露 `mountSidebar(root, options)`;`byId` 走闭包 root;`openUrl` 通过可注入的 `navigate`;增加折叠状态。Side panel 模式的 DOMContentLoaded 自动挂载保留。
- Modify: `sidepanel.html` — 删 `<script>` 标签,只剩 HTML 结构(为 shadow root 注入做准备)。
- Modify: `sidepanel.css` — `:root` → `:host`,新增折叠态 + 浮动 handle + 过渡动画。
- Create: `injected-sidebar.js` — content script。创建 `#llmnav-host`、attachShadow、fetch HTML/CSS、调 mount、MutationObserver、body push-margin 注入。
- Create: `tests/injected-sidebar.test.js` — 可独立测的折叠状态计算、host 幂等、margin CSS 文本生成。
- Modify: `manifest.json` — 增加 web_accessible_resources;每个 LLM provider 的 content_scripts 加 `storage-model.js`、`sidepanel.js`、`injected-sidebar.js`(过渡期保留 side_panel 字段)。
- Modify: `tests/manifest.test.js` — 调整断言。
- Modify: `tests/sidepanel-static.test.js` — 跟随 `mountSidebar` 接口变化。
- Modify: `content-scraper.js` — Task 8 临时改为直接写 storage,Task 9 整体合并到 `injected-sidebar.js` 并删除。
- Delete: `background.js`(Task 9)、`content-scraper.js`(Task 9)。

---

### Task 1: 重构 sidepanel.js — 暴露 `mountSidebar(root, options)`

**Files:**
- Modify: `sidepanel.js`
- Modify: `tests/sidepanel-static.test.js`

把 `sidepanel.js` 重构成"可挂载到任意 DOM root"的模块,但保留 DOMContentLoaded 自动挂载兜底(side panel 模式继续工作)。所有 `document.getElementById` 改为闭包 `byId(id)`,根据 `__root || document` 解析。新增 `window.LLMNavSidebar.mount(root, options)` 入口。

行为不变,这是纯结构重构。

- [ ] **Step 1: 调整一个静态测试以驱动 mount 接口**

In `tests/sidepanel-static.test.js`,找到 `"sidepanel 渲染混合 provider 记录并设置 inline badge 颜色"` 测试,把其中的:

```javascript
  vm.runInNewContext(source, context);
  await domContentLoadedListener();
```

替换为:

```javascript
  vm.runInNewContext(source, context);
  await context.window.LLMNavSidebar.mount(context.document, {});
```

并把 `context.window = { LLMNavProviders: providers };` 改成:

```javascript
const windowMock = { LLMNavProviders: providers };
const context = {
  window: windowMock,
  // ... 其余不变
};
```

(其余测试此 task 暂不调整 — 它们仍走 DOMContentLoaded 兜底)

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
node --test tests/sidepanel-static.test.js
```

Expected: 那一个被改的测试 FAIL,因 `context.window.LLMNavSidebar` 是 undefined。

- [ ] **Step 3: 重构 sidepanel.js 包成 IIFE,暴露 `LLMNavSidebar.mount`**

把 `sidepanel.js` 整个内容用 IIFE 包起来,头尾加上:

```javascript
(function () {
```

在文件末尾原 `function hideNotice() { ... }` 之后,加上:

```javascript

  if (typeof window !== "undefined") {
    window.LLMNavSidebar = { mount };
  }

  function mount(root, options) {
    return init({ ...(options || {}), root });
  }
})();
```

把模块顶层的 5 个 `let` 状态(`pageState`、`settings`、`collapsedFolders`、`renderSequence`)和 `FOLDER_LABELS` 移到 IIFE 内顶部,保持原顺序不变。

**`byId` 改为闭包 root 解析**:把

```javascript
function byId(id) {
  return document.getElementById(id);
}
```

改为:

```javascript
let __root = null;

function byId(id) {
  return (__root || document).getElementById(id);
}
```

**`init` 接受 options 参数,并设置 `__root`**:把

```javascript
document.addEventListener("DOMContentLoaded", init);

async function init() {
```

改为:

```javascript
document.addEventListener("DOMContentLoaded", () => init({}));

async function init(options) {
  __root = (options && options.root) || null;
```

**手动 review**:看一遍函数体,所有 `byId(...)` 调用都已经走闭包,所有 `document.createElement(...)` 保留不变(创建 orphan 元素后 appendChild 到 root,符合 shadow root 语义)。

- [ ] **Step 4: 运行测试确认通过**

Run:

```bash
node --test tests/sidepanel-static.test.js
```

Expected: 所有测试 PASS。

- [ ] **Step 5: 全量测试**

Run:

```bash
node --test tests/*.test.js
```

Expected: 全绿。

- [ ] **Step 6: 提交**

```bash
git add sidepanel.js tests/sidepanel-static.test.js
git commit -m "refactor(ui): expose sidepanel mountSidebar entry"
```

---

### Task 2: 抽象导航 — `openUrl` 通过可注入函数

**Files:**
- Modify: `sidepanel.js`

`openUrl` 当前用 `chrome.tabs.update`,只能在 side panel 上下文里跑。injected 模式下 content script 没有 `chrome.tabs` 权限,需要用 `window.location.href`。引入可注入的 `navigate(url)` 函数,默认根据 `location.protocol` 自动选择。

- [ ] **Step 1: 修改 sidepanel.js 中的 `openUrl` 和 `init`**

In `sidepanel.js`,找到 `function openUrl(url) { ... }` 块,替换为:

```javascript
let __navigate = null;

function openUrl(url) {
  (__navigate || defaultNavigate)(url);
}

function defaultNavigate(url) {
  if (typeof location !== "undefined" && location.protocol === "chrome-extension:") {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (tab && tab.id) {
        chrome.tabs.update(tab.id, { url });
      }
    });
  } else {
    window.location.href = url;
  }
}
```

在 `init` 中(`__root = ...` 那一行之后)加:

```javascript
  __navigate = (options && options.navigate) || null;
```

- [ ] **Step 2: 运行测试**

Run:

```bash
node --test tests/*.test.js
```

Expected: 仍全绿(没有测试断言 `openUrl` 的具体实现,只看效果)。

- [ ] **Step 3: 提交**

```bash
git add sidepanel.js
git commit -m "refactor(ui): make navigate injectable for cross-context use"
```

---

### Task 3: 折叠状态 — toggle button + localStorage adapter

**Files:**
- Modify: `sidepanel.js`
- Modify: `tests/sidepanel-static.test.js`

在 sidebar 顶部 actions 区,齿轮按钮左边加一个 `«` toggle button。点击切换折叠状态:写 localStorage(可注入的 adapter),在 host element 上加/删 `.llmnav-collapsed` class。

折叠态的视觉效果(浮动 handle、过渡动画)由 Task 4 CSS 实现 + Task 6 的 injected-sidebar.js 拼装。Task 3 只做"状态机 + 钩子"。

- [ ] **Step 1: 追加失败测试**

Append to `tests/sidepanel-static.test.js`:

```javascript
test("sidepanel script 包含折叠状态切换逻辑", () => {
  const script = readFile("sidepanel.js");

  assert.match(script, /toggleCollapse/);
  assert.match(script, /llmnav-collapsed/);
  assert.match(script, /__collapseStorage/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
node --test tests/sidepanel-static.test.js
```

Expected: FAIL,缺少 `toggleCollapse` 等关键字。

- [ ] **Step 3: 添加折叠 toggle 到 sidepanel.js**

In `sidepanel.js`,在 `let __navigate = null;` 之后,加:

```javascript
let __collapseStorage = null;
let __collapseHost = null;
```

在 `init` 函数体内,`__navigate = ...` 那一行之后,加:

```javascript
  __collapseStorage = (options && options.collapseStorage) || defaultCollapseStorage();
  __collapseHost = (options && options.collapseHost) || null;
  applyCollapseState(readCollapseState());
```

在 `defaultNavigate` 函数之后,加:

```javascript
function defaultCollapseStorage() {
  if (typeof localStorage === "undefined") {
    return { get: () => "0", set: () => {} };
  }
  return {
    get: () => localStorage.getItem("llmnav:sidebarCollapsed") || "0",
    set: (value) => localStorage.setItem("llmnav:sidebarCollapsed", value)
  };
}

function readCollapseState() {
  return __collapseStorage.get() === "1";
}

function applyCollapseState(collapsed) {
  if (!__collapseHost) return;
  if (collapsed) {
    __collapseHost.classList.add("llmnav-collapsed");
  } else {
    __collapseHost.classList.remove("llmnav-collapsed");
  }
}

function toggleCollapse() {
  const next = !readCollapseState();
  __collapseStorage.set(next ? "1" : "0");
  applyCollapseState(next);
}
```

在 `renderTopActions` 函数内,`const main = byId("new-chat-main");` 之前,加一段渲染 collapse 按钮的代码:

```javascript
  const settingsBtn = byId("settings-button");
  let collapseBtn = byId("collapse-button");
  if (!collapseBtn && settingsBtn && settingsBtn.parentNode) {
    collapseBtn = document.createElement("button");
    collapseBtn.id = "collapse-button";
    collapseBtn.className = "icon-button";
    collapseBtn.type = "button";
    collapseBtn.setAttribute("aria-label", "折叠侧栏");
    collapseBtn.title = "折叠";
    collapseBtn.textContent = "«";
    collapseBtn.onclick = toggleCollapse;
    settingsBtn.parentNode.insertBefore(collapseBtn, settingsBtn);
  }
```

- [ ] **Step 4: 运行测试**

Run:

```bash
node --test tests/sidepanel-static.test.js
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add sidepanel.js tests/sidepanel-static.test.js
git commit -m "feat(ui): collapse state machine with injectable storage"
```

---

### Task 4: CSS — `:root` → `:host` + 折叠/handle 样式 + 过渡

**Files:**
- Modify: `sidepanel.css`
- Modify: `tests/sidepanel-static.test.js`

`:root` 在 shadow root 内不生效;改 `:host`。同时新增折叠态相关样式、浮动 handle 样式、过渡动画。

注意:浮动 handle (`.llmnav-handle`) 不在 shadow root 内,它由 `injected-sidebar.js` 注入到宿主 document(因为折叠时 sidebar 滑出屏幕,handle 是唯一可见入口)。Task 4 暂时只在 sidepanel.css 里定义 host-内样式;handle 样式在 Task 6 由 injected-sidebar.js 注入到宿主 document。

- [ ] **Step 1: 调整 CSS 字体测试以接受 `:host`**

In `tests/sidepanel-static.test.js`,把:

```javascript
  assert.match(css, /font-family:\s*"Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif;/);
```

改为更宽松的(只查 font-family 字符串本身):

```javascript
  assert.match(css, /font-family:\s*"Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif;/);
  // host-mode 必须存在以适配 shadow root
  assert.match(css, /:host\s*\{/);
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
node --test tests/sidepanel-static.test.js
```

Expected: FAIL,缺少 `:host {`。

- [ ] **Step 3: 改 sidepanel.css**

In `sidepanel.css`,把开头的:

```css
:root {
  color-scheme: light;
  font-family: "Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif;
  font-size: 13px;
  line-height: 17px;
  font-weight: 400;
  color: rgb(31, 31, 31);
  -webkit-font-smoothing: antialiased;
}
```

替换为:

```css
:host,
:root {
  color-scheme: light;
  font-family: "Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif;
  font-size: 13px;
  line-height: 17px;
  font-weight: 400;
  color: rgb(31, 31, 31);
  -webkit-font-smoothing: antialiased;
}
```

在文件末尾追加:

```css
:host {
  display: block;
  width: 100%;
  height: 100%;
  background: #ffffff;
  transition: transform 200ms ease-out;
}

:host(.llmnav-collapsed) {
  transform: translateX(-100%);
}

#collapse-button {
  font-size: 14px;
}
```

- [ ] **Step 4: 运行测试**

Run:

```bash
node --test tests/sidepanel-static.test.js
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add sidepanel.css tests/sidepanel-static.test.js
git commit -m "feat(ui): host-scoped styles and collapse transition"
```

---

### Task 5: 移除 sidepanel.html 中的 `<script>` 标签

**Files:**
- Modify: `sidepanel.html`
- Modify: `tests/sidepanel-static.test.js`

shadow root 注入 sidepanel.html 时,`<script>` 标签不会被执行。脚本将由 manifest 的 content_scripts 在外层加载。把 sidepanel.html 里的 `<script>` 全部删掉。

注意:**side panel 模式仍然存在**(过渡期),所以脚本依然需要被加载。处理方法:把 sidepanel.html 改成不带 `<script>`,然后让 manifest 在 side panel 入口处通过别的方式注入这些脚本。

更简单的方案:**为 side panel 创建一个 wrapper HTML**(`sidepanel-host.html`)负责加载脚本;`sidepanel.html` 只剩 body 内容,被 shadow root 使用。

- [ ] **Step 1: 调整 HTML 结构测试**

In `tests/sidepanel-static.test.js`,找到 `"sidepanel html 含拆分按钮 + 设置浮层 + 目录区头骨架"` 测试,**删除**这几行:

```javascript
  assert.match(html, /providers\/chatgpt\.js/);
  assert.match(html, /providers\/gemini\.js/);
  assert.match(html, /providers\/claude\.js/);
  assert.match(html, /providers\/deepseek\.js/);
  assert.match(html, /providers\/grok\.js/);
  assert.match(html, /providers\/kimi\.js/);
  assert.match(html, /providers\/perplexity\.js/);
  assert.match(html, /storage-model\.js/);
  assert.match(html, /sidepanel\.js/);
```

替换为:

```javascript
  assert.doesNotMatch(html, /<script\s/i);
```

并新增一个 host 文件测试:

```javascript
test("sidepanel-host html 加载所有 provider 注册表脚本", () => {
  const html = readFile("sidepanel-host.html");
  assert.match(html, /providers\/chatgpt\.js/);
  assert.match(html, /providers\/gemini\.js/);
  assert.match(html, /providers\/claude\.js/);
  assert.match(html, /providers\/deepseek\.js/);
  assert.match(html, /providers\/grok\.js/);
  assert.match(html, /providers\/kimi\.js/);
  assert.match(html, /providers\/perplexity\.js/);
  assert.match(html, /storage-model\.js/);
  assert.match(html, /sidepanel\.js/);
  assert.match(html, /sidepanel\.html/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
node --test tests/sidepanel-static.test.js
```

Expected: FAIL,因为 `sidepanel.html` 仍含 `<script>`,且 `sidepanel-host.html` 不存在。

- [ ] **Step 3: 拆分 HTML 文件**

Create `sidepanel-host.html`:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="stylesheet" href="sidepanel.css">
  </head>
  <body>
    <div id="llmnav-host"></div>
    <script src="providers/chatgpt.js"></script>
    <script src="providers/gemini.js"></script>
    <script src="providers/claude.js"></script>
    <script src="providers/deepseek.js"></script>
    <script src="providers/grok.js"></script>
    <script src="providers/kimi.js"></script>
    <script src="providers/perplexity.js"></script>
    <script src="storage-model.js"></script>
    <script src="sidepanel.js"></script>
    <script>
      // Side panel 模式:fetch sidepanel.html 内容,注入到 #llmnav-host,然后 mount。
      // 此处必须等所有 above 脚本就绪。
      (async function () {
        const res = await fetch("sidepanel.html");
        const text = await res.text();
        const doc = new DOMParser().parseFromString(text, "text/html");
        const host = document.getElementById("llmnav-host");
        Array.from(doc.body.children).forEach((node) => host.appendChild(node));
        if (window.LLMNavSidebar && window.LLMNavSidebar.mount) {
          window.LLMNavSidebar.mount(host, {});
        }
      })();
    </script>
  </body>
</html>
```

Replace entire `sidepanel.html` with:

```html
<!doctype html>
<html lang="zh-CN">
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
  </body>
</html>
```

注意:`sidepanel.html` 现在是纯结构(无脚本、无 head 元数据),被 `sidepanel-host.html` (side panel 模式) 和 `injected-sidebar.js` (注入模式) 都 fetch + DOMParser 后塞进 host element。

- [ ] **Step 4: 改 manifest 让 side panel 指向 host 文件**

In `manifest.json`,把:

```json
  "side_panel": {
    "default_path": "sidepanel.html"
  },
```

改为:

```json
  "side_panel": {
    "default_path": "sidepanel-host.html"
  },
```

- [ ] **Step 5: 调整 manifest 测试**

In `tests/manifest.test.js`,找断言 `side_panel.default_path === "sidepanel.html"` 的那一行,改为:

```javascript
  assert.equal(manifest.side_panel.default_path, "sidepanel-host.html");
```

- [ ] **Step 6: 运行测试**

Run:

```bash
node --test tests/*.test.js
```

Expected: PASS。

- [ ] **Step 7: 手动加载扩展验证 side panel 仍可用**

Run: Chrome 扩展页刷新,打开 side panel。

Expected: side panel 内容显示和之前一样(顶部按钮、目录、设置浮层都正常)。如果 console 有 `Failed to fetch sidepanel.html`,检查 web_accessible_resources(Task 7 会加,此时可能需要先临时加上 — 或者把 fetch 改为同源 fetch 不需要 WAR)。

注意:`sidepanel-host.html` 和 `sidepanel.html` 同在 chrome-extension://<id>/ 下,fetch 同源不需要 WAR。

- [ ] **Step 8: 提交**

```bash
git add sidepanel.html sidepanel-host.html manifest.json tests/sidepanel-static.test.js tests/manifest.test.js
git commit -m "refactor(ui): split sidepanel into host shell and shadow-root template"
```

---

### Task 6: 创建 injected-sidebar.js + 测试

**Files:**
- Create: `injected-sidebar.js`
- Create: `tests/injected-sidebar.test.js`

新 content script 模块。负责:

1. 检查 `window.LLMNavProvider` 是否存在(provider config 已加载),否则 bail。
2. 检查页面是否已注入(`document.getElementById("llmnav-host")`),幂等。
3. 创建 `#llmnav-host` 元素,attachShadow(open mode)。
4. fetch `sidepanel.html` + `sidepanel.css`,把 HTML 解析后塞进 shadow root,CSS 用 `adoptedStyleSheets` 注入。
5. 注入宿主 document 的 push-margin + handle 样式(也用 `adoptedStyleSheets`)。
6. 注入浮动 handle 元素(展开按钮)。
7. 调 `window.LLMNavSidebar.mount(shadowRoot, options)`,传入:
   - `pageState: { supported: true, provider: <name>, hasAccount: ..., account: ..., hasHistory: ... }`
   - `navigate: (url) => { window.location.href = url; }`
   - `collapseHost: <host element>`
   - `collapseStorage: localStorage-backed adapter`
8. MutationObserver:发现 `#llmnav-host` 被移除时,重新注入。

- [ ] **Step 1: 写失败测试**

Create `tests/injected-sidebar.test.js`:

```javascript
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function readFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("injected-sidebar source loads sidepanel.html and sidepanel.css", () => {
  const source = readFile("injected-sidebar.js");
  assert.match(source, /sidepanel\.html/);
  assert.match(source, /sidepanel\.css/);
});

test("injected-sidebar uses Shadow DOM open mode", () => {
  const source = readFile("injected-sidebar.js");
  assert.match(source, /attachShadow\(\{\s*mode:\s*"open"\s*\}\)/);
});

test("injected-sidebar creates host with id llmnav-host", () => {
  const source = readFile("injected-sidebar.js");
  assert.match(source, /id\s*=\s*"llmnav-host"|"llmnav-host"/);
});

test("injected-sidebar bails when LLMNavProvider is missing", () => {
  const source = readFile("injected-sidebar.js");
  assert.match(source, /window\.LLMNavProvider/);
});

test("injected-sidebar uses adoptedStyleSheets for CSS", () => {
  const source = readFile("injected-sidebar.js");
  assert.match(source, /adoptedStyleSheets/);
});

test("injected-sidebar reads collapse state from localStorage", () => {
  const source = readFile("injected-sidebar.js");
  assert.match(source, /llmnav:sidebarCollapsed/);
});

test("injected-sidebar adjusts body margin via CSS string for push effect", () => {
  const source = readFile("injected-sidebar.js");
  assert.match(source, /margin-left/);
  assert.match(source, /min\(\s*360px,\s*22vw\s*\)/);
});

test("injected-sidebar reinjects on MutationObserver detecting host removal", () => {
  const source = readFile("injected-sidebar.js");
  assert.match(source, /MutationObserver/);
});

test("injected-sidebar passes provider config to mount as pageState", () => {
  const source = readFile("injected-sidebar.js");
  assert.match(source, /LLMNavSidebar\.mount/);
  assert.match(source, /pageState/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
node --test tests/injected-sidebar.test.js
```

Expected: FAIL,文件不存在。

- [ ] **Step 3: 创建 injected-sidebar.js**

Create `injected-sidebar.js`:

```javascript
(function () {
  if (typeof window === "undefined" || !window.LLMNavProvider) {
    return;
  }

  const provider = window.LLMNavProvider;
  const HOST_ID = "llmnav-host";
  const HANDLE_ID = "llmnav-handle";
  const COLLAPSE_KEY = "llmnav:sidebarCollapsed";

  let shadowRoot = null;
  let hostMargin = null;
  let observerStarted = false;

  function collapseStorage() {
    return {
      get: () => localStorage.getItem(COLLAPSE_KEY) || "0",
      set: (value) => localStorage.setItem(COLLAPSE_KEY, value)
    };
  }

  function isCollapsed() {
    return collapseStorage().get() === "1";
  }

  function buildHostMarginSheet() {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`
      body {
        margin-left: min(360px, 22vw) !important;
        transition: margin-left 200ms ease-out;
      }
      body.llmnav-collapsed {
        margin-left: 40px !important;
      }
      #${HANDLE_ID} {
        position: fixed;
        left: 0;
        top: 50%;
        transform: translateY(-50%);
        width: 40px;
        height: 40px;
        background: #ffffff;
        border: 1px solid #dadce0;
        border-radius: 0 8px 8px 0;
        cursor: pointer;
        display: none;
        align-items: center;
        justify-content: center;
        z-index: 2147483647;
        font-size: 16px;
        color: rgb(31, 31, 31);
      }
      body.llmnav-collapsed #${HANDLE_ID} {
        display: flex;
      }
      #${HOST_ID} {
        position: fixed;
        left: 0;
        top: 0;
        width: min(360px, 22vw);
        min-width: 260px;
        height: 100vh;
        z-index: 2147483646;
      }
      ${provider.scraping.hideSidebarSelector} {
        display: none !important;
      }
    `);
    return sheet;
  }

  async function fetchText(filename) {
    const res = await fetch(chrome.runtime.getURL(filename));
    return res.text();
  }

  async function buildShadowSheet() {
    const cssText = await fetchText("sidepanel.css");
    const sheet = new CSSStyleSheet();
    await sheet.replace(cssText);
    return sheet;
  }

  function applyCollapseClass() {
    if (isCollapsed()) {
      document.body.classList.add("llmnav-collapsed");
    } else {
      document.body.classList.remove("llmnav-collapsed");
    }
  }

  function buildHandle() {
    const handle = document.createElement("div");
    handle.id = HANDLE_ID;
    handle.setAttribute("aria-label", "展开侧栏");
    handle.title = "展开";
    handle.textContent = "»";
    handle.onclick = () => {
      collapseStorage().set("0");
      applyCollapseClass();
    };
    return handle;
  }

  async function injectOnce() {
    if (document.getElementById(HOST_ID)) {
      return;
    }

    if (!hostMargin) {
      hostMargin = buildHostMarginSheet();
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, hostMargin];
    }

    if (!document.getElementById(HANDLE_ID)) {
      document.body.appendChild(buildHandle());
    }

    applyCollapseClass();

    const host = document.createElement("div");
    host.id = HOST_ID;
    document.body.appendChild(host);

    shadowRoot = host.attachShadow({ mode: "open" });
    const sheet = await buildShadowSheet();
    shadowRoot.adoptedStyleSheets = [sheet];

    const html = await fetchText("sidepanel.html");
    const doc = new DOMParser().parseFromString(html, "text/html");
    Array.from(doc.body.children).forEach((node) => shadowRoot.appendChild(node));

    if (window.LLMNavSidebar && window.LLMNavSidebar.mount) {
      window.LLMNavSidebar.mount(shadowRoot, {
        pageState: {
          supported: true,
          provider: provider.name,
          hasAccount: false,
          account: "",
          hasHistory: false
        },
        navigate: (url) => {
          window.location.href = url;
        },
        collapseHost: document.body,
        collapseStorage: collapseStorage()
      });
    }
  }

  function startObserver() {
    if (observerStarted) return;
    observerStarted = true;
    const observer = new MutationObserver(() => {
      if (!document.getElementById(HOST_ID)) {
        injectOnce();
      }
    });
    observer.observe(document.body, { childList: true, subtree: false });
  }

  async function start() {
    await injectOnce();
    startObserver();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
```

- [ ] **Step 4: 运行测试**

Run:

```bash
node --test tests/injected-sidebar.test.js
```

Expected: PASS,9 个新测试都过。

- [ ] **Step 5: 全量测试**

Run:

```bash
node --test tests/*.test.js
```

Expected: 全绿。

- [ ] **Step 6: 提交**

```bash
git add injected-sidebar.js tests/injected-sidebar.test.js
git commit -m "feat(ui): create injected-sidebar content script with shadow DOM host"
```

---

### Task 7: Manifest — 加 web_accessible_resources + injected-sidebar 到 content_scripts(过渡期保留 side_panel)

**Files:**
- Modify: `manifest.json`
- Modify: `tests/manifest.test.js`

7 个 provider 的 content_scripts 条目都加上 `storage-model.js`、`sidepanel.js`、`injected-sidebar.js`(顺序: provider config → content-scraper → storage-model → sidepanel → injected-sidebar);新增 `web_accessible_resources` 让 LLM 站点的 page context 能 fetch `sidepanel.html` 和 `sidepanel.css`。`side_panel` 字段保留。

- [ ] **Step 1: 调整 manifest 测试**

In `tests/manifest.test.js`,**追加**:

```javascript
test("manifest 每个 LLM provider 的 content_scripts 加载 sidebar 完整依赖", () => {
  const manifest = readManifest();
  const providerNames = ["chatgpt", "gemini", "claude", "deepseek", "grok", "kimi", "perplexity"];
  providerNames.forEach((name) => {
    const entry = manifest.content_scripts.find((script) => script.js.includes(`providers/${name}.js`));
    assert.ok(entry, `缺少 ${name} content_scripts 条目`);
    assert.ok(entry.js.includes("storage-model.js"), `${name} 条目缺 storage-model.js`);
    assert.ok(entry.js.includes("sidepanel.js"), `${name} 条目缺 sidepanel.js`);
    assert.ok(entry.js.includes("injected-sidebar.js"), `${name} 条目缺 injected-sidebar.js`);
  });
});

test("manifest 声明 sidebar 模板和样式为 web_accessible_resources", () => {
  const manifest = readManifest();
  assert.ok(Array.isArray(manifest.web_accessible_resources), "缺 web_accessible_resources");
  const entry = manifest.web_accessible_resources.find((e) =>
    Array.isArray(e.resources) && e.resources.includes("sidepanel.html") && e.resources.includes("sidepanel.css")
  );
  assert.ok(entry, "缺 sidepanel.html / sidepanel.css 资源声明");
  ["https://chatgpt.com/*", "https://gemini.google.com/*", "https://claude.ai/*"].forEach((origin) => {
    assert.ok(entry.matches.includes(origin), `${origin} 不在 web_accessible_resources matches`);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
node --test tests/manifest.test.js
```

Expected: FAIL。

- [ ] **Step 3: 改 manifest.json**

Replace `manifest.json` with:

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
    "default_path": "sidepanel-host.html"
  },
  "action": {
    "default_title": "LLM Navigation"
  },
  "content_scripts": [
    {
      "matches": ["https://chatgpt.com/*", "https://chat.openai.com/*"],
      "js": ["providers/chatgpt.js", "content-scraper.js", "storage-model.js", "sidepanel.js", "injected-sidebar.js"],
      "run_at": "document_idle"
    },
    {
      "matches": ["https://gemini.google.com/*"],
      "js": ["providers/gemini.js", "content-scraper.js", "storage-model.js", "sidepanel.js", "injected-sidebar.js"],
      "run_at": "document_idle"
    },
    {
      "matches": ["https://claude.ai/*"],
      "js": ["providers/claude.js", "content-scraper.js", "storage-model.js", "sidepanel.js", "injected-sidebar.js"],
      "run_at": "document_idle"
    },
    {
      "matches": ["https://chat.deepseek.com/*"],
      "js": ["providers/deepseek.js", "content-scraper.js", "storage-model.js", "sidepanel.js", "injected-sidebar.js"],
      "run_at": "document_idle"
    },
    {
      "matches": ["https://grok.com/*"],
      "js": ["providers/grok.js", "content-scraper.js", "storage-model.js", "sidepanel.js", "injected-sidebar.js"],
      "run_at": "document_idle"
    },
    {
      "matches": ["https://www.kimi.com/*"],
      "js": ["providers/kimi.js", "content-scraper.js", "storage-model.js", "sidepanel.js", "injected-sidebar.js"],
      "run_at": "document_idle"
    },
    {
      "matches": ["https://www.perplexity.ai/*"],
      "js": ["providers/perplexity.js", "content-scraper.js", "storage-model.js", "sidepanel.js", "injected-sidebar.js"],
      "run_at": "document_idle"
    }
  ],
  "web_accessible_resources": [
    {
      "resources": ["sidepanel.html", "sidepanel.css"],
      "matches": [
        "https://chatgpt.com/*",
        "https://chat.openai.com/*",
        "https://gemini.google.com/*",
        "https://claude.ai/*",
        "https://chat.deepseek.com/*",
        "https://grok.com/*",
        "https://www.kimi.com/*",
        "https://www.perplexity.ai/*"
      ]
    }
  ]
}
```

- [ ] **Step 4: 运行测试**

Run:

```bash
node --test tests/*.test.js
```

Expected: 全绿。

- [ ] **Step 5: 手动验证 ChatGPT 注入(过渡期 ChatGPT 上 in-page sidebar + side panel 共存)**

Run: Chrome 扩展页刷新,打开 chatgpt.com。

Expected:
- ChatGPT 页面左侧出现 in-page sidebar(顶部 `⚙ [新建对话 ChatGPT ▾]`,目录区)
- ChatGPT 原生侧栏被隐藏
- body 被推开
- 折叠按钮 `«` 可见,点击折叠,handle `»` 出现
- 点 handle 重新展开
- Console 应没有 `Failed to fetch` 或 CSP 错误
- Side panel 仍然可以打开,内容和之前一样

如有问题,优先检查 console 错误信息。常见问题:
- CSP 阻止 `new CSSStyleSheet()`: 看是否需要 fallback 用 `<style>` 标签注入
- Shadow root 没正确渲染: 检查 `sidepanel.html` fetch 成功否

- [ ] **Step 6: 提交**

```bash
git add manifest.json tests/manifest.test.js
git commit -m "feat(ui): wire injected-sidebar content scripts and web resources"
```

---

### Task 8: content-scraper.js 改为直接写 storage(脱离 background)

**Files:**
- Modify: `content-scraper.js`

`content-scraper.js` 当前通过 `chrome.runtime.sendMessage` 发 `llmnav:visibleHistory` 给 background。改为直接调 `LLMNavModel.upsertVisibleConversations` + `chrome.storage.local.set`。

这一步独立提交,让 storage 写入路径不再依赖 background.js。

- [ ] **Step 1: 改 content-scraper.js 的 `sendVisibleHistory`**

In `content-scraper.js`,找到:

```javascript
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
```

替换为:

```javascript
  async function sendVisibleHistory() {
    const account = scrapeAccount();
    const records = scrapeVisibleHistory();
    hideNativeSidebar();
    try {
      const stored = await chrome.storage.local.get(["folders", "activeAccounts"]);
      const next = self.LLMNavModel.upsertVisibleConversations(
        { folders: stored.folders, activeAccounts: stored.activeAccounts },
        providerName,
        account,
        records
      );
      await chrome.storage.local.set({
        folders: next.folders,
        activeAccounts: next.activeAccounts
      });
    } catch (error) {
      void error;
    }
  }
```

- [ ] **Step 2: 运行测试**

Run:

```bash
node --test tests/*.test.js
```

Expected: 全绿。content-scraper 当前的测试(如果有)可能因 mock 行为变化而需要调整 — 跑一遍看看。

- [ ] **Step 3: 手动验证 ChatGPT 抓取写入路径**

Run: 重新加载扩展,打开 ChatGPT,在 service worker DevTools console 执行 `chrome.storage.local.get(["folders"])`。

Expected: 看到 `folders.unclassified` 中有 ChatGPT 对话记录,字段完整。

- [ ] **Step 4: 提交**

```bash
git add content-scraper.js
git commit -m "refactor(scraper): write storage directly without background"
```

---

### Task 9: 拆 side panel + 删除 background.js + content-scraper.js

**Files:**
- Modify: `manifest.json`
- Modify: `sidepanel.js`
- Modify: `injected-sidebar.js`
- Modify: `tests/manifest.test.js`
- Modify: `tests/sidepanel-static.test.js`
- Delete: `background.js`
- Delete: `content-scraper.js`
- Delete: `sidepanel-host.html`
- Modify: `tests/content-scraper.test.js`(如存在)— 整体删除或改为 injected-sidebar 覆盖

最终拆除:删 `side_panel` 字段、`sidePanel` 权限、`background.service_worker`。删 `background.js`、`content-scraper.js`、`sidepanel-host.html` 文件。把 content-scraper 的 scraping 函数(`scrapeAccount`、`scrapeVisibleHistory`、`pickTitle`、`normalizeHistoryUrl` 等)合并进 `injected-sidebar.js`,injected-sidebar 接管抓取。

- [ ] **Step 1: 调整 manifest 测试**

In `tests/manifest.test.js`,**删除**所有断言 `side_panel`、`sidePanel` 权限、`background.service_worker` 的测试,**新增**:

```javascript
test("manifest 不再声明 side panel / background / sidePanel 权限", () => {
  const manifest = readManifest();
  assert.equal(manifest.side_panel, undefined);
  assert.equal(manifest.background, undefined);
  assert.equal(manifest.permissions.includes("sidePanel"), false);
});

test("manifest content_scripts 不再加载 content-scraper", () => {
  const manifest = readManifest();
  manifest.content_scripts.forEach((entry) => {
    assert.equal(entry.js.includes("content-scraper.js"), false);
  });
});
```

确保旧的 `"manifest declares MV3 side panel shell"` 等测试已删除(它们将永远失败)。

- [ ] **Step 2: 改 manifest.json**

Replace `manifest.json` 中:
- 删除 `"background": { ... },` 块
- 删除 `"side_panel": { ... },` 块
- `permissions` 从 `["sidePanel", "storage", "tabs", "activeTab"]` 改为 `["storage", "tabs", "activeTab"]`
- 每个 content_scripts 条目的 `js` 数组里删除 `"content-scraper.js"`

最终 manifest.json:

```json
{
  "manifest_version": 3,
  "name": "LLM Navigation",
  "version": "0.1.0",
  "description": "本地管理 ChatGPT、Gemini 对话入口。",
  "permissions": ["storage", "tabs", "activeTab"],
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
  "action": {
    "default_title": "LLM Navigation"
  },
  "content_scripts": [
    {
      "matches": ["https://chatgpt.com/*", "https://chat.openai.com/*"],
      "js": ["providers/chatgpt.js", "storage-model.js", "sidepanel.js", "injected-sidebar.js"],
      "run_at": "document_idle"
    },
    {
      "matches": ["https://gemini.google.com/*"],
      "js": ["providers/gemini.js", "storage-model.js", "sidepanel.js", "injected-sidebar.js"],
      "run_at": "document_idle"
    },
    {
      "matches": ["https://claude.ai/*"],
      "js": ["providers/claude.js", "storage-model.js", "sidepanel.js", "injected-sidebar.js"],
      "run_at": "document_idle"
    },
    {
      "matches": ["https://chat.deepseek.com/*"],
      "js": ["providers/deepseek.js", "storage-model.js", "sidepanel.js", "injected-sidebar.js"],
      "run_at": "document_idle"
    },
    {
      "matches": ["https://grok.com/*"],
      "js": ["providers/grok.js", "storage-model.js", "sidepanel.js", "injected-sidebar.js"],
      "run_at": "document_idle"
    },
    {
      "matches": ["https://www.kimi.com/*"],
      "js": ["providers/kimi.js", "storage-model.js", "sidepanel.js", "injected-sidebar.js"],
      "run_at": "document_idle"
    },
    {
      "matches": ["https://www.perplexity.ai/*"],
      "js": ["providers/perplexity.js", "storage-model.js", "sidepanel.js", "injected-sidebar.js"],
      "run_at": "document_idle"
    }
  ],
  "web_accessible_resources": [
    {
      "resources": ["sidepanel.html", "sidepanel.css"],
      "matches": [
        "https://chatgpt.com/*",
        "https://chat.openai.com/*",
        "https://gemini.google.com/*",
        "https://claude.ai/*",
        "https://chat.deepseek.com/*",
        "https://grok.com/*",
        "https://www.kimi.com/*",
        "https://www.perplexity.ai/*"
      ]
    }
  ]
}
```

- [ ] **Step 3: 删 sidepanel.js 里对 `llmnav:getPageState` 的依赖**

In `sidepanel.js`,找到 `init` 函数里的:

```javascript
  pageState = await sendMessage({ type: "llmnav:getPageState" }) || { supported: false };
```

替换为:

```javascript
  if (options && options.pageState) {
    pageState = options.pageState;
  } else {
    pageState = (await sendMessage({ type: "llmnav:getPageState" })) || { supported: false };
  }
```

(injected 模式下 options 带 pageState;side panel 模式没有此 options,走旧路径 — 但 background.js 已删,getPageState 永远 timeout 后返回 null,所以 side panel 模式不再可用。这是预期 — side panel 已经废弃)

更彻底地:**直接删** sendMessage 调用,要求 options 必须带 pageState。但 `sidepanel-host.html` 也会 mount 而无 pageState — 所以下一步同时删 host 文件。

把这一行改为:

```javascript
  pageState = (options && options.pageState) || { supported: false };
```

- [ ] **Step 4: 把 content-scraper.js 的 scraping 逻辑合并进 injected-sidebar.js**

In `injected-sidebar.js`,在 IIFE 顶部 `const provider = window.LLMNavProvider;` 之后,加入 scraping 辅助函数(从 content-scraper.js 第 6-116 行原样移植):

```javascript
  const scraping = provider.scraping;
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
      .replace(/\s*[,，]?\s*(?:打开|Open).*$/i, "")
      .replace(/\s*\([^)]*@[^)]*\)\s*$/, "")
      .trim();
  }

  function scrapeAccount() {
    for (const selector of scraping.accountSelectors) {
      for (const element of document.querySelectorAll(selector)) {
        const rawText = `${element.getAttribute("aria-label") || ""} ${element.textContent || ""}`;
        const email = extractEmail(rawText);
        if (email) return email;

        if (scraping.accountDisplaySubSelector) {
          const node = element.querySelector(scraping.accountDisplaySubSelector);
          const displayName = normalizeAccountName(node ? node.textContent : "");
          if (displayName) return displayName;
        }

        const ariaName = normalizeAccountName(element.getAttribute("aria-label"));
        if (ariaName) return ariaName;
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
      if (!historyRoot && !isVisible(link)) return;

      const url = normalizeHistoryUrl(link.getAttribute("href"));
      if (!url || seen.has(url)) return;

      seen.add(url);
      records.push({ title: pickTitle(link), url });
    });

    return records;
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
    try {
      const url = new URL(href, location.origin);
      if (!url.pathname.startsWith(scraping.historyPathPrefix)) return "";
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

  async function syncVisibleHistory() {
    const account = scrapeAccount();
    const records = scrapeVisibleHistory();
    try {
      const stored = await chrome.storage.local.get(["folders", "activeAccounts"]);
      const next = window.LLMNavModel.upsertVisibleConversations(
        { folders: stored.folders, activeAccounts: stored.activeAccounts },
        provider.name,
        account,
        records
      );
      await chrome.storage.local.set({
        folders: next.folders,
        activeAccounts: next.activeAccounts
      });
    } catch (error) {
      void error;
    }
  }

  function scheduleSync() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncVisibleHistory, 500);
  }
```

注意:`hideNativeSidebar` 不再需要(injected-sidebar 的 `hostMargin` sheet 里已包含 hide-sidebar 规则)。

In `injected-sidebar.js` 的 `start` 函数,在 `startObserver()` 之后加:

```javascript
    syncVisibleHistory();
    window.addEventListener("focus", scheduleSync);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) scheduleSync();
    });
    const scrapeObserver = new MutationObserver(scheduleSync);
    scrapeObserver.observe(document.documentElement, { childList: true, subtree: true });
```

并把现有的 MutationObserver(只看 host 移除)区分一下,加 `// host watch` 注释。

- [ ] **Step 5: 删除文件**

```bash
git rm background.js content-scraper.js sidepanel-host.html
```

如果 `tests/content-scraper.test.js` 存在,同时删:

```bash
git rm tests/content-scraper.test.js
```

- [ ] **Step 6: 调整 sidepanel-static 测试 — 去掉 sidepanel-host.html 的断言**

In `tests/sidepanel-static.test.js`,**删除** `"sidepanel-host html 加载所有 provider 注册表脚本"` 测试(Task 5 加的)。

- [ ] **Step 7: 全量测试**

Run:

```bash
node --test tests/*.test.js
```

Expected: 全绿。

- [ ] **Step 8: 提交**

```bash
git add manifest.json sidepanel.js injected-sidebar.js tests/manifest.test.js tests/sidepanel-static.test.js
git commit -m "feat(ui): tear down side panel, merge scraper into injected-sidebar"
```

---

### Task 10: 端到端手动验证

**Files:**
- No file changes expected.

最终验证 7 个 LLM 站点上 in-page sidebar 的完整体验。这一步由用户在浏览器中执行,不能由 subagent 完成。

- [ ] **Step 1: 跑全量自动测试**

Run:

```bash
node --test tests/*.test.js
```

Expected: 所有测试通过。

- [ ] **Step 2: 重新加载扩展并清空 storage**

Run:
- Chrome 扩展管理页 → LLM Navigation → 刷新
- 在任意 LLM 页面 DevTools console 执行 `chrome.storage.local.clear()`

Expected:
- 扩展页**不再显示 side panel 入口**(在工具栏图标上,右键无 "Open side panel" 选项,或者该选项点击无反应)
- 也不再有 service worker(background.js 已删)

- [ ] **Step 3: ChatGPT 完整验证**

Run: 打开 chatgpt.com,等待加载。

Expected:
- 左侧出现我们的 in-page sidebar(宽度合理,约屏幕 22% 或 360px)
- ChatGPT 原生左侧栏被隐藏
- 顶部从左到右: `«` `⚙` `[新建对话 ChatGPT ▾]`
- 点齿轮 → 浮层弹出,3 段分别显示;再点齿轮 → 关闭
- 点 `«` → sidebar 滑出屏幕,左边缘出现 `»` handle
- 点 `»` handle → sidebar 滑入
- 刷新页面后,折叠状态保留
- 在 ChatGPT 新建一个对话,等待标题生成,刷新 → 新对话出现在"未分类"**头部**
- 创建自定义目录,拖一条对话进去 → 持久化生效
- 重命名、删除目录 UX 正常
- 切换不同 ChatGPT 对话(URL 变化),sidebar 不消失

- [ ] **Step 4: 其余 6 个 LLM 站点验证(简版)**

Run: 打开 gemini.google.com、claude.ai、chat.deepseek.com、grok.com、www.kimi.com、www.perplexity.ai。

Expected per site:
- in-page sidebar 注入成功
- 原生左侧栏被隐藏
- 抓取在 storage 中产生记录
- 折叠/展开按钮工作

- [ ] **Step 5: 跨 tab 同步验证**

Run: 同时打开两个 ChatGPT tab。

Expected:
- 在 A tab 改设置 → B tab 顶部按钮文字立即更新(由 chrome.storage.onChanged 驱动)
- 在 A tab 折叠 sidebar → B tab **不受影响**(localStorage 触发 storage 事件跨 tab,但我们没监听,所以 B tab 视觉独立)
- A tab 新建目录 → B tab 目录列表更新

- [ ] **Step 6: SPA 路由韧性**

Run: 在 ChatGPT 上切换不同对话(URL 变 `/c/xxx`),回到首页等等。

Expected: sidebar 始终存在,折叠状态稳定。

- [ ] **Step 7: 最终 git 检查**

Run:

```bash
git status --short
git log --oneline -12
```

Expected:
- `git status --short` 没有意外文件
- 最近提交看到 Task 1-9 的 9 个 commit

---

## 自检结果

- **Spec 覆盖**: Task 1 完成 sidepanel.js mount 接口;Task 2 抽象导航;Task 3 折叠状态;Task 4 CSS host scope + 动画;Task 5 HTML 拆分;Task 6 创建 injected-sidebar.js + 测试;Task 7 manifest 装配过渡期 in-page + side panel 共存;Task 8 content-scraper 改直接写 storage;Task 9 彻底拆除 side panel + 合并 scraper + 删除文件;Task 10 端到端手动验证。
- **占位语扫描**: 每个代码步骤给出完整替换文本。Task 6 的 injected-sidebar.js 代码完整,Task 9 的 scraping 合并代码逐字给出。无 TBD/TODO。
- **类型/命名一致性**: `LLMNavSidebar.mount(root, options)` 接口贯穿;options 字段 `pageState`、`navigate`、`collapseHost`、`collapseStorage` 在 Task 1/2/3 引入,Task 6 全部传入;CSS class `.llmnav-collapsed`、host id `llmnav-host`、handle id `llmnav-handle`、localStorage key `llmnav:sidebarCollapsed` 在 Task 3/4/6 之间一致。`injected-sidebar.js` 中 `provider.scraping.hideSidebarSelector` 与 `providers/*.js` 的字段一致(已有约定)。
