# LLM navigation 第一版设计

日期：2026-05-24

## 背景与目标

LLM navigation 是一个 Chrome 浏览器插件，目标是解决用户同时使用 ChatGPT、Gemini、Claude 时，历史对话分散、难以统一整理和跳转的问题。产品原则是做减法：不做标签系统，不做 AI 自动分类，不做全文搜索；第一版只完成本地、极简、高效的单层目录分类和对话跳转。

第一版采用 ChatGPT-first：把 ChatGPT 的可见历史同步、目录管理、跳转和归类流程做完整，同时在数据结构中保留 `provider` 字段，为后续 Gemini 和 Claude 接入留出清晰边界。

## 范围

### 第一版包含

- Chrome Extension Manifest V3。
- Chrome 原生 Side Panel。
- 原生 HTML、CSS、JavaScript，不引入 React/Vue 或构建工具。
- ChatGPT 内容脚本：抓取原生左侧栏当前已经渲染的可见历史。
- 使用 `chrome.storage.local` 保存本地目录和对话记录。
- 单层目录：新建目录、展开/收起目录、把对话移动到目录。
- 对话跳转：点击侧边栏对话后让当前标签页跳到对应 URL。
- 隐藏 ChatGPT 原厂左侧栏。
- 账号隔离：能抓到账号时只显示该 provider 最新账号的记录；抓不到账号时显示该 provider 全部本地记录并提示风险。

### 第一版不包含

- 不做搜索。
- 不做标签。
- 不做 AI 自动分类。
- 不做全文导出或调用其他插件，例如 AI Export。
- 不主动滚动 ChatGPT 历史列表加载全量旧历史。
- 不删除本地已有记录，即使它们不再出现在 ChatGPT 当前可见历史中。
- 不在侧边栏顶部显示账号邮箱或插件大标题。

## 用户体验与信息架构

侧边栏整体风格参考 Gemini 原生左栏：轻量、留白、每个功能独占一行，避免多个按钮挤在一起。

顶部功能区：

- 发起新对话：第一版默认跳转到 ChatGPT 新会话入口。后续多 provider 版本可以扩展为 provider 列表。
- 新建目录：点击后显示一个小输入框，创建一级目录。禁止创建 `unclassified` 和 `archived` 同名目录。

目录区：

- 所有目录都是单层目录，不支持嵌套。
- 目录可展开/收起。
- 目录行和对话行字号同级，目录可用字重区分。
- 未分类作为一个普通分组显示，默认展开，但不提供“全部未分类”功能行。
- 对话行点击后跳转到该对话 URL。
- 移动分类优先采用拖拽：把对话拖到目录行即可移动。若 side panel 内拖拽体验不稳定，再增加一个轻量“移动到”菜单作为兜底。
- `archived` 是系统目录，第一版可默认折叠或隐藏，避免干扰主流程。

账号状态：

- UI 不展示邮箱。
- 如果某个 provider 当前抓不到账号，侧边栏显示轻提示：无法获取该 provider 账号，当前显示该 provider 的全部本地对话，可能包含其他账号。

## 技术架构

建议文件边界：

- `manifest.json`：声明 MV3、side panel、storage、tabs、activeTab、ChatGPT content script。
- `background.js`：负责 side panel 行为，接收 content script 消息，转发当前页面状态。
- `content-chatgpt.js`：只负责 ChatGPT 页面，抓取账号、抓取原生左栏可见历史、注入 CSS 隐藏原厂左栏。
- `sidepanel.html`：侧边栏结构。
- `sidepanel.css`：侧边栏样式。
- `sidepanel.js`：渲染目录和对话，处理新建目录、展开/收起、拖拽/移动、跳转。

后续接入 Gemini/Claude 时，新增对应内容脚本，例如 `content-gemini.js`、`content-claude.js`。侧边栏主逻辑只依赖统一消息格式，不直接依赖具体网站 DOM。

## 数据结构

`chrome.storage.local` 使用两个主要 key：`folders` 保存目录数据，`activeAccounts` 保存每个 provider 的最新账号。`folders` 的值保持“目录名作为一级 key，数组里是对话记录”的结构。每条对话包含 `provider` 字段：

```json
{
  "folders": {
    "coding": [
      {
        "provider": "chatgpt",
        "account": "xyz@gmail.com",
        "title": "python问题",
        "url": "https://chatgpt.com/c/xxx"
      }
    ],
    "unclassified": [],
    "archived": []
  },
  "activeAccounts": {
    "chatgpt": "xyz@gmail.com",
    "gemini": "abc@gmail.com"
  }
}
```

存储规则：

- `provider` 必填，第一版使用 `chatgpt`。
- `account` 能抓到时填账号；抓不到时使用空字符串或 `unknown` 作为内部值。
- `title` 来自原厂历史列表的可见标题。
- `url` 是对话 URL，用于去重和跳转。
- 保留 `unclassified` 和 `archived` 作为系统目录。
- 如果同一 `provider + url` 已存在但旧记录账号为 `unknown`，后续成功抓到账号时更新旧记录的 `account`，不新增重复记录。

## 账号规则

每个 provider 维护一个最新账号。

- 如果 content script 抓到账号：
  - 更新 `activeAccounts[provider] = account`。
  - 侧边栏只显示该 provider 最新账号的记录。
- 如果 content script 抓不到账号：
  - 不要求用户填写。
  - 显示提示：无法获取该 provider 账号，当前显示该 provider 的全部本地对话，可能包含其他账号。
  - 该 provider 渲染时不按 account 过滤，只按 provider 显示全部记录。
- 后续如果某次成功抓到账号，则恢复为只显示该 provider 最新账号的记录。

多 provider 版本中，侧边栏可以同时显示各 provider 的最新账号对话。抓不到账号的 provider 使用“显示该 provider 全部记录”的兜底规则，不影响其他 provider。

## 同步规则

ChatGPT 内容脚本负责读取当前页面原生左栏已经渲染出来的可见历史，不主动滚动、不加载更多。

同步流程：

1. 打开 ChatGPT 页面时，content script 抓取账号和可见历史。
2. 生成统一记录：`{ provider: "chatgpt", account, title, url }`。
3. 优先按 `provider + account + url` 去重；若已存在同一 `provider + url` 且旧账号为 `unknown`，则更新旧记录账号而不是新增。
4. 新发现的可见历史默认进入 `unclassified`。
5. 如果本地已有同 URL 记录在某个目录，只更新 `title`，不改变目录。
6. 如果本地已有记录没有出现在当前可见历史中，不删除。
7. 用户把对话移动到目录后，该记录从原目录移到目标目录。
8. 点击对话时，当前标签页跳转到记录里的 `url`。

## 异常与边界处理

- 当前不是支持的 LLM 页面：侧边栏显示提示，不渲染同步状态。
- ChatGPT DOM 选择器失效：显示“未检测到可见历史”，保留已有本地数据。
- 抓不到账号：按 provider 显示全部本地记录，并展示轻提示。
- 新建目录名称为空或与系统目录重复：不创建。
- 重复 URL：不新增重复记录，只更新标题。
- 隐藏原厂左栏失败：不阻断同步和侧边栏功能。

## 验证策略

手动验证：

1. 加载 unpacked extension，打开 ChatGPT。
2. 确认 side panel 可打开。
3. 确认 ChatGPT 原厂左栏被隐藏；如果隐藏失败，确认插件主体仍可用。
4. 确认可见历史同步到 `unclassified`。
5. 新建目录后刷新，目录仍存在。
6. 将一条对话拖动或移动到目录后刷新，分类仍保持。
7. 点击对话后，当前标签页跳转到对应 URL。
8. 抓不到账号时，看到提示，并显示该 provider 的全部本地对话。
9. 抓到账号时，确认只显示 `activeAccounts.chatgpt` 对应账号的记录。
10. 检查 `chrome.storage.local` 中目录结构、`activeAccounts`、`provider` 字段符合设计。

代码验证：

- 使用浏览器扩展加载流程验证 manifest 配置。
- 在 Chrome DevTools 检查 content script、background、side panel 是否有运行时错误。
- 不引入构建工具，因此无需 build 命令。

## 实施顺序建议

1. 建立 MV3 插件骨架和 side panel。
2. 实现 ChatGPT content script，先抓取可见历史并隐藏原厂左栏。
3. 建立 storage 读写和同步逻辑。
4. 渲染目录、未分类和对话跳转。
5. 实现新建目录和移动分类。
6. 加入账号规则和抓不到账号提示。
7. 手动验证第一版闭环。
