# LLM Navigation

LLM Navigation 是一个本地优先的 Chrome 扩展,在 LLM 网站(ChatGPT、Gemini、Claude、DeepSeek、Grok、Kimi、Perplexity)的页面里**直接注入**一个 Shadow DOM 侧栏,统一管理跨 provider 的可见对话历史,用单层目录组织对话入口。

## 功能

- Manifest V3 content script 注入,不依赖 Chrome 原生 Side Panel,无需 background service worker。
- 在每个 LLM 网站上自动隐藏原生左侧栏,在左侧显示插件 sidebar,宽度 `min(360px, 22vw)`。
- 折叠 / 展开:`«` 收起,左边缘 `»` handle 展开;状态按 origin 用 `localStorage` 持久化。
- 顶部拆分按钮 `[新建对话 <Default Provider> ▾]`:主体一次点击新建当前默认 provider 对话;`▾` 下拉切换其他启用的 provider。
- 默认 provider 跟随当前标签页(或在设置里写死)。
- 可选的快捷操作行(例如 "Gemini · 新建笔记本"、"ChatGPT · 图片"、"Claude · 新建项目"),在设置里 enable。
- 设置浮层(齿轮 icon 触发):默认 provider 下拉 / 新建对话下拉成员复选 / 快捷操作复选;改即生效;至少保留 1 个 provider。
- 跨 provider 的对话目录:
  - 新建、重命名、删除(自定义目录;hover 显示 `✎ ×`)
  - 拖拽对话进目录
  - 单击对话条目跳转
  - 自动同步当前页可见历史到"未分类"头部(最新在最上面)
  - 自动 hide 原生左栏,SPA 路由切换后 MutationObserver 兜底重新注入
- 账号隔离:抓到账号则只显示当前账号记录,抓不到则显示该 provider 全部本地记录并提示风险。
- 不依赖 React/Vue/构建工具,纯 vanilla JS。

## 当前不做

- 不做搜索 / 标签 / AI 自动分类 / 全文导出。
- 不主动滚动 LLM 历史列表加载全量旧历史。
- 不删除本地已有记录,即使它们不再出现在当前可见历史中。
- 不做跨 tab 视觉状态同步(`chrome.storage.onChanged` 保证数据同步,折叠/滚动等视觉状态每个 tab 独立)。
- 不做跨设备同步(只用 `chrome.storage.local`)。

## 文件结构

- `manifest.json` — Chrome MV3 声明(无 background、无 side_panel,7 个 LLM 站点的 content_scripts,`web_accessible_resources` 让页面 fetch `sidepanel.html` / `sidepanel.css`)。
- `injected-sidebar.js` — content script。Shadow DOM 宿主、fetch 模板、CSS 用 `adoptedStyleSheets`、折叠 UX、MutationObserver 兜底,以及账号 + 历史抓取。
- `sidepanel.html` — sidebar 结构模板,被 fetch 后解析到 shadow root。
- `sidepanel.css` — sidebar 样式(`:host` scope)。
- `sidepanel.js` — sidebar 渲染主逻辑。通过 `window.LLMNavSidebar.mount(shadowRoot, options)` 入口挂载。
- `storage-model.js` — 目录、对话、设置的纯数据模型。
- `providers/*.js` — 每个 LLM provider 的配置(label、newChatUrl、badge、scraping 选择器、quickActions)。
- `tests/` — Node 内置 test runner。

## 本地加载扩展

1. Chrome 打开 `chrome://extensions/`。
2. 右上角打开"开发者模式"。
3. 点"加载已解压的扩展程序",选择本项目目录。
4. 打开任意支持的 LLM 站点(如 `https://chatgpt.com/`)。
5. 等待 LLM 站点左侧栏渲染完成,在 `document_idle` 时插件 content script 注入。

## 手动验证清单

### 1. 扩展加载

`chrome://extensions/` 上:扩展列表里出现 LLM Navigation,无 manifest 错误,**没有** "Open side panel" 入口(原生 Side Panel 已废弃),**没有** service worker(无 background)。

### 2. 注入与隐藏原生侧栏

打开 chatgpt.com:页面左侧出现插件 sidebar,ChatGPT 原生左栏被隐藏。顶部从左到右:`«` 折叠 / `⚙` 设置 / `[新建对话 ChatGPT ▾]` 拆分按钮。

### 3. 折叠与展开

点 `«` → sidebar 滑出屏幕,左边缘 `40×40` 浮动 `»` handle 出现。点 handle → 滑入。刷新页面后,折叠状态保留(按 origin 存)。

### 4. 同步可见历史

ChatGPT 左栏历史会同步到"未分类"。**新发起的对话**(刷新后)出现在"未分类"**头部**。

### 5. 设置浮层

点 `⚙`:浮层弹出,3 段(默认 provider / 新建对话下拉成员 / 快捷操作)。改任何选项立即生效。再点 `⚙` 或 Esc / 灰幕 / 右上 `×` 关闭。

### 6. 目录操作

- 点目录区头部的 `+` 新建自定义目录。
- hover 自定义目录:右侧出现 `✎ ×`。
- 点 `✎` → 输入框 inline 重命名(Enter 保存 / Esc 取消)。
- 点 `×` → 空目录直删;非空触发原生 confirm,确认后内容移到"未分类"尾部。
- 拖拽对话进入自定义目录。

### 7. SPA 路由韧性

在 ChatGPT 切换不同对话(URL 变 `/c/xxx`),sidebar 不消失。

### 8. 其他 LLM 站点

依次打开 gemini.google.com、claude.ai、chat.deepseek.com、grok.com、www.kimi.com、www.perplexity.ai,确认注入与原生侧栏隐藏都正常。

### 9. 跨 tab 同步

同时打开两个 ChatGPT tab,在 A tab 改设置或新建/删除目录,B tab 立即同步;但 A tab 的折叠状态**不**影响 B tab(localStorage 不同 tab 独立)。

## 本地存储数据

任意 LLM 页面 DevTools console:

```javascript
chrome.storage.local.get(["folders", "activeAccounts", "settings"]).then(console.log)
```

期望结构:

```json
{
  "folders": {
    "unclassified": [
      {
        "provider": "chatgpt",
        "account": "user@example.com",
        "title": "示例对话",
        "url": "https://chatgpt.com/c/example"
      }
    ],
    "archived": []
  },
  "activeAccounts": {
    "chatgpt": "user@example.com"
  },
  "settings": {
    "defaultProvider": "auto",
    "enabledProviders": ["chatgpt", "gemini", "claude", "deepseek", "grok", "kimi", "perplexity"],
    "enabledQuickActions": []
  }
}
```

折叠状态存于 `localStorage["llmnav:sidebarCollapsed"]`,取值 `"0"` / `"1"`,按 origin 隔离。

## 运行自动测试

无构建步骤。

```bash
node --test tests/*.test.js
```

期望:全部 91 个测试通过。

## 开发注意

- 目录只有单层,不支持嵌套。
- `unclassified` 和 `archived` 是系统目录,不可重命名或删除。
- 同步只读取当前已经渲染的可见历史,不主动加载更多。
- 本地已有记录不会因为当前页面不可见而被删除。
- 拖拽移动携带账号信息,避免多个账号拥有相同 URL 时移动错记录。
- 自动同步的新对话进入"未分类"**头部**;手动拖拽或目录删除导致的回流进入"未分类"**尾部**。
</content>
</invoke>