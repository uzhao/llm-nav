const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../storage-model.js");

test("initial state contains system folders", () => {
  const state = model.createInitialState();

  assert.deepEqual(Object.keys(state.folders), ["unclassified", "archived"]);
  assert.deepEqual(state.folders.unclassified, []);
  assert.deepEqual(state.folders.archived, []);
});

test("createFolder trims names and rejects empty or system folders", () => {
  const state = model.createInitialState();
  const withCoding = model.createFolder(state, " coding ");
  const withEmpty = model.createFolder(withCoding, "   ");
  const withSystem = model.createFolder(withEmpty, "archived");

  assert.ok(withSystem.folders.coding);
  assert.equal(Object.keys(withSystem.folders).filter((name) => name === "archived").length, 1);
  assert.equal(Object.keys(withSystem.folders).includes(""), false);
});

test("upsertVisibleConversations stores new ChatGPT records in unclassified", () => {
  const next = model.upsertVisibleConversations(model.createInitialState(), "chatgpt", [
    { title: "Python 问题", url: "https://chatgpt.com/c/one" },
    { title: "JS 问题", url: "https://chatgpt.com/c/two" }
  ]);

  assert.deepEqual(next.folders.unclassified, [
    {
      provider: "chatgpt",
      title: "Python 问题",
      url: "https://chatgpt.com/c/one"
    },
    {
      provider: "chatgpt",
      title: "JS 问题",
      url: "https://chatgpt.com/c/two"
    }
  ]);
});

test("upsertVisibleConversations updates title without changing folder", () => {
  const state = model.createFolder(model.createInitialState(), "coding");
  state.folders.coding.push({
    provider: "chatgpt",
    title: "旧标题",
    url: "https://chatgpt.com/c/one"
  });

  const next = model.upsertVisibleConversations(state, "chatgpt", [
    { title: "新标题", url: "https://chatgpt.com/c/one" }
  ]);

  assert.equal(next.folders.coding.length, 1);
  assert.equal(next.folders.coding[0].title, "新标题");
  assert.equal(next.folders.unclassified.length, 0);
});

test("upsertVisibleConversations removes records missing from the current sync", () => {
  const state = model.createFolder(model.createInitialState(), "coding");
  state.folders.unclassified.push(
    { provider: "chatgpt", title: "保留", url: "https://chatgpt.com/c/keep" },
    { provider: "chatgpt", title: "删除", url: "https://chatgpt.com/c/remove" }
  );
  state.folders.coding.push({
    provider: "chatgpt",
    title: "目录内保留",
    url: "https://chatgpt.com/c/folder-keep"
  });
  state.folders.archived.push({
    provider: "gemini",
    title: "其他 provider",
    url: "https://gemini.google.com/app/one"
  });

  const next = model.upsertVisibleConversations(state, "chatgpt", [
    { title: "保留新标题", url: "https://chatgpt.com/c/keep" },
    { title: "目录内保留新标题", url: "https://chatgpt.com/c/folder-keep" },
    { title: "新增", url: "https://chatgpt.com/c/new" }
  ]);

  assert.deepEqual(next.folders.unclassified.map((record) => record.url), [
    "https://chatgpt.com/c/new",
    "https://chatgpt.com/c/keep"
  ]);
  assert.equal(next.folders.unclassified[1].title, "保留新标题");
  assert.deepEqual(next.folders.coding.map((record) => record.url), ["https://chatgpt.com/c/folder-keep"]);
  assert.equal(next.folders.coding[0].title, "目录内保留新标题");
  assert.deepEqual(next.folders.archived.map((record) => record.provider), ["gemini"]);
});

test("upsertVisibleConversations removes existing records when sync has no records", () => {
  const state = model.createInitialState();
  state.folders.unclassified.push({
    provider: "chatgpt",
    title: "已有记录",
    url: "https://chatgpt.com/c/existing"
  });

  const next = model.upsertVisibleConversations(state, "chatgpt", []);

  assert.deepEqual(next.folders.unclassified, []);
});

test("upsertVisibleConversations preserves records from other providers", () => {
  const state = model.createInitialState();
  state.folders.unclassified.push(
    { provider: "chatgpt", title: "ChatGPT", url: "https://chatgpt.com/c/one" },
    { provider: "gemini", title: "Gemini", url: "https://gemini.google.com/app/one" }
  );

  const next = model.upsertVisibleConversations(state, "chatgpt", []);

  assert.deepEqual(next.folders.unclassified.map((r) => r.provider), ["gemini"]);
});

test("filterFoldersForProviders filters records by provider name set", () => {
  const state = model.createInitialState();
  state.folders.unclassified.push(
    { provider: "chatgpt", title: "C", url: "https://chatgpt.com/c/a" },
    { provider: "gemini", title: "G", url: "https://gemini.google.com/app/a" },
    { provider: "claude", title: "CL", url: "https://claude.ai/chat/a" }
  );

  const filtered = model.filterFoldersForProviders(state, ["chatgpt", "gemini"]);

  assert.deepEqual(filtered.unclassified.map((r) => r.title), ["C", "G"]);
});

test("filterFoldersForProviders preserves original insertion order within each folder", () => {
  const state = model.createInitialState();
  state.folders.unclassified.push(
    { provider: "chatgpt", title: "C1", url: "https://chatgpt.com/c/1" },
    { provider: "gemini",  title: "G1", url: "https://gemini.google.com/app/1" },
    { provider: "chatgpt", title: "C2", url: "https://chatgpt.com/c/2" },
    { provider: "gemini",  title: "G2", url: "https://gemini.google.com/app/2" }
  );

  const filtered = model.filterFoldersForProviders(state, ["chatgpt", "gemini"]);

  assert.deepEqual(filtered.unclassified.map((record) => record.title), ["C1", "G1", "C2", "G2"]);
});

test("filterFoldersForProviders works across custom folders", () => {
  const state = model.createFolder(model.createInitialState(), "work");
  state.folders.unclassified.push(
    { provider: "chatgpt", title: "C-A", url: "https://chatgpt.com/c/a" },
    { provider: "gemini",  title: "G-1", url: "https://gemini.google.com/app/1" }
  );
  state.folders.work.push(
    { provider: "chatgpt", title: "C-WORK", url: "https://chatgpt.com/c/work" },
    { provider: "gemini",  title: "G-WORK", url: "https://gemini.google.com/app/work" }
  );

  const filtered = model.filterFoldersForProviders(state, ["chatgpt", "gemini"]);

  assert.deepEqual(filtered.unclassified.map((record) => record.title), ["C-A", "G-1"]);
  assert.deepEqual(filtered.work.map((record) => record.title), ["C-WORK", "G-WORK"]);
  assert.deepEqual(filtered.archived, []);
});

test("moveConversation moves a record from its current folder to target folder", () => {
  const state = model.createFolder(model.createInitialState(), "coding");
  state.folders.unclassified.push({
    provider: "chatgpt",
    title: "Python 问题",
    url: "https://chatgpt.com/c/one"
  });

  const next = model.moveConversation(state, "chatgpt", "https://chatgpt.com/c/one", "coding");

  assert.equal(next.folders.unclassified.length, 0);
  assert.deepEqual(next.folders.coding.map((record) => record.url), ["https://chatgpt.com/c/one"]);
});

test("upsertVisibleConversations prepends a brand new url to unclassified head", () => {
  const state = model.createInitialState();
  state.folders.unclassified.push({
    provider: "chatgpt",
    title: "老对话",
    url: "https://chatgpt.com/c/old"
  });

  const next = model.upsertVisibleConversations(state, "chatgpt", [
    { title: "新对话", url: "https://chatgpt.com/c/new" },
    { title: "老对话", url: "https://chatgpt.com/c/old" }
  ]);

  assert.deepEqual(
    next.folders.unclassified.map((record) => record.url),
    ["https://chatgpt.com/c/new", "https://chatgpt.com/c/old"]
  );
});

test("upsertVisibleConversations preserves DOM order across multiple brand new urls", () => {
  const state = model.createInitialState();
  state.folders.unclassified.push({
    provider: "chatgpt",
    title: "原有",
    url: "https://chatgpt.com/c/old"
  });

  const next = model.upsertVisibleConversations(state, "chatgpt", [
    { title: "最新", url: "https://chatgpt.com/c/a" },
    { title: "次新", url: "https://chatgpt.com/c/b" },
    { title: "再次", url: "https://chatgpt.com/c/c" },
    { title: "原有", url: "https://chatgpt.com/c/old" }
  ]);

  assert.deepEqual(
    next.folders.unclassified.map((record) => record.url),
    [
      "https://chatgpt.com/c/a",
      "https://chatgpt.com/c/b",
      "https://chatgpt.com/c/c",
      "https://chatgpt.com/c/old"
    ]
  );
});

test("upsertVisibleConversations does not move a brand new url that lives in a custom folder", () => {
  let state = model.createFolder(model.createInitialState(), "coding");
  state.folders.coding.push({
    provider: "chatgpt",
    title: "保留在 coding",
    url: "https://chatgpt.com/c/keep"
  });

  const next = model.upsertVisibleConversations(state, "chatgpt", [
    { title: "保留在 coding", url: "https://chatgpt.com/c/keep" },
    { title: "新进来", url: "https://chatgpt.com/c/new" }
  ]);

  assert.deepEqual(next.folders.coding.map((r) => r.url), ["https://chatgpt.com/c/keep"]);
  assert.deepEqual(next.folders.unclassified.map((r) => r.url), ["https://chatgpt.com/c/new"]);
});

test("deleteFolder removes an empty custom folder", () => {
  const state = model.createFolder(model.createInitialState(), "temp");
  const next = model.deleteFolder(state, "temp");

  assert.equal(next.folders.temp, undefined);
  assert.deepEqual(Object.keys(next.folders).sort(), ["archived", "unclassified"]);
});

test("deleteFolder appends conversations to unclassified tail and removes the folder", () => {
  let state = model.createFolder(model.createInitialState(), "coding");
  state.folders.unclassified.push({
    provider: "chatgpt",
    title: "保留",
    url: "https://chatgpt.com/c/keep"
  });
  state.folders.coding.push(
    { provider: "chatgpt", title: "移走 1", url: "https://chatgpt.com/c/m1" },
    { provider: "chatgpt", title: "移走 2", url: "https://chatgpt.com/c/m2" }
  );

  const next = model.deleteFolder(state, "coding");

  assert.equal(next.folders.coding, undefined);
  assert.deepEqual(
    next.folders.unclassified.map((r) => r.url),
    [
      "https://chatgpt.com/c/keep",
      "https://chatgpt.com/c/m1",
      "https://chatgpt.com/c/m2"
    ]
  );
});

test("deleteFolder refuses to remove system folders", () => {
  const state = model.createInitialState();
  const a = model.deleteFolder(state, "unclassified");
  const b = model.deleteFolder(state, "archived");

  assert.ok(a.folders.unclassified);
  assert.ok(b.folders.archived);
});

test("deleteFolder ignores nonexistent folder names", () => {
  const state = model.createInitialState();
  const next = model.deleteFolder(state, "ghost");

  assert.deepEqual(Object.keys(next.folders).sort(), ["archived", "unclassified"]);
});

test("renameFolder renames a custom folder and keeps its records", () => {
  const state = model.createFolder(model.createInitialState(), "coding");
  state.folders.coding.push({
    provider: "chatgpt",
    title: "保留",
    url: "https://chatgpt.com/c/x"
  });

  const next = model.renameFolder(state, "coding", "research");

  assert.equal(next.folders.coding, undefined);
  assert.equal(next.folders.research.length, 1);
  assert.equal(next.folders.research[0].url, "https://chatgpt.com/c/x");
});

test("renameFolder rejects empty or whitespace newName", () => {
  const state = model.createFolder(model.createInitialState(), "coding");

  const a = model.renameFolder(state, "coding", "");
  const b = model.renameFolder(state, "coding", "   ");

  assert.ok(a.folders.coding);
  assert.ok(b.folders.coding);
});

test("renameFolder refuses to rename system folders", () => {
  const state = model.createInitialState();
  const a = model.renameFolder(state, "unclassified", "other");
  const b = model.renameFolder(state, "archived", "old");

  assert.ok(a.folders.unclassified);
  assert.equal(a.folders.other, undefined);
  assert.ok(b.folders.archived);
  assert.equal(b.folders.old, undefined);
});

test("renameFolder refuses newName that equals a system folder name", () => {
  const state = model.createFolder(model.createInitialState(), "coding");
  const a = model.renameFolder(state, "coding", "unclassified");
  const b = model.renameFolder(state, "coding", "archived");

  assert.ok(a.folders.coding);
  assert.ok(b.folders.coding);
});

test("renameFolder refuses newName when it already exists", () => {
  let state = model.createFolder(model.createInitialState(), "coding");
  state = model.createFolder(state, "research");
  state.folders.coding.push({
    provider: "chatgpt",
    title: "X",
    url: "https://chatgpt.com/c/x"
  });

  const next = model.renameFolder(state, "coding", "research");

  assert.ok(next.folders.coding);
  assert.equal(next.folders.research.length, 0);
});

test("renameFolder ignores nonexistent oldName", () => {
  const state = model.createInitialState();
  const next = model.renameFolder(state, "ghost", "newname");

  assert.equal(next.folders.newname, undefined);
});

test("createDefaultSettings returns auto + all providers + no quick actions", () => {
  const settings = model.createDefaultSettings(["chatgpt", "gemini"]);

  assert.equal(settings.defaultProvider, "auto");
  assert.deepEqual(settings.enabledProviders, ["chatgpt", "gemini"]);
  assert.deepEqual(settings.enabledQuickActions, []);
});

test("normalizeSettings returns defaults when stored is undefined", () => {
  const result = model.normalizeSettings(undefined, ["chatgpt", "gemini"]);

  assert.equal(result.defaultProvider, "auto");
  assert.deepEqual(result.enabledProviders, ["chatgpt", "gemini"]);
  assert.deepEqual(result.enabledQuickActions, []);
});

test("normalizeSettings drops unknown providers from enabledProviders", () => {
  const result = model.normalizeSettings(
    { defaultProvider: "auto", enabledProviders: ["chatgpt", "ghost", "gemini"], enabledQuickActions: [] },
    ["chatgpt", "gemini"]
  );

  assert.deepEqual(result.enabledProviders, ["chatgpt", "gemini"]);
});

test("normalizeSettings falls back to all providers when enabledProviders ends up empty", () => {
  const result = model.normalizeSettings(
    { defaultProvider: "auto", enabledProviders: [], enabledQuickActions: [] },
    ["chatgpt", "gemini"]
  );

  assert.deepEqual(result.enabledProviders, ["chatgpt", "gemini"]);
});

test("normalizeSettings resets an unknown defaultProvider to auto", () => {
  const result = model.normalizeSettings(
    { defaultProvider: "ghost", enabledProviders: ["chatgpt"], enabledQuickActions: [] },
    ["chatgpt", "gemini"]
  );

  assert.equal(result.defaultProvider, "auto");
});

test("normalizeSettings preserves a valid concrete defaultProvider", () => {
  const result = model.normalizeSettings(
    { defaultProvider: "gemini", enabledProviders: ["chatgpt", "gemini"], enabledQuickActions: [] },
    ["chatgpt", "gemini"]
  );

  assert.equal(result.defaultProvider, "gemini");
});

test("normalizeSettings filters non-string and malformed quick action ids", () => {
  const result = model.normalizeSettings(
    {
      defaultProvider: "auto",
      enabledProviders: ["chatgpt"],
      enabledQuickActions: ["gemini.notebook", null, 42, "no_dot", "claude.project"]
    },
    ["chatgpt"]
  );

  assert.deepEqual(result.enabledQuickActions, ["gemini.notebook", "claude.project"]);
});
