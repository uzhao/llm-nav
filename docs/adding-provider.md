# 接入新 provider

本扩展的所有 provider 元数据集中在 `providers/<name>.js`。接入一个新 provider(以下以 Claude 为例,真实接入时把 `claude` 换成实际名)需要改 4 处生产代码 + 3 处测试同步。

总耗时:熟悉本扩展后约 30 分钟,其中调研 DOM 选择器占大头。

---

## 步骤 1:写 `providers/claude.js`

复制 `providers/chatgpt.js` 作为模板。所有字段都必填(`titleSubSelector` 可以为 `null`,其余必须有值)。

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
      accountSelectors: [/* TODO,见步骤 6 */],
      accountDisplaySubSelector: null,
      historyRootSelector: "/* TODO */",
      historyLinkSelector: "/* TODO */",
      historyPathPrefix: "/chat/",
      titleSubSelector: null,
      hideSidebarSelector: "/* TODO */",
      hideStyleId: "llmnav-hide-claude-sidebar"
    }
  };

  root.LLMNavProvider = config;
  root.LLMNavProviders = root.LLMNavProviders || {};
  root.LLMNavProviders[config.name] = config;
})(typeof self !== "undefined" ? self : globalThis);
```

### 字段速查

| 字段 | 用途 | 例 |
|---|---|---|
| `name` | provider 标识(必须等于文件名,且全局唯一) | `"claude"` |
| `origins` | URL 解析时匹配的 origin 列表 | `["https://claude.ai"]` |
| `matches` | manifest `content_scripts.matches` 模式 | `["https://claude.ai/*"]` |
| `newChatUrl` | 「新建对话」按钮跳转 URL | `"https://claude.ai/new"` |
| `label` | UI 显示名(按钮文案、notice 文案) | `"Claude"` |
| `badge.letter` | 徽标字母(1 字符) | `"C"` |
| `badge.color` | 徽标背景色(品牌色,6 位 hex) | `"#cc785c"` |
| `scraping.accountSelectors` | 账号区域 DOM 选择器候选列表,从前往后尝试 | `['[data-testid="user-menu"]', ...]` |
| `scraping.accountDisplaySubSelector` | 账号元素内部的展示名子选择器,无则填 `null` | `".user-name"` |
| `scraping.historyRootSelector` | 历史列表根容器选择器(找不到时退化到 `document` + 可见性过滤) | `"nav[aria-label='Chat history']"` |
| `scraping.historyLinkSelector` | 历史链接选择器,会从根容器内查询 | `'a[href^="/chat/"]'` |
| `scraping.historyPathPrefix` | URL pathname 必须以此开头,否则跳过 | `"/chat/"` |
| `scraping.titleSubSelector` | 标题子节点选择器(`aria-label` 优先,然后此选择器,最后 `textContent`),无则 `null` | `".chat-title"` |
| `scraping.hideSidebarSelector` | 要隐藏的原生侧边栏选择器(可逗号分隔多个) | `"nav.sidebar"` |
| `scraping.hideStyleId` | 注入的 `<style>` 元素 id(必须以 `llmnav-hide-` 前缀,唯一) | `"llmnav-hide-claude-sidebar"` |

---

## 步骤 2:`manifest.json` 加 host 与 content_scripts

```json
{
  "host_permissions": [
    "https://chatgpt.com/*",
    "https://chat.openai.com/*",
    "https://gemini.google.com/*",
    "https://claude.ai/*"
  ],
  "content_scripts": [
    {
      "matches": ["https://claude.ai/*"],
      "js": ["providers/claude.js", "content-scraper.js"],
      "run_at": "document_idle"
    }
  ]
}
```

**顺序约束:** `js` 数组里 `providers/<name>.js` 必须在前(设置 `self.LLMNavProvider`),`content-scraper.js` 在后(读取并启动)。

---

## 步骤 3:`background.js` 加 importScripts

第 2 行 `importScripts(...)` 后追加新文件:

```javascript
importScripts("providers/chatgpt.js", "providers/gemini.js", "providers/claude.js");
```

不需要改其它任何逻辑 — `listProviders()` 会自动返回新条目。

---

## 步骤 4:`sidepanel.html` 加 `<script>` 标签

`</body>` 之前的 `<script>` 块按现有顺序追加:

```html
<script src="providers/chatgpt.js"></script>
<script src="providers/gemini.js"></script>
<script src="providers/claude.js"></script>
<script src="storage-model.js"></script>
<script src="sidepanel.js"></script>
```

`providers/*.js` 必须排在 `sidepanel.js` 之前(注册表先填后用)。`sidepanel.js` 会自动:
- 在顶部注入「新建 Claude 对话」按钮
- 在对话徽标里用 `claude` 的字母与品牌色
- 在 notice 不支持页面的文案里把 Claude 加进 `"打开 ChatGPT、Gemini、Claude 后..."`

---

## 步骤 5:同步 3 处测试

### 5.1 `tests/providers.test.js`

把新 provider 加进 `REGISTERED_NAMES`:

```javascript
const REGISTERED_NAMES = ["chatgpt", "gemini", "claude"];
```

合并测试也要加文件:

```javascript
test("LLMNavProviders 在多次加载后能合并多个 provider", () => {
  ...
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../providers/claude.js"), "utf8"), context);
  assert.deepEqual(Object.keys(context.self.LLMNavProviders).sort(), ["chatgpt", "claude", "gemini"]);
});
```

### 5.2 `tests/manifest.test.js`

`loadProviderRegistry()` 内追加一行:

```javascript
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../providers/claude.js"), "utf8"), context);
```

`manifest.test.js` 中的「background imports provider registry」断言可能也要更新正则(目前硬编码 `chatgpt.js, gemini.js`):

```javascript
assert.match(source, /importScripts\("providers\/chatgpt\.js",\s*"providers\/gemini\.js",\s*"providers\/claude\.js"\)/);
```

### 5.3 `tests/sidepanel-static.test.js`

`loadProviderRegistry()` 内追加同样一行。HTML 断言也要加 `providers/claude.js`:

```javascript
assert.match(html, /providers\/claude\.js/);
```

---

## 步骤 6:找正确的 DOM 选择器

`scraping.*` 是接入难点。流程:

1. **打开目标站点**,登录,确保有可见对话历史。
2. **F12 → Elements**,找到原生侧边栏的对话列表根节点 → 这是 `historyRootSelector`。
3. **在根节点里**找到任意对话链接,看 `<a href="...">` 的 pathname 模式 → 这是 `historyPathPrefix`(如 `/chat/`)。把链接选择器(如 `a[href^="/chat/"]`)填入 `historyLinkSelector`。
4. **看链接内部**:有没有 `aria-label`?如果有,scraper 会优先用 `aria-label` 作标题。如果没有,看链接内是否有专门的标题子节点(如 `<span class="chat-title">`),把那个选择器填到 `titleSubSelector`,否则填 `null`(scraper 会用 `textContent`)。
5. **找账号区域**(头像/邮箱位置):
   - 优先选 `aria-label` 含邮箱的元素(scraper 会自动抽 email)
   - 退到带 `data-testid` 或 stable class 的按钮
   - 把候选选择器列表填入 `accountSelectors`(从前往后尝试,匹配到第一个有效就返回)
   - 如果账号元素内有专门的展示名子节点(如 `<span class="user-name">张三</span>`),填到 `accountDisplaySubSelector`
6. **侧边栏隐藏**:找到原生侧边栏的最外层选择器(整段都要被隐藏),填到 `hideSidebarSelector`。多个用 `, ` 逗号分隔。

调研时可以用项目根的 `gemini.html`(在 `.gitignore`)作为参考 — 它是从 Gemini 实际页面 save-as 出来的 DOM 快照,可以离线 grep 选择器。

---

## 步骤 7:验证

```bash
node --test tests/*.test.js
```

预期:每加一个 provider,测试总数增加 3(providers.test.js 中 `REGISTERED_NAMES.forEach` 自动生成)。

然后:

1. `chrome://extensions` → 重新加载本扩展
2. 打开目标站点 → 触发 Side Panel
3. 检查:徽标显示正确字母与颜色;「新建 X 对话」按钮存在且点击跳转;可见历史同步到 Side Panel 列表;原生侧边栏被隐藏
4. 切到 ChatGPT 与 Gemini 各确认一次,没有回归

---

## 已知边界

- **账号识别**:`normalizeAccountName` 当前内置 ChatGPT 与 Gemini 两套 stripping 正则(`Personal account`、`打开`、`Google 账号:`、邮箱括号尾)。新 provider 若有自己的 aria-label 后缀模式(如 Claude 的「Switch account」),需要在 `content-scraper.js` 的 `normalizeAccountName` 里再加一行 `.replace(...)`,这是目前唯一需要碰共享框架的场景。
- **URL 归一化**:`url.search` 与 `url.hash` 都会被清空,以避免同一对话因带 query 参数(如 `?model=...`)被记为两条。若新 provider 的对话 URL 必须带 query 才能正确导航,本扩展暂不支持(需要新增 `keepSearch: true` 类似开关)。
- **多账号切换**:`activeAccounts[provider]` 仅记录最近一次同步看到的账号。切换账号后,旧账号的对话会被过滤显示(`filterFoldersAcrossProviders` 行为)。这是设计意图。
