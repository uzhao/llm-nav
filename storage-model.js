(function (root, factory) {
  const api = factory();

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  root.LLMNavModel = api;
})(typeof globalThis !== "undefined" ? globalThis : self, function () {
  const SYSTEM_FOLDERS = ["unclassified", "archived"];

  function createInitialState() {
    return {
      folders: {
        unclassified: [],
        archived: []
      }
    };
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

    return { folders };
  }

  function normalizeRecord(record, provider) {
    return {
      provider,
      title: normalizeTitle(record.title),
      url: normalizeUrl(record.url)
    };
  }

  function isSystemFolder(folderName) {
    return SYSTEM_FOLDERS.includes(folderName);
  }

  function findRecordLocation(state, provider, url) {
    const normalizedUrl = normalizeUrl(url);

    for (const [folderName, records] of Object.entries(state.folders)) {
      const index = records.findIndex((record) => record.provider === provider && record.url === normalizedUrl);
      if (index !== -1) {
        return { folderName, index };
      }
    }

    return null;
  }

  function upsertVisibleConversations(state, provider, records) {
    const next = cloneState(state);
    const normalizedRecords = records
      .map((record) => normalizeRecord(record, provider))
      .filter((record) => record.url);

    const visibleUrls = new Set(normalizedRecords.map((record) => record.url));
    Object.keys(next.folders).forEach((folderName) => {
      next.folders[folderName] = next.folders[folderName].filter((record) => {
        if (record.provider !== provider) {
          return true;
        }

        return visibleUrls.has(record.url);
      });
    });

    const newRecords = [];

    normalizedRecords.forEach((normalized) => {
      const location = findRecordLocation(next, provider, normalized.url);
      if (!location) {
        newRecords.push(normalized);
        return;
      }

      next.folders[location.folderName][location.index] = {
        provider,
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

  function moveConversation(state, provider, url, targetFolder) {
    const next = cloneState(state);
    const normalizedUrl = normalizeUrl(url);

    if (!next.folders[targetFolder]) {
      return next;
    }

    const matches = [];

    for (const [folderName, records] of Object.entries(next.folders)) {
      records.forEach((record, index) => {
        if (record.provider !== provider || record.url !== normalizedUrl) {
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

  function filterFoldersForProviders(state, providerNames) {
    const next = cloneState(state);
    const allowed = new Set(providerNames || []);
    const filtered = {};

    Object.entries(next.folders).forEach(([folderName, records]) => {
      filtered[folderName] = records.filter((record) => allowed.has(record.provider));
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
    filterFoldersForProviders,
    getFolderOrder
  };
});
