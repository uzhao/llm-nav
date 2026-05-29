# Side Panel UI 重设计 (Provider 拆分按钮 + 设置浮层 + 目录编辑)

## 背景

当前 [sidepanel.js:50-61](../../../sidepanel.js#L50-L61) 为每个 provider 渲染一个独立的"新建 {provider} 对话"按钮,7 个 provider 堆在顶部挤占了大量纵向空间,目录区被推到下方。每新增一个 provider,顶部就多一行。

同时 provider 配置里目前只有 `newChatUrl` 一个动作,无法表达"新建笔记本"、"图片"、"项目"等 provider 特有的二级动作。

## 目标

1. 顶部只占一个主按钮 + 用户启用的若干快捷操作,纵向空间留给目录区。
2. 默认 provider 行为符合直觉:在 LLM 标签页时跟随当前页,非 LLM 标签页时回落到用户设置。
3. 用户可以在面板内通过浮层管理:默认 provider、新建对话下拉里显示哪些 provider、启用哪些快捷操作。
4. 目录支持新建、重命名、删除;删除后内容回到未分类,不丢数据。
5. 新同步的对话出现在未分类的头部(更符合"最近活跃"语义)。

## 非目标

- settings 跨设备同步(只用 `chrome.storage.local`,不上 `sync`)。
- 撤销栈(删除目录后通过"内容移到未分类"实现软安全,不做 undo)。
- 快捷操作的账号过滤(打开 URL 即可,不考虑当前账号)。
- content script 注入(本次只动 side panel,不动注入 LLM 页面的方案)。

## 设计决策摘要

| 决策点 | 选择 | 原因 |
| --- | --- | --- |
| 主新建按钮形态 | 拆分按钮 `[新建对话 ChatGPT ▾]` | 默认场景 1 次点击;切换 provider 才 2 次点击 |
| 默认 provider | 跟随当前标签页(设置可改为固定) | 已有 `pageState.provider`,符合直觉 |
| 快捷操作展示 | provider badge + 文字,一行一条 | 复用现有 badge 视觉,和对话条目一致 |
| 快捷操作数量 | 不做硬上限 | 一般用户启用数量有限 |
| 新建目录入口 | 目录区头的 `+` icon | 语义上属于目录区 |
| 设置入口 | 面板内浮层 modal(齿轮触发) | 不离开面板,有空间放复杂表单 |
| 设置生效语义 | 改即生效,关闭按钮 = 完成 | 现代 Chrome 设置惯例 |
| 删除/重命名目录的触发 | hover 目录行显示 `✎` 和 `×` icon | 避免与"点击行切换折叠"冲突 |
| 新同步对话位置 | 未分类的头部 | "最近活跃"语义 |
| 用户手动移动对话位置 | 目标目录的尾部 | 用户主动 = "最近添加到此目录" |
| 删除目录里对话的去向 | 追加到未分类尾部 | 等同于用户主动移动 |

## 面板布局

```
┌──────────────────────────────────┐
│ ⚙              [新建对话 ChatGPT ▾]│  顶部 actions 区
│           [Gemini · 新建笔记本]   │  用户启用的快捷操作
│           [ChatGPT · 图片]        │
│           [Claude · 项目]         │
├──────────────────────────────────┤
│ 目录                            + │  目录区头(含新建目录 icon)
│ ▾ 未分类 (12)                    │
│   ⓒ 对话 A                       │
│   ⓖ 对话 B                       │
│ ▸ coding (3)              ✎  ×   │  hover 时显示编辑/删除 icon
│ ▸ research (5)                   │
│ ▸ 归档 (8)                       │
└──────────────────────────────────┘
```

### 顶部 actions 区

- **齿轮 icon**:左上角小尺寸,icon-only,点击打开设置浮层。
- **拆分按钮**:右侧主按钮,占据剩余宽度。
  - 主体点击 = 用当前默认 provider 新建对话(等价于打开 `provider.newChatUrl`)。
  - `▾` 点击 = 弹出菜单,列出"启用的 provider"(settings.enabledProviders),选中后等同于"主体点击 + 切换默认"。
  - 文字部分显示当前默认 provider 的 label,跟随 `settings.defaultProvider` 解析后的实际值变化(见下文 [默认 provider 解析](#默认-provider-解析))。
- **快捷操作**:0 到 N 个全宽按钮,按 settings 里 `enabledQuickActions` 数组顺序渲染。每个按钮显示 provider badge(彩色字母,复用 [sidepanel.js:201-208](../../../sidepanel.js#L201-L208) 风格) + `· {label}`,点击 = 打开 `quickAction.url`。

### 默认 provider 解析

```
当前标签页是支持的 LLM provider?
├─ 是 → 主按钮显示该 provider(忽略 settings.defaultProvider)
└─ 否 → settings.defaultProvider 是 "auto"?
        ├─ 是 → 取 enabledProviders[0]
        └─ 否 → 取 settings.defaultProvider 指定值
```

如果 `settings.defaultProvider` 指向的 provider 不在 `enabledProviders` 里(脏数据),按"auto"处理。

### 目录区

- 目录区头一行:左侧文字"目录",右侧 `+` icon(点击 = 进入新建目录 inline 表单,逻辑沿用 [sidepanel.js:69-80](../../../sidepanel.js#L69-L80))。
- 每个目录行:`▸/▾ 名称 (count)`;hover 自定义目录时右侧显示 `✎` 和 `×` icon。
  - 系统目录(`unclassified`、`archived`)不显示 icon。
  - `✎` 点击 → 名称变 `<input>`,Enter/blur 保存,Esc 取消。
  - `×` 点击 → 空目录直接删;非空触发原生 `confirm("移除「{name}」?目录内 {n} 条对话将移到未分类")`。

## 设置浮层

### 触发与关闭

- 齿轮 icon 点击 → 浮层覆盖整个 side panel(`position: fixed; inset: 0`)上方留 16px 灰幕。
- 关闭路径:右上 `×` / 灰幕点击 / Esc / 再次点齿轮。
- 改即生效:每次复选框/下拉变化立即写回 `chrome.storage.local.settings`,无 "保存"/"取消" 按钮。

### 结构

```
┌──── 设置 ───────────────────── × ┐
│                                  │
│ 默认 provider                    │
│ [跟随当前页 ▾]                   │
│                                  │
│ 新建对话下拉里显示              │
│ ☑ ChatGPT                        │
│ ☑ Gemini                         │
│ ...                              │
│                                  │
│ 快捷操作                         │
│ ☐ ChatGPT · 图片                 │
│ ☑ Gemini · 新建笔记本            │
│ ...                              │
│                                  │
└──────────────────────────────────┘
```

- **默认 provider 下拉**:选项 = `跟随当前页(auto)` + 所有 provider config 里声明的 provider(不受 enabledProviders 限制,允许用户把默认设成一个不在 dropdown 里的 provider)。
- **新建对话下拉成员**:每个 provider 一个复选框,默认全选。**至少保留 1 个**:当前只剩一个被勾选时,该复选框 disabled,鼠标 hover 提示"至少保留一个 provider"。
- **快捷操作**:把所有 provider 的 `quickActions` 拍平,按 provider 顺序分组渲染;每个一个复选框,默认全部未选。

## 数据模型变更

### `chrome.storage.local` 新增字段

```js
{
  // 现有字段
  folders: { ... },
  activeAccounts: { ... },

  // 新增
  settings: {
    defaultProvider: "auto",            // "auto" | provider.name
    enabledProviders: ["chatgpt", ...],  // provider.name 数组,默认 = 全部已注册 provider
    enabledQuickActions: []              // quickAction.id 数组,默认空
  }
}
```

### Provider config 扩展

每个 `providers/{name}.js` 在 `window.LLMNavProviders[name]` 上新增可选字段:

```js
{
  name: "gemini",
  label: "Gemini",
  newChatUrl: "...",
  badge: { ... },
  quickActions: [
    { id: "gemini.notebook", label: "新建笔记本", url: "https://notebooklm.google.com/" }
  ]
}
```

- `id` 全局唯一,格式 `{provider}.{action}`。
- `quickActions` 缺省 = 没有快捷操作。
- 本设计阶段不强制为每个 provider 填充 quickActions;初版只给 Gemini/ChatGPT/Claude 各加 1–2 个示范用,其余留空。

### `storage-model.js` 新增函数

```js
// 新建目录,已存在 spec 之前的版本里有
createFolder(state, name)

// 重命名:以下情形返回原 state(无变化):
//   - oldName 是系统目录或不存在
//   - newName trim 后为空
//   - newName 是系统目录名("unclassified" / "archived")
//   - newName 已存在(包括 newName === oldName 的退化情形,等价于无操作)
renameFolder(state, oldName, newName)

// 删除:系统目录拒绝;内容 push 到 unclassified 尾部;然后 delete folders[name]
deleteFolder(state, name)
```

### `upsertVisibleConversations` 顺序变更

当前 [storage-model.js:288-319](../../../storage-model.js#L288-L319) 里新记录用 `next.folders.unclassified.push(normalized)`。改为:

```js
const newRecords = [];
records.forEach((record) => {
  const normalized = normalizeRecord(record, provider, normalizedAccount);
  if (!normalized.url) return;

  const location = findRecordLocation(next, provider, normalized.url, normalized.account);
  if (!location) {
    newRecords.push(normalized);
    return;
  }

  // existing in-place 更新逻辑保持不变
});

if (newRecords.length > 0) {
  next.folders.unclassified.unshift(...newRecords);
}
```

注意:**收集后整体 prepend**,不能 forEach 里逐个 unshift,否则同一批新记录顺序被反转。

`moveConversation` 保持当前的 push 到目标尾部,**不**改成 prepend。

## 行为规范

### 新建目录

复用现有 [sidepanel.js:69-80](../../../sidepanel.js#L69-L80) 的 inline form 逻辑,只把触发位置从顶部按钮换成目录区头部的 `+`。

### 重命名目录

1. hover 自定义目录行,`✎` icon 出现在右侧。
2. 点击 `✎`:`<span class="folder-label">` 替换为 `<input>`,聚焦,选中现有名称文本。
3. 输入新名称后:
   - Enter / blur → 调 `LLMNavModel.renameFolder(state, oldName, value)`,保存,重渲染。
   - Esc → 放弃,恢复显示原名。
4. 冲突处理:`renameFolder` 内部如果 `newName` 已存在,返回原 state(无变化);UI 不弹错,直接回到显示原名(失败几乎不会发生,加 toast 不值得)。

### 删除目录

1. hover 自定义目录行,`×` icon 出现在右侧。
2. 点击 `×`:
   - 该目录 records.length === 0 → 直接调 `deleteFolder`。
   - 否则 → `window.confirm("移除「{name}」?目录内 {n} 条对话将移到未分类")`,确认后调 `deleteFolder`。
3. `deleteFolder` 把目录里所有记录 `push(...)` 到 `unclassified` 尾部,然后 `delete state.folders[name]`。
4. 系统目录的 `×` 不渲染,所以不会触发删除。如果通过其他方式传入 `unclassified` / `archived`,`deleteFolder` 直接返回原 state。

### 快捷操作点击

- 复用 [sidepanel.js:241-247](../../../sidepanel.js#L241-L247) 的 `openUrl`(在当前 tab 跳转)。
- 不开新 tab(和"新建对话"行为一致)。

### 设置变更

- 任一复选框/下拉变化 → 立即 `chrome.storage.local.set({ settings: next })`。
- `chrome.storage.onChanged` 已经监听 `local`,但当前只触发 folders/activeAccounts 重渲染。需要扩展到也监听 `settings` 变化,触发顶部 actions 区重渲染(主按钮文字、下拉成员、快捷操作列表都依赖 settings)。

## 测试要点

`tests/storage-model.test.js` 新增:

- `renameFolder` 成功改名,记录跟随移动。
- `renameFolder` 重名时返回原 state。
- `renameFolder` 拒绝 `unclassified` / `archived`。
- `deleteFolder` 把内容 push 到 unclassified 尾部并删 key。
- `deleteFolder` 拒绝系统目录。
- `upsertVisibleConversations` 新记录 unshift 到 unclassified 头部,同批多条保持 DOM 顺序。
- `upsertVisibleConversations` 同时存在新旧记录时,旧记录不动,新记录在前。

`tests/sidepanel-static.test.js` 新增:

- HTML 含 `#settings-button`(齿轮)、`#settings-modal`、`#new-chat-split`。
- HTML 不再包含独立的 `#show-folder-form` 顶部按钮(改为目录区内)。
- JS 引用 `settings`、`renameFolder`、`deleteFolder`。

手动验证补充到 Task 5 闭环:

- 切换默认 provider(auto / 固定)后主按钮文字立即更新。
- 取消勾选某 provider,下拉菜单里立即消失。
- 启用一个快捷操作,顶部立即多一行。
- 重命名 `coding` 为 `research`,刷新 side panel 后仍是 `research`。
- 删除非空目录,内容出现在未分类尾部。
- 在 ChatGPT 页面新开一个对话刷新后,新对话出现在未分类**头部**。

## 文件影响

- Modify: [sidepanel.html](../../../sidepanel.html) — 顶部结构、目录区头、设置浮层骨架。
- Modify: [sidepanel.css](../../../sidepanel.css) — 拆分按钮、齿轮 icon、快捷操作行、浮层、目录 hover icons。
- Modify: [sidepanel.js](../../../sidepanel.js) — 主按钮渲染、设置浮层逻辑、目录编辑/删除、settings 监听。
- Modify: [storage-model.js](../../../storage-model.js) — `renameFolder`、`deleteFolder`、`upsertVisibleConversations` 顺序。
- Modify: [providers/*.js](../../../providers/) — 给 Gemini/ChatGPT/Claude 各加 1–2 个 `quickActions` 作为示范。
- Modify: [tests/storage-model.test.js](../../../tests/storage-model.test.js)、[tests/sidepanel-static.test.js](../../../tests/sidepanel-static.test.js) — 新增覆盖。
