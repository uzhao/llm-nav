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
  ["chatgpt", "gemini", "claude", "deepseek", "grok", "kimi", "perplexity", "manus"].forEach((name) => {
    vm.runInNewContext(readFile(`providers/${name}.js`), context);
  });
  return context.self.LLMNavProviders;
}

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
  assert.doesNotMatch(html, /<script\s/i);
  assert.equal(/<h1\b/i.test(html), false);
  assert.equal(/账号邮箱/.test(html), false);
  assert.doesNotMatch(html, /id="new-chatgpt"/);
  assert.doesNotMatch(html, /id="new-gemini"/);
  assert.doesNotMatch(html, /id="show-folder-form"/);
});

test("sidepanel script 通过注册表渲染按钮、徽标与文案", () => {
  const script = readFile("sidepanel.js");

  assert.match(script, /createFolder/);
  assert.match(script, /dragstart/);
  assert.match(script, /drop/);
  assert.match(script, /chrome\.tabs\.update/);
  assert.match(script, /chrome\.runtime\.onMessage\.addListener/);
  assert.match(script, /chrome\.storage\.onChanged\.addListener/);
  assert.match(script, /event\.dataTransfer\.setData/);
  assert.match(script, /provider: record\.provider/);
  assert.match(script, /account: record\.account/);
  assert.match(script, /moveConversation\(state, data\.provider, data\.url, targetFolder, data\.account\)/);
  assert.doesNotMatch(script, /renderNewChatButtons/);
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
  assert.match(css, /:host\s*\{/);
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

  assert.match(css, /\.folder-form button\s*{[^}]*font-family:\s*"Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif;[^}]*font-size:\s*13px;[^}]*line-height:\s*17px;[^}]*font-weight:\s*400;/);
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
      getElementById(id) { return elements[id] || createElement(); }
    },
    LLMNavModel: model
  };

  vm.runInNewContext(source, context);
  await domContentLoadedListener();
  assert.equal(elements.folders.children.length, 2);

  immediateStorage = false;
  messageListeners[0]({ type: "llmnav:storageUpdated" });
  messageListeners[0]({ type: "llmnav:storageUpdated" });
  assert.equal(pendingStorageGets.length, 2);

  pendingStorageGets[1]();
  await flushPromises();
  pendingStorageGets[0]();
  await flushPromises();

  assert.equal(elements.folders.children.length, 2);
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
      getElementById(id) { return elements[id] || createElement(); }
    },
    LLMNavModel: model
  };

  vm.runInNewContext(source, context);
  await context.window.LLMNavSidebar.mount(context.document, {});

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

test("sidepanel 主按钮文字跟随启用的 provider 与当前页面状态", async () => {
  const source = readFile("sidepanel.js");
  const providers = loadProviderRegistry();
  let domContentLoadedListener = null;
  const storedState = {
    folders: { unclassified: [], archived: [] },
    activeAccounts: {},
    settings: {
      defaultProvider: "auto",
      enabledProviders: ["chatgpt", "gemini", "claude", "deepseek", "grok", "kimi", "perplexity", "manus"],
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
  await context.window.LLMNavSidebar.mount(context.document, {
    pageState: { supported: true, provider: "gemini", hasAccount: true, account: "u@example.com", hasHistory: true }
  });

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
      enabledQuickActions: ["gemini.notebooks", "chatgpt.images"]
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

test("sidepanel script 包含目录重命名逻辑", () => {
  const script = readFile("sidepanel.js");

  assert.match(script, /renameFolder/);
  assert.match(script, /folder-action.*rename/);
  assert.match(script, /folder-rename-input/);
});

test("sidepanel script 包含目录删除逻辑", () => {
  const script = readFile("sidepanel.js");

  assert.match(script, /deleteFolder/);
  assert.match(script, /folder-action-delete/);
  assert.match(script, /window\.confirm/);
});

test("sidepanel script 包含折叠状态切换逻辑", () => {
  const script = readFile("sidepanel.js");

  assert.match(script, /toggleCollapse/);
  assert.match(script, /llmnav-collapsed/);
  assert.match(script, /__collapseStorage/);
});
