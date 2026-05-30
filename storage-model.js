(function (root, factory) {
  const api = factory();

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  root.LLMNavModel = api;
})(typeof globalThis !== "undefined" ? globalThis : self, function () {
  const UNKNOWN_ACCOUNT = "unknown";
  const SYSTEM_FOLDERS = ["unclassified", "archived"];

  function createInitialState() {
    return {
      folders: {
        unclassified: [],
        archived: []
      },
      activeAccounts: {}
    };
  }

  function normalizeAccount(account) {
    const value = String(account || "").trim();
    return value || UNKNOWN_ACCOUNT;
  }

  function normalizeTitle(title) {
    const value = String(title || "").replace(/\s+/g, " ").trim();
    return value || "未命名对话";
  }

  function normalizeUrl(url) {
    return String(url || "").trim();
  }

  function cloneState(state) {
    const input = state || {};
    const sourceFolders = input.folders || {};
    const folders = {};

    Object.keys(sourceFolders).forEach((folderName) => {
      folders[folderName] = Array.isArray(sourceFolders[folderName])
        ? sourceFolders[folderName].map((record) => ({
            provider: record.provider,
            account: normalizeAccount(record.account),
            title: normalizeTitle(record.title),
            url: normalizeUrl(record.url)
          }))
        : [];
    });

    SYSTEM_FOLDERS.forEach((folderName) => {
      if (!Array.isArray(folders[folderName])) {
        folders[folderName] = [];
      }
    });

    return {
      folders,
      activeAccounts: { ...(input.activeAccounts || {}) }
    };
  }

  function normalizeRecord(record, provider, account) {
    return {
      provider,
      account: normalizeAccount(account),
      title: normalizeTitle(record.title),
      url: normalizeUrl(record.url)
    };
  }

  function isSystemFolder(folderName) {
    return SYSTEM_FOLDERS.includes(folderName);
  }

  function findRecordLocation(state, provider, url, account) {
    const normalizedUrl = normalizeUrl(url);
    const normalizedAccount = normalizeAccount(account);

    for (const [folderName, records] of Object.entries(state.folders)) {
      const index = records.findIndex((record) => record.provider === provider && record.url === normalizedUrl && normalizeAccount(record.account) === normalizedAccount);
      if (index !== -1) {
        return { folderName, index };
      }
    }

    if (normalizedAccount !== UNKNOWN_ACCOUNT) {
      for (const [folderName, records] of Object.entries(state.folders)) {
        const index = records.findIndex((record) => record.provider === provider && record.url === normalizedUrl && normalizeAccount(record.account) === UNKNOWN_ACCOUNT);
        if (index !== -1) {
          return { folderName, index };
        }
      }
    }

    return null;
  }

  function upsertVisibleConversations(state, provider, account, records) {
    const next = cloneState(state);
    const normalizedAccount = normalizeAccount(account);
    const normalizedRecords = records
      .map((record) => normalizeRecord(record, provider, normalizedAccount))
      .filter((record) => record.url);

    if (normalizedAccount !== UNKNOWN_ACCOUNT) {
      next.activeAccounts[provider] = normalizedAccount;
    }

    const visibleUrls = new Set(normalizedRecords.map((record) => record.url));
    Object.keys(next.folders).forEach((folderName) => {
      next.folders[folderName] = next.folders[folderName].filter((record) => {
        if (record.provider !== provider || normalizeAccount(record.account) !== normalizedAccount) {
          return true;
        }

        return visibleUrls.has(record.url);
      });
    });

    const newRecords = [];

    normalizedRecords.forEach((normalized) => {
      const location = findRecordLocation(next, provider, normalized.url, normalized.account);
      if (!location) {
        newRecords.push(normalized);
        return;
      }

      const existing = next.folders[location.folderName][location.index];
      const existingAccount = normalizeAccount(existing.account);
      next.folders[location.folderName][location.index] = {
        provider,
        account: existingAccount === UNKNOWN_ACCOUNT && normalized.account !== UNKNOWN_ACCOUNT ? normalized.account : existingAccount,
        title: normalized.title,
        url: normalized.url
      };
    });

    if (newRecords.length > 0) {
      next.folders.unclassified.unshift(...newRecords);
    }

    return next;
  }

  function createFolder(state, rawName) {
    const folderName = String(rawName || "").trim();
    const next = cloneState(state);

    if (!folderName || isSystemFolder(folderName) || next.folders[folderName]) {
      return next;
    }

    next.folders[folderName] = [];
    return next;
  }

  function deleteFolder(state, folderName) {
    const next = cloneState(state);

    if (isSystemFolder(folderName) || !next.folders[folderName]) {
      return next;
    }

    const records = next.folders[folderName];
    next.folders.unclassified.push(...records);
    delete next.folders[folderName];

    return next;
  }

  function renameFolder(state, oldName, rawNewName) {
    const next = cloneState(state);
    const newName = String(rawNewName || "").trim();

    if (isSystemFolder(oldName) || !next.folders[oldName]) {
      return next;
    }

    if (!newName || isSystemFolder(newName) || next.folders[newName]) {
      return next;
    }

    next.folders[newName] = next.folders[oldName];
    delete next.folders[oldName];

    return next;
  }

  function moveConversation(state, provider, url, targetFolder, account) {
    const next = cloneState(state);
    const normalizedUrl = normalizeUrl(url);
    const hasAccount = arguments.length >= 5;
    const normalizedAccount = normalizeAccount(account);

    if (!next.folders[targetFolder]) {
      return next;
    }

    const matches = [];

    for (const [folderName, records] of Object.entries(next.folders)) {
      records.forEach((record, index) => {
        if (record.provider !== provider || record.url !== normalizedUrl) {
          return;
        }

        if (hasAccount && normalizeAccount(record.account) !== normalizedAccount) {
          return;
        }

        matches.push({ folderName, index });
      });
    }

    if (matches.length !== 1) {
      return next;
    }

    const match = matches[0];
    const removed = next.folders[match.folderName].splice(match.index, 1);
    next.folders[targetFolder].push(removed[0]);

    return next;
  }

  function filterFoldersForProvider(state, provider, accountStatus) {
    const next = cloneState(state);
    const activeAccount = normalizeAccount((accountStatus && accountStatus.account) || next.activeAccounts[provider]);
    const shouldFilterByAccount = !(accountStatus && accountStatus.hasAccount === false) && activeAccount !== UNKNOWN_ACCOUNT;
    const filtered = {};

    Object.entries(next.folders).forEach(([folderName, records]) => {
      filtered[folderName] = records.filter((record) => {
        if (record.provider !== provider) {
          return false;
        }

        if (!shouldFilterByAccount) {
          return true;
        }

        return normalizeAccount(record.account) === activeAccount;
      });
    });

    return filtered;
  }

  function filterFoldersAcrossProviders(state, providerStatuses) {
    const next = cloneState(state);
    const statuses = providerStatuses || {};
    const filtered = {};

    Object.entries(next.folders).forEach(([folderName, records]) => {
      filtered[folderName] = records.filter((record) => {
        const status = statuses[record.provider];
        const activeAccount = normalizeAccount((status && status.account) || next.activeAccounts[record.provider]);
        const shouldFilterByAccount = !(status && status.hasAccount === false) && activeAccount !== UNKNOWN_ACCOUNT;

        if (!shouldFilterByAccount) {
          return true;
        }

        return normalizeAccount(record.account) === activeAccount;
      });
    });

    return filtered;
  }

  function createDefaultSettings(providerNames) {
    return {
      defaultProvider: "auto",
      enabledProviders: [...providerNames],
      enabledQuickActions: []
    };
  }

  function normalizeSettings(stored, providerNames) {
    const known = new Set(providerNames);
    const fallback = createDefaultSettings(providerNames);
    const input = stored || {};

    const defaultProvider = input.defaultProvider === "auto" || known.has(input.defaultProvider)
      ? input.defaultProvider
      : "auto";

    let enabledProviders = Array.isArray(input.enabledProviders)
      ? input.enabledProviders.filter((name) => known.has(name))
      : null;

    if (!enabledProviders || enabledProviders.length === 0) {
      enabledProviders = fallback.enabledProviders;
    }

    const enabledQuickActions = Array.isArray(input.enabledQuickActions)
      ? input.enabledQuickActions.filter((id) => typeof id === "string" && id.includes("."))
      : [];

    return {
      defaultProvider,
      enabledProviders,
      enabledQuickActions
    };
  }

  function getFolderOrder(folders) {
    const names = Object.keys(folders);
    const customFolders = names.filter((name) => !isSystemFolder(name)).sort((left, right) => left.localeCompare(right));
    return [...customFolders, "unclassified", "archived"].filter((name) => names.includes(name));
  }

  return {
    UNKNOWN_ACCOUNT,
    SYSTEM_FOLDERS,
    createInitialState,
    cloneState,
    createFolder,
    deleteFolder,
    renameFolder,
    createDefaultSettings,
    normalizeSettings,
    upsertVisibleConversations,
    moveConversation,
    filterFoldersForProvider,
    filterFoldersAcrossProviders,
    getFolderOrder
  };
});
