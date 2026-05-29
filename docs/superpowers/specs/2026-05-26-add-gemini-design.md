# 接入 Gemini provider 设计

日期：2026-05-26

## 背景与目标

第一版 LLM navigation 以 ChatGPT-first 完成,但数据模型一直预留了 `provider` 字段以便后续接入。本次扩展把 Gemini 作为第二个 provider 接入,使插件能同时同步并管理 ChatGPT 与 Gemini 的可见对话。

设计原则继承第一版:做减法,不引入构建工具,不做搜索/标签/AI 分类;模型层已经 provider-aware,本次主要补齐 plumbing(content script、background 路由、manifest、UI),并在 sidepanel 增加跨 provider 展示能力。

## 范围

### 本次包含

- 新增 Gemini 内容脚本,抓取 `https://gemini.google.com/app/*` 下当前可见的对话历史与登录账号。
- `manifest.json` 增加 Gemini host 权限与 content_script。
- `background.js` 改为多 provider 路由(配置表驱动),支持任意已知 provider 上报。
- 侧边栏顶部把「新建对话」拆为两个独立按钮:「新建 ChatGPT 对话」「新建 Gemini 对话」。
- 侧边栏对话列表跨 provider 合并展示,每行前加一个圈状首字母徽标(C/G)区分 provider。
- 每个 provider 内仍按当前 activeAccount 隔离;抓不到账号时显示该 provider 全部本地记录并提示风险(沿用第一版策略)。
- 隐藏 Gemini 原生侧栏(`bard-sidenav`),与隐藏 ChatGPT 侧栏的体验一致。
- 跨 provider 拖拽:任意 provider 的对话都可拖入任意自定义目录,模型层无需改动。
- 同步与渲染竞态、上下文失效的健壮性策略沿用第一版补丁。

### 本次不包含

- 不做搜索、不做标签、不做 AI 自动分类。
- 不接入 Claude(待 Gemini 验证后,按相同模式再加)。
- 不滚动 Gemini 历史列表加载全量旧对话,仅抓当前可见。
- 不删除本地已有记录,除非该记录对应账号当前同步时已不在可见列表中(沿用 `upsertVisibleConversations` 既定行为)。
- 不在 sidepanel 中提供 provider 切换器或筛选(按 provider 隔离 = 列表徽标 + 顶部双按钮即可)。

## 用户体验

侧边栏顶部:

- 「新建 ChatGPT 对话」按钮,点击当前标签页跳到 `https://chatgpt.com/`。
- 「新建 Gemini 对话」按钮,点击当前标签页跳到 `https://gemini.google.com/app`。
- 「新建目录」按钮和原有表单不变,创建的目录可同时容纳两个 provider 的对话。

对话列表:

- 一份合并后的目录树,目录顺序仍是 `unclassified` → 自定义目录(按字母序) → `archived`。
- 每条对话行前加一个 20×20 圆形徽标:C(ChatGPT,绿底)、G(Gemini,蓝底),文字白色,字号略小于行文本。
- 同一目录内 ChatGPT 与 Gemini 对话混排,排序按插入顺序(沿用现状)。

账号与提示:

- 仍是「能抓到账号就按账号过滤,抓不到则展示该 provider 全部本地记录并提示」。
- notice 仅针对当前标签页所处的 provider;不在两个 provider 上同时显示提示。
- 不支持的页面文案改为「当前页面不是支持的 LLM 页面。打开 ChatGPT 或 Gemini 后可同步可见历史。」

## 技术设计

### 模块边界

| 模块 | 职责 | 改动 |
| --- | --- | --- |
| `manifest.json` | 声明权限、content_script | 加 Gemini host 与脚本 |
| `content-chatgpt.js` | ChatGPT 页面抓取 | 不变 |
| `content-gemini.js` | Gemini 页面抓取 | 新增,镜像 ChatGPT 版 |
| `background.js` | 接收上报、维护 providerState、按 active tab 派发 pageState | 重构为 provider 表驱动 |
| `storage-model.js` | 状态模型与查询 | 新增 `filterFoldersAcrossProviders` |
| `sidepanel.html` | 面板骨架 | 拆按钮、保留单一列表容器 |
| `sidepanel.js` | 渲染、交互 | 移除 `PROVIDER` 常量,改为跨 provider 渲染,加徽标 |
| `sidepanel.css` | 样式 | 加徽标样式,微调 conversation-row 布局 |

### content-gemini.js

镜像 `content-chatgpt.js`,差异如下:

- `PROVIDER = "gemini"`
- 账号抓取顺序:
  1. `a[gem-open-account-menu]` 的 `aria-label` 中提取 email(正则 `[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}`)
  2. 同元素内 `.mavatar-user-name` 文本(去多余空白)
  3. 整段 aria-label 去掉 `Google 账号：` 与括号内邮箱后的纯名(兜底)
- 历史抓取:
  - `conversations-list[data-test-id="all-conversations"]` 作为根容器;若拿不到,退化到 `document`。
  - 链接选择器:`a[href^="/app/"], a[href^="https://gemini.google.com/app/"]`
  - 标题优先 `aria-label`(对话原始标题),否则 `.title-text` 文本
  - URL 规范化:仅保留 `/app/<id>`,丢弃 hash 与 query
- 隐藏侧栏:`bard-sidenav { display: none !important }`,style id 用 `llmnav-hide-gemini-sidebar`,抓取完成后再隐藏(避免抓不到 DOM)。
- 上下文失效保护、MutationObserver 节流、visibilitychange/focus 重新同步:沿用 ChatGPT 版。

### manifest.json

```json
"host_permissions": [
  "https://chatgpt.com/*",
  "https://chat.openai.com/*",
  "https://gemini.google.com/*"
],
"content_scripts": [
  { "matches": ["https://chatgpt.com/*","https://chat.openai.com/*"], "js": ["content-chatgpt.js"], "run_at": "document_idle" },
  { "matches": ["https://gemini.google.com/*"], "js": ["content-gemini.js"], "run_at": "document_idle" }
]
```

`description` 顺手更新为「本地管理 ChatGPT、Gemini 对话入口。」。

### background.js

引入配置表:

```js
const PROVIDER_CONFIGS = {
  chatgpt: { origins: ["https://chatgpt.com", "https://chat.openai.com"] },
  gemini:  { origins: ["https://gemini.google.com"] }
};
```

- `handleVisibleHistory`:校验 `message.provider in PROVIDER_CONFIGS` 后处理;不再硬编码 `=== "chatgpt"`。
- `pageStateFromTab(tab)`:遍历配置表反查当前 URL 对应的 provider;命中后返回该 provider 的 state,未命中返回 `{ supported: false }`。
- `providerState` 已是 map,继续按 provider key 写入。

### storage-model.js

新增 `filterFoldersAcrossProviders(state, providerStatuses)`:

- `providerStatuses`:形如 `{ chatgpt: {hasAccount, account}, gemini: {hasAccount, account} }`。缺失的 provider 默认走「按 storage activeAccounts 过滤」逻辑。
- 行为:对每个已知 provider 单独执行现有 `filterFoldersForProvider` 等价过滤,然后把同名 folder 的记录合并(保持各自原顺序)。
- 返回的 folder map 至少含 `unclassified` 与 `archived`(空也保留),其它自定义 folder 来自 storage。
- 原 `filterFoldersForProvider` 保留,不删除。

### sidepanel.html

```html
<section class="actions" aria-label="快捷操作">
  <button id="new-chatgpt" type="button">新建 ChatGPT 对话</button>
  <button id="new-gemini"  type="button">新建 Gemini 对话</button>
  <button id="show-folder-form" type="button">新建目录</button>
  <form id="folder-form" class="folder-form hidden" autocomplete="off">
    <input id="folder-name" name="folderName" type="text" maxlength="40" placeholder="目录名称" aria-label="目录名称">
    <button type="submit">创建</button>
  </form>
</section>
```

### sidepanel.js

- 移除模块顶部 `PROVIDER` 常量与 `NEW_CHAT_URL`。引入:
  ```js
  const PROVIDER_NEW_CHAT_URLS = {
    chatgpt: "https://chatgpt.com/",
    gemini:  "https://gemini.google.com/app"
  };
  const PROVIDER_BADGES = {
    chatgpt: { letter: "C", className: "badge-chatgpt" },
    gemini:  { letter: "G", className: "badge-gemini" }
  };
  ```
- `init`:绑定 `#new-chatgpt`、`#new-gemini` 两个按钮。
- `render`:不再调用 `filterFoldersForProvider`,改为调用 `filterFoldersAcrossProviders`,传入由当前 `pageState` 与 storage `activeAccounts` 合成的 providerStatuses。
- `renderConversation`:在 `.conversation-row` 内最前面插入 `<span class="conversation-badge {className}">{letter}</span>`。
- `renderNoticeForPageState`:只针对当前 `pageState.provider` 显示提示,文案中带 provider 名("无法获取 ChatGPT 账号..." / "无法获取 Gemini 账号...")。

### sidepanel.css

新增徽标样式(贴合现有 32px pill 行):

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
.badge-chatgpt { background: #10a37f; }
.badge-gemini  { background: #4285f4; }
```

`conversation-row` 已是 flex 行,徽标作为第一个子元素自然占位,无需改动其余布局。

### 拖拽与移动

`moveConversation(state, provider, url, targetFolder, account)` 已按三元组匹配,跨 provider 拖拽自动可用。dragstart 仍把 `provider/url/account` 写进 dataTransfer。

## 错误处理与边界

- Gemini 上报失败(扩展上下文失效):`sendVisibleHistory` 用 try/catch 吞掉,同 ChatGPT 版。
- 用户在 Gemini 上未登录:account = ""、records 抓不到。pageState `hasAccount=false`、`hasHistory=false`,渲染按"未知账号 → 显示全部 gemini 本地记录 + 提示"处理。
- 用户在某一个 provider 还未访问过、storage 里没有 activeAccount:`filterFoldersAcrossProviders` 对该 provider 跳过账号过滤,直接返回该 provider 所有记录。空的话目录里就没有它的条目。
- Gemini DOM 结构变化:首选 selector 命中失败时记录为 0 条记录,沿用 `upsertVisibleConversations` 「无记录时不删除已有」的保护。

## 测试策略

新增/更新静态测试:

- `tests/manifest.test.js`
  - 断言 host_permissions 含 `https://gemini.google.com/*`
  - 断言 content_scripts 含 gemini 条目
- `tests/content-gemini.test.js`(新增,镜像 chatgpt 版)
  - 不引用 `document.body.innerText`
  - 包含 `data-test-id="all-conversations"`、`gem-open-account-menu`、`bard-sidenav` 等关键 selector
  - 上下文失效不抛(VM 注入 throw 版 chrome.runtime)
- `tests/storage-model.test.js`
  - `filterFoldersAcrossProviders` 同时按 chatgpt/gemini 各自账号过滤
  - 缺失 providerStatus 的 provider 走 storage activeAccounts 过滤
- `tests/sidepanel-static.test.js`
  - 断言 `#new-chatgpt`、`#new-gemini` 存在,且对应的 URL 出现在 sidepanel.js
  - 断言 `.conversation-badge`、`.badge-chatgpt`、`.badge-gemini` 样式存在

不做端到端浏览器测试(沿用项目惯例)。

## 风险与决策

| 风险 | 处理 |
| --- | --- |
| Gemini DOM 不稳定(`_ngcontent-*` 是动态 hash) | 仅依赖 `data-test-id`、语义 attribute(`gem-open-account-menu`、`href` 前缀),不依赖动态 class |
| Google 账号可能隐藏 email | 退化到 `.mavatar-user-name` 显示名,沿用 ChatGPT 同款回退链 |
| 两个 provider 同时打开多个 tab 时 providerState 频繁覆盖 | 沿用现有"最后一次同步覆盖"语义;activeAccount 以最近一次同步为准 |
| 跨 provider 同名目录冲突(目录是字符串名,与 provider 无关) | 用户主动创建,与现状一致,不额外约束 |
