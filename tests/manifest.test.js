const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function readManifest() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "../manifest.json"), "utf8"));
}

function loadProviderRegistry() {
  const context = { self: {} };
  ["chatgpt", "gemini", "claude", "deepseek", "grok", "kimi", "perplexity", "manus"].forEach((name) => {
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, `../providers/${name}.js`), "utf8"), context);
  });
  return context.self.LLMNavProviders;
}

test("manifest is MV3 with required permissions", () => {
  const manifest = readManifest();

  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.permissions.includes("storage"));
  assert.ok(manifest.permissions.includes("tabs"));
  assert.ok(manifest.permissions.includes("activeTab"));
});

test("manifest description mentions both ChatGPT and Gemini", () => {
  const manifest = readManifest();
  assert.match(manifest.description, /ChatGPT/);
  assert.match(manifest.description, /Gemini/);
});

test("manifest host_permissions 与注册表 origins 同步", () => {
  const manifest = readManifest();
  const registry = loadProviderRegistry();
  Object.values(registry).forEach((provider) => {
    provider.origins.forEach((origin) => {
      const host = new URL(origin).host;
      assert.ok(
        manifest.host_permissions.includes(`https://${host}/*`),
        `host_permissions 缺少 ${host}`
      );
    });
  });
});

test("manifest content_scripts 统一加载所有 provider 与相关依赖", () => {
  const manifest = readManifest();
  const registry = loadProviderRegistry();
  const providers = Object.values(registry);

  assert.equal(manifest.content_scripts.length, 1, "现在应该统一在一条 content_scripts 加载");
  const entry = manifest.content_scripts[0];

  providers.forEach((provider) => {
    assert.ok(entry.js.includes(`providers/${provider.name}.js`), `${provider.name} 应包含在 js 数组中`);
    provider.matches.forEach((match) => {
      assert.ok(entry.matches.includes(match), `matches 缺少 ${match}`);
    });
  });

  assert.equal(entry.js[entry.js.length - 1], "injected-sidebar.js");
  assert.equal(entry.run_at, "document_idle");
});

test("legacy content-<provider>.js 已被删除", () => {
  assert.equal(fs.existsSync(path.join(__dirname, "../content-chatgpt.js")), false);
  assert.equal(fs.existsSync(path.join(__dirname, "../content-gemini.js")), false);
});

test("manifest 每个 LLM provider 的 content_scripts 加载 sidebar 完整依赖", () => {
  const manifest = readManifest();
  const providerNames = ["chatgpt", "gemini", "claude", "deepseek", "grok", "kimi", "perplexity", "manus"];
  providerNames.forEach((name) => {
    const entry = manifest.content_scripts.find((script) => script.js.includes(`providers/${name}.js`));
    assert.ok(entry, `缺少 ${name} content_scripts 条目`);
    assert.ok(entry.js.includes("storage-model.js"), `${name} 条目缺 storage-model.js`);
    assert.ok(entry.js.includes("sidepanel.js"), `${name} 条目缺 sidepanel.js`);
    assert.ok(entry.js.includes("injected-sidebar.js"), `${name} 条目缺 injected-sidebar.js`);
  });
});

test("manifest 声明 sidebar 模板和样式为 web_accessible_resources", () => {
  const manifest = readManifest();
  assert.ok(Array.isArray(manifest.web_accessible_resources), "缺 web_accessible_resources");
  const entry = manifest.web_accessible_resources.find((e) =>
    Array.isArray(e.resources) && e.resources.includes("sidepanel.html") && e.resources.includes("sidepanel.css")
  );
  assert.ok(entry, "缺 sidepanel.html / sidepanel.css 资源声明");
  ["https://chatgpt.com/*", "https://gemini.google.com/*", "https://claude.ai/*"].forEach((origin) => {
    assert.ok(entry.matches.includes(origin), `${origin} 不在 web_accessible_resources matches`);
  });
});

test("manifest 不再声明 side panel / background / sidePanel 权限", () => {
  const manifest = readManifest();
  assert.equal(manifest.side_panel, undefined);
  assert.equal(manifest.background, undefined);
  assert.equal(manifest.permissions.includes("sidePanel"), false);
});

test("manifest content_scripts 不再加载 content-scraper", () => {
  const manifest = readManifest();
  manifest.content_scripts.forEach((entry) => {
    assert.equal(entry.js.includes("content-scraper.js"), false);
  });
});
