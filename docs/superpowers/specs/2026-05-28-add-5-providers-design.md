# 批量接入 5 个 provider 设计

日期:2026-05-28

## 背景与目标

`docs/adding-provider.md` 已经把单个 provider 的接入流程固化为 7 步。本次按该流程批量接入 5 个新 provider:**claude、deepseek、grok、kimi、perplexity**。

`sidebar/` 目录下已有 6 个目标站点的离线 DOM 快照可供 grep 选择器。其中 `yuanbao.html` 显示元宝用 `<div data-item-id>` + JS 路由,没有 `<a href>` 链接,与现有 scraper 框架不兼容,**本次不接入元宝**。

本设计的目标是:走通 `docs/adding-provider.md` 描述的 4 处生产代码 + 3 处测试同步,不动 `content-scraper.js` 共享框架。

## 范围

### 本次包含

- 新增 5 个 provider 配置文件:`providers/{claude,deepseek,grok,kimi,perplexity}.js`。
- `manifest.json`:`host_permissions` 加 5 个 origin,`content_scripts` 加 5 个 entry。
- `background.js`:`importScripts(...)` 追加 5 个文件。
- `sidepanel.html`:`<script>` 块按既有顺序追加 5 行。
- 3 处测试同步:`providers.test.js`、`manifest.test.js`、`sidepanel-static.test.js`。
- 仅当快照中明显能看到账号文本后缀(如 "Switch account")时,才在 `content-scraper.js` 的 `normalizeAccountName` 中补 strip 规则。

### 本次不包含

- 不接入 yuanbao(元宝),原因如上。
- 不改 `content-scraper.js` 共享框架,除上述 `normalizeAccountName` 的微小补充。
- 不动 URL 归一化策略(`url.search` / `url.hash` 仍被清空),如有 provider 必须带 query 才能正确导航,留到后续迭代。
- 不滚动各 provider 的历史列表加载全量旧对话,仍仅抓当前可见。
- 不引入 provider 切换器、筛选、AI 分类等新 UX。

## 各 provider 字段总览

精确选择器在实现 plan 阶段对 `sidebar/<name>.html` 做 grep 后逐字段确认。下表为大致目标值。

| 字段 | claude | deepseek | grok | kimi | perplexity |
|---|---|---|---|---|---|
| origins | `https://claude.ai` | `https://chat.deepseek.com` | `https://grok.com` | `https://www.kimi.com` | `https://www.perplexity.ai` |
| matches | `https://claude.ai/*` | `https://chat.deepseek.com/*` | `https://grok.com/*` | `https://www.kimi.com/*` | `https://www.perplexity.ai/*` |
| newChatUrl | `https://claude.ai/new` | `https://chat.deepseek.com/` | `https://grok.com/` | `https://www.kimi.com/?chat_enter_method=new_chat` | `https://www.perplexity.ai/` |
| label | `Claude` | `DeepSeek` | `Grok` | `Kimi` | `Perplexity` |
| badge.letter | `C` | `D` | `G` | `K` | `P` |
| badge.color(品牌色,待最终确认) | `#cc785c` | `#4d6bfe` | `#000000` | `#1B83FB` | `#20808d` |
| historyPathPrefix | `/chat/` | `/a/chat/s/` | `/c/` | `/chat/` | `/search/` |
| hideStyleId | `llmnav-hide-claude-sidebar` | `llmnav-hide-deepseek-sidebar` | `llmnav-hide-grok-sidebar` | `llmnav-hide-kimi-sidebar` | `llmnav-hide-perplexity-sidebar` |

`scraping.{accountSelectors,accountDisplaySubSelector,historyRootSelector,historyLinkSelector,titleSubSelector,hideSidebarSelector}` 字段在 plan 阶段逐 provider 从快照中提取并落实。

### 关于 badge 颜色冲突

- `chatgpt` 已占用字母 `C`(绿色 `#10a37f`),`claude` 也用 `C`(橙色 `#cc785c`)。字母重复但配色不同,与 ChatGPT 历史一致,不修改。
- `gemini` 已占用 `G`(蓝色 `#4285f4`),`grok` 也用 `G`(黑色)。同上处理。
- 若实际显示时字母+颜色组合让用户混淆,后续可单独迭代徽标方案,不在本次范围。

## 变更清单

### 1. 新增 5 个 provider 文件

每个 `providers/<name>.js` 完全照搬 `chatgpt.js` 模板,只替换字段值。所有字段必填,`accountDisplaySubSelector` 与 `titleSubSelector` 允许为 `null`,其余 6 个 scraping 字段必须有具体选择器字符串。

### 2. `manifest.json`

```json
{
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
  "content_scripts": [
    /* 已有 chatgpt / gemini 两条不变 */
    { "matches": ["https://claude.ai/*"], "js": ["providers/claude.js", "content-scraper.js"], "run_at": "document_idle" },
    { "matches": ["https://chat.deepseek.com/*"], "js": ["providers/deepseek.js", "content-scraper.js"], "run_at": "document_idle" },
    { "matches": ["https://grok.com/*"], "js": ["providers/grok.js", "content-scraper.js"], "run_at": "document_idle" },
    { "matches": ["https://www.kimi.com/*"], "js": ["providers/kimi.js", "content-scraper.js"], "run_at": "document_idle" },
    { "matches": ["https://www.perplexity.ai/*"], "js": ["providers/perplexity.js", "content-scraper.js"], "run_at": "document_idle" }
  ]
}
```

`description` 字段是否更新(目前是「本地管理 ChatGPT、Gemini 对话入口」)不在本次范围;若需要更新由用户决定。

### 3. `background.js`

第 2 行 `importScripts(...)` 追加 5 个新文件:

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

无需改其它逻辑(`listProviders()` 自动读注册表)。

### 4. `sidepanel.html`

`</body>` 前 `<script>` 块按既有顺序追加 5 行,且必须排在 `sidepanel.js` 之前:

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

`sidepanel.js` 会自动:
- 顶部注入 5 个「新建 X 对话」按钮(每个 provider 一个)
- 对话徽标里使用各 provider 的 letter / color
- notice 文案里追加新 provider 名

### 5. 3 处测试

#### 5.1 `tests/providers.test.js`

```javascript
const REGISTERED_NAMES = ["chatgpt", "gemini", "claude", "deepseek", "grok", "kimi", "perplexity"];
```

合并测试加 5 行 `vm.runInNewContext(...)`,并把断言期望值改为完整 7 个名字的排序数组。

#### 5.2 `tests/manifest.test.js`

`loadProviderRegistry()` 内追加 5 行 `vm.runInNewContext(...)`,并更新 background importScripts 正则。

#### 5.3 `tests/sidepanel-static.test.js`

`loadProviderRegistry()` 内追加 5 行,HTML 断言追加 5 个 `assert.match(html, /providers\/<name>\.js/)`。

### 6. `normalizeAccountName`(条件性改动)

仅在快照中明显能看出账号文本后缀(如 Claude 已知的 "Switch account")时才补 strip 规则。Plan 阶段会扫描 5 个快照的账号区域文本,只为发现明显后缀的 provider 添加规则,其它留作后续迭代。

## 验证策略

### 自动化

- `node --test tests/*.test.js`,预期总数 +15(每加一个 provider 让 `providers.test.js` 的 `REGISTERED_NAMES.forEach` 自动 +3)。

### 手动

用户在 `chrome://extensions` 重新加载扩展后,**对每个新 provider 各执行一遍**:

1. 打开目标站点,触发 Side Panel。
2. 检查徽标显示正确字母与品牌色。
3. 检查「新建 X 对话」按钮存在且点击跳转正确。
4. 检查可见历史同步进 Side Panel 列表,标题与 URL 都正确。
5. 检查原生侧边栏被隐藏。
6. 切换到 ChatGPT 和 Gemini 各确认一次没有回归。

任何一个 provider 没通过手动验收都不算完成 —— 由用户决定是回滚该 provider、补 strip 规则,还是迭代调整选择器。

## 已知边界

- **快照 vs 真实站点**:`sidebar/*.html` 是 save-as 快照,可能不含动态 DOM(如悬浮才出现的菜单)。如果某个 provider 在真实站点的账号选择器或侧边栏选择器有动态变化,需要在手动验收时调整。
- **URL 归一化**:沿用现有行为,`url.search` 与 `url.hash` 都被清空。Kimi 的对话链接带 `?chat_enter_method=history`,清空后留下 `/chat/<uuid>`,符合现有归一化规则,无需特殊处理。
- **多账号切换**:沿用现有 `activeAccounts[provider]` 机制,新接入 provider 自动获得该能力。
- **badge 字母冲突**:`C` 已用于 ChatGPT、`G` 已用于 Gemini。本次新增的 Claude / Grok 复用同字母但配色不同。

## 风险与回滚

- **风险**:某 provider 的实际站点 DOM 与快照差异较大,导致 scraping 选择器失效。
- **回滚**:每个 provider 独立 —— 单个失效只需从 `manifest.json` 的 `content_scripts` / `host_permissions`、`background.js` 的 `importScripts`、`sidepanel.html` 的 `<script>` 中移除对应行,并删除对应 `providers/<name>.js` 与 3 处测试中的引用。其余 provider 不受影响。
