(function () {
const FOLDER_LABELS = {
  unclassified: "未分类",
  archived: "归档"
};

let pageState = { supported: false };
let settings = null;
let collapsedFolders = new Set(["archived"]);
let renderSequence = 0;

let __root = null;
let __navigate = null;
let __collapseStorage = null;
let __collapseHost = null;

function byId(id) {
  return (__root || document).getElementById(id);
}

function listProviders() {
  return window.LLMNavProviders;
}

function getProvider(name) {
  return listProviders()[name] || null;
}

function providerNames() {
  return Object.keys(listProviders());
}

function allQuickActions() {
  const result = [];
  providerNames().forEach((name) => {
    const provider = getProvider(name);
    if (provider && Array.isArray(provider.quickActions)) {
      provider.quickActions.forEach((action) => {
        result.push({ provider, action });
      });
    }
  });
  return result;
}

function resolveDefaultProviderName() {
  if (pageState && pageState.supported && pageState.provider && getProvider(pageState.provider)) {
    return pageState.provider;
  }

  if (settings.defaultProvider !== "auto" && getProvider(settings.defaultProvider)) {
    return settings.defaultProvider;
  }

  return settings.enabledProviders[0];
}

document.addEventListener("DOMContentLoaded", () => init({}));

async function init(options) {
  __root = (options && options.root) || null;
  __navigate = (options && options.navigate) || null;
  __collapseStorage = (options && options.collapseStorage) || defaultCollapseStorage();
  __collapseHost = (options && options.collapseHost) || null;
  applyCollapseState(readCollapseState());
  if (!byId("settings-button")) return;
  byId("settings-button").addEventListener("click", openSettings);
  byId("new-folder-button").addEventListener("click", showFolderForm);
  byId("folder-form").addEventListener("submit", createFolderFromForm);

  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === "llmnav:pageState") {
      pageState = message.state || { supported: false };
      renderTopActions();
      render();
    }

    if (message && message.type === "llmnav:storageUpdated") {
      render();
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;

    if (changes.settings) {
      settings = LLMNavModel.normalizeSettings(changes.settings.newValue, providerNames());
      renderTopActions();
      if (!byId("settings-modal").classList.contains("hidden")) {
        renderSettingsBody();
      }
    }

    if (changes.folders) {
      render();
    }
  });

  try {
    const stored = await chrome.storage.local.get(["settings"]);
    settings = LLMNavModel.normalizeSettings(stored.settings, providerNames());
  } catch (err) {
    if (err.message && err.message.includes("Extension context invalidated")) {
      showNotice("插件已更新，请刷新页面以继续使用。");
      return;
    }
    throw err;
  }

  pageState = (options && options.pageState) || { supported: false };

  renderTopActions();
  await render();
}

function renderTopActions() {
  if (!settings) return;
  const defaultName = resolveDefaultProviderName();
  const provider = getProvider(defaultName);

  let collapseBtn = byId("collapse-button");
  if (!collapseBtn) {
    const header = byId("panel-header");
    if (header) {
      collapseBtn = document.createElement("button");
      collapseBtn.id = "collapse-button";
      collapseBtn.className = "icon-button";
      collapseBtn.type = "button";
      collapseBtn.setAttribute("aria-label", "折叠侧栏");
      collapseBtn.title = "折叠";
      collapseBtn.textContent = "«";
      collapseBtn.onclick = toggleCollapse;
      header.appendChild(collapseBtn);
    }
  }

  const main = byId("new-chat-main");
  main.textContent = provider ? `新建对话 · ${provider.label}` : "新建对话";
  main.onclick = () => {
    if (provider) openUrl(provider.newChatUrl);
  };

  const caret = byId("new-chat-caret");
  caret.onclick = (event) => {
    event.stopPropagation();
    toggleProviderDropdown();
  };

  const dropdown = byId("provider-dropdown");
  dropdown.replaceChildren();
  settings.enabledProviders.forEach((name) => {
    const p = getProvider(name);
    if (!p) return;
    const li = document.createElement("li");
    li.textContent = `新建对话 · ${p.label}`;
    li.onclick = () => {
      hideProviderDropdown();
      openUrl(p.newChatUrl);
    };
    dropdown.appendChild(li);
  });

  renderQuickActions();
}

function renderQuickActions() {
  const container = byId("quick-actions");
  container.replaceChildren();

  const enabledIds = new Set(settings.enabledQuickActions);
  allQuickActions().forEach(({ provider, action }) => {
    if (!enabledIds.has(action.id)) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "quick-action";
    button.dataset.actionId = action.id;

    const badge = document.createElement("span");
    badge.className = "conversation-badge";
    badge.textContent = provider.badge.letter;
    badge.style.backgroundColor = provider.badge.color;

    const text = document.createElement("span");
    text.className = "conversation-title";
    text.textContent = action.label;

    button.append(badge, text);
    button.onclick = () => openUrl(action.url);
    container.appendChild(button);
  });
}

function toggleProviderDropdown() {
  const dropdown = byId("provider-dropdown");
  if (dropdown.classList.contains("hidden")) {
    dropdown.classList.remove("hidden");
    setTimeout(() => {
      document.addEventListener("click", hideOnOutsideClick, { once: true });
    }, 0);
  } else {
    dropdown.classList.add("hidden");
  }
}

function hideProviderDropdown() {
  byId("provider-dropdown").classList.add("hidden");
}

function hideOnOutsideClick() {
  hideProviderDropdown();
}

function openSettings() {
  if (!settings) return;
  const modal = byId("settings-modal");
  if (!modal.classList.contains("hidden")) {
    closeSettings();
    return;
  }
  renderSettingsBody();
  modal.classList.remove("hidden");

  byId("settings-modal-close").onclick = closeSettings;
  modal.onclick = (event) => {
    if (event.target === modal) closeSettings();
  };
  document.addEventListener("keydown", onSettingsKeyDown);
}

function closeSettings() {
  byId("settings-modal").classList.add("hidden");
  document.removeEventListener("keydown", onSettingsKeyDown);
}

function onSettingsKeyDown(event) {
  if (event.key === "Escape") closeSettings();
}

function renderSettingsBody() {
  const body = byId("settings-modal-body");
  body.replaceChildren();

  body.appendChild(renderDefaultProviderSection());
  body.appendChild(renderEnabledProvidersSection());
  body.appendChild(renderQuickActionsSection());
}

function renderDefaultProviderSection() {
  const section = document.createElement("section");
  section.className = "settings-section";

  const title = document.createElement("h3");
  title.textContent = "默认 provider";
  section.appendChild(title);

  const select = document.createElement("select");
  const autoOption = document.createElement("option");
  autoOption.value = "auto";
  autoOption.textContent = "跟随当前页";
  select.appendChild(autoOption);

  providerNames().forEach((name) => {
    const provider = getProvider(name);
    if (!provider) return;
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = provider.label;
    select.appendChild(opt);
  });

  select.value = settings.defaultProvider;
  select.onchange = () => {
    saveSettings({ ...settings, defaultProvider: select.value });
  };
  section.appendChild(select);

  return section;
}

function renderEnabledProvidersSection() {
  const section = document.createElement("section");
  section.className = "settings-section";

  const title = document.createElement("h3");
  title.textContent = "新建对话下拉里显示";
  section.appendChild(title);

  const enabled = new Set(settings.enabledProviders);

  providerNames().forEach((name) => {
    const provider = getProvider(name);
    if (!provider) return;

    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = enabled.has(name);

    const isLastChecked = enabled.size === 1 && enabled.has(name);
    if (isLastChecked) {
      checkbox.disabled = true;
      label.title = "至少保留一个 provider";
    }

    checkbox.onchange = () => {
      const next = new Set(settings.enabledProviders);
      if (checkbox.checked) {
        next.add(name);
      } else {
        next.delete(name);
      }
      saveSettings({ ...settings, enabledProviders: providerNames().filter((p) => next.has(p)) });
    };

    label.append(checkbox, document.createTextNode(provider.label));
    section.appendChild(label);
  });

  return section;
}

function renderQuickActionsSection() {
  const section = document.createElement("section");
  section.className = "settings-section";

  const title = document.createElement("h3");
  title.textContent = "快捷操作";
  section.appendChild(title);

  const enabled = new Set(settings.enabledQuickActions);
  const actions = allQuickActions();

  if (actions.length === 0) {
    const note = document.createElement("p");
    note.textContent = "暂无可用的快捷操作。";
    section.appendChild(note);
    return section;
  }

  actions.forEach(({ provider, action }) => {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = enabled.has(action.id);
    checkbox.onchange = () => {
      const next = new Set(settings.enabledQuickActions);
      if (checkbox.checked) {
        next.add(action.id);
      } else {
        next.delete(action.id);
      }
      saveSettings({ ...settings, enabledQuickActions: [...next] });
    };

    label.append(checkbox, document.createTextNode(`${provider.label} · ${action.label}`));
    section.appendChild(label);
  });

  return section;
}

async function saveSettings(nextSettings) {
  const normalized = LLMNavModel.normalizeSettings(nextSettings, providerNames());
  try {
    await chrome.storage.local.set({ settings: normalized });
  } catch (err) {
    if (err.message && err.message.includes("Extension context invalidated")) {
      showNotice("插件已更新，请刷新页面以继续使用。");
      return;
    }
    throw err;
  }
  // chrome.storage.onChanged 监听器会更新 `settings` 与 UI;此处不直接改本地变量。
}

function showFolderForm() {
  const form = byId("folder-form");
  form.classList.remove("hidden");
  byId("folder-name").focus();
}

async function createFolderFromForm(event) {
  event.preventDefault();

  const input = byId("folder-name");
  const state = await loadState();
  const next = LLMNavModel.createFolder(state, input.value);

  await saveState(next);
  input.value = "";
  byId("folder-form").classList.add("hidden");
  await render();
}

async function render() {
  const sequence = ++renderSequence;
  const container = byId("folders");
  container.replaceChildren();

  const state = await loadState();
  if (sequence !== renderSequence) {
    return;
  }

  const folders = LLMNavModel.filterFoldersForProviders(state, settings.enabledProviders);

  renderNoticeForPageState();

  LLMNavModel.getFolderOrder(folders).forEach((folderName) => {
    container.appendChild(renderFolder(folderName, folders[folderName]));
  });
}

function renderNoticeForPageState() {
  if (!pageState || !pageState.supported) {
    const labels = Object.values(listProviders()).map((provider) => provider.label);
    showNotice(`当前页面不是支持的 LLM 页面。打开 ${labels.join("、")} 后可同步可见历史。`);
    return;
  }

  if (pageState.hasHistory === false) {
    showNotice("未检测到可见历史,已保留已有本地数据。");
    return;
  }

  hideNotice();
}

function renderFolder(folderName, records) {
  const section = document.createElement("section");
  section.className = "folder";
  section.dataset.folder = folderName;

  const row = document.createElement("button");
  row.type = "button";
  row.className = "folder-row";
  row.addEventListener("click", (event) => {
    if (event.target.closest(".folder-action") || event.target.closest(".folder-rename-input")) {
      return;
    }
    toggleFolder(folderName);
  });
  row.addEventListener("dragover", (event) => {
    event.preventDefault();
    section.classList.add("drag-over");
  });
  row.addEventListener("dragleave", () => {
    section.classList.remove("drag-over");
  });
  row.addEventListener("drop", async (event) => {
    event.preventDefault();
    section.classList.remove("drag-over");
    await handleDrop(event, folderName);
  });

  const label = document.createElement("span");
  label.className = "folder-label";
  label.textContent = `${collapsedFolders.has(folderName) ? "▸" : "▾"} ${FOLDER_LABELS[folderName] || folderName}`;

  const count = document.createElement("span");
  count.className = "folder-count";
  count.textContent = String(records.length);

  row.append(label, count);

  if (!LLMNavModel.SYSTEM_FOLDERS.includes(folderName)) {
    row.appendChild(renderFolderActions(folderName, records, label));
  }

  section.appendChild(row);

  if (!collapsedFolders.has(folderName)) {
    const list = document.createElement("div");
    list.className = "conversation-list";
    records.forEach((record) => {
      list.appendChild(renderConversation(record));
    });
    section.appendChild(list);
  }

  return section;
}

function renderFolderActions(folderName, records, labelSpan) {
  const actions = document.createElement("span");
  actions.className = "folder-actions";

  const renameBtn = document.createElement("button");
  renameBtn.type = "button";
  renameBtn.className = "folder-action folder-action-rename";
  renameBtn.title = "重命名";
  renameBtn.textContent = "✎";
  renameBtn.onclick = (event) => {
    event.stopPropagation();
    beginRename(folderName, labelSpan);
  };

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "folder-action folder-action-delete";
  deleteBtn.title = "删除";
  deleteBtn.textContent = "×";
  deleteBtn.onclick = (event) => {
    event.stopPropagation();
    confirmAndDeleteFolder(folderName, records.length);
  };

  actions.append(renameBtn, deleteBtn);
  return actions;
}

async function confirmAndDeleteFolder(folderName, count) {
  if (count > 0) {
    const ok = window.confirm(`移除「${folderName}」?目录内 ${count} 条对话将移到未分类。`);
    if (!ok) return;
  }

  const state = await loadState();
  const next = LLMNavModel.deleteFolder(state, folderName);
  await saveState(next);
  await render();
}

function beginRename(folderName, labelSpan) {
  if (!labelSpan.parentNode) return;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "folder-rename-input";
  input.value = folderName;
  input.maxLength = 40;

  const restore = () => {
    if (input.parentNode) {
      input.parentNode.replaceChild(labelSpan, input);
    }
  };

  const commit = async () => {
    const newName = input.value.trim();
    if (!newName || newName === folderName) {
      restore();
      return;
    }
    const state = await loadState();
    const next = LLMNavModel.renameFolder(state, folderName, newName);
    await saveState(next);
    await render();
  };

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      input.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      input.removeEventListener("blur", commit);
      restore();
    }
  });

  input.addEventListener("blur", commit);

  labelSpan.parentNode.replaceChild(input, labelSpan);
  input.focus();
  input.select();
}

function renderConversation(record) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "conversation-row";
  row.draggable = true;
  row.title = record.title;
  row.addEventListener("click", () => openUrl(record.url));
  row.addEventListener("dragstart", (event) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/json", JSON.stringify({
      provider: record.provider,
      url: record.url
    }));
  });

  const provider = getProvider(record.provider);
  const badge = document.createElement("span");
  badge.className = "conversation-badge";
  if (provider) {
    badge.textContent = provider.badge.letter;
    badge.style.backgroundColor = provider.badge.color;
  } else {
    badge.textContent = "?";
  }

  const title = document.createElement("span");
  title.className = "conversation-title";
  title.textContent = record.title;

  row.append(badge, title);
  return row;
}

function toggleFolder(folderName) {
  if (collapsedFolders.has(folderName)) {
    collapsedFolders.delete(folderName);
  } else {
    collapsedFolders.add(folderName);
  }

  render();
}

async function handleDrop(event, targetFolder) {
  const raw = event.dataTransfer.getData("application/json");
  if (!raw) {
    return;
  }

  const data = JSON.parse(raw);
  const state = await loadState();
  const next = LLMNavModel.moveConversation(state, data.provider, data.url, targetFolder);
  await saveState(next);
  await render();
}

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

async function loadState() {
  try {
    const stored = await chrome.storage.local.get(["folders"]);
    return LLMNavModel.cloneState({
      folders: stored.folders
    });
  } catch (err) {
    if (err.message && err.message.includes("Extension context invalidated")) {
      showNotice("插件已更新，请刷新页面以继续使用。");
      return new Promise(() => {});
    }
    throw err;
  }
}

async function saveState(state) {
  try {
    await chrome.storage.local.set({
      folders: state.folders
    });
  } catch (err) {
    if (err.message && err.message.includes("Extension context invalidated")) {
      showNotice("插件已更新，请刷新页面以继续使用。");
      return new Promise(() => {});
    }
    throw err;
  }
}

function showNotice(message) {
  const notice = byId("notice");
  notice.textContent = message;
  notice.classList.remove("hidden");
}

function hideNotice() {
  const notice = byId("notice");
  notice.textContent = "";
  notice.classList.add("hidden");
}

  if (typeof window !== "undefined") {
    window.LLMNavSidebar = {
      mount,
      updatePageState: (state) => {
        pageState = state || { supported: false };
        renderTopActions();
        render();
      }
    };
  }

  function mount(root, options) {
    return init({ ...(options || {}), root });
  }
})();
