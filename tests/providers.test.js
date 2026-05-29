const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadProvider(name) {
  const source = fs.readFileSync(path.join(__dirname, `../providers/${name}.js`), "utf8");
  const context = { self: {} };
  vm.runInNewContext(source, context);
  return context.self;
}

const REQUIRED_SCRAPING_KEYS = [
  "accountSelectors",
  "accountDisplaySubSelector",
  "historyRootSelector",
  "historyLinkSelector",
  "historyPathPrefix",
  "titleSubSelector",
  "hideSidebarSelector",
  "hideStyleId"
];

const REGISTERED_NAMES = ["chatgpt", "gemini", "claude", "deepseek", "grok", "kimi", "perplexity", "manus"];

REGISTERED_NAMES.forEach((name) => {
  test(`providers/${name}.js 注册到 LLMNavProvider 与 LLMNavProviders`, () => {
    const ns = loadProvider(name);
    assert.ok(ns.LLMNavProvider, "LLMNavProvider 未设置");
    assert.equal(ns.LLMNavProvider.name, name);
    assert.ok(ns.LLMNavProviders, "LLMNavProviders 未设置");
    assert.strictEqual(ns.LLMNavProviders[name], ns.LLMNavProvider);
  });

  test(`providers/${name}.js 含完整字段`, () => {
    const config = loadProvider(name).LLMNavProvider;
    assert.ok(Array.isArray(config.origins) && config.origins.length > 0);
    assert.ok(Array.isArray(config.matches) && config.matches.length > 0);
    assert.equal(typeof config.newChatUrl, "string");
    assert.equal(typeof config.label, "string");
    assert.equal(typeof config.badge.letter, "string");
    assert.match(config.badge.color, /^#[0-9a-fA-F]{3,8}$/);

    REQUIRED_SCRAPING_KEYS.forEach((key) => {
      assert.ok(Object.hasOwn(config.scraping, key), `scraping.${key} 缺失`);
    });
  });

  test(`providers/${name}.js origins 与 matches host 部分一致`, () => {
    const config = loadProvider(name).LLMNavProvider;
    const originHosts = config.origins.map((origin) => new URL(origin).host);
    const matchHosts = config.matches.map((match) => match.replace(/^https?:\/\//, "").replace(/\/.*$/, ""));
    originHosts.forEach((host) => {
      assert.ok(matchHosts.includes(host), `origins 中的 ${host} 未出现在 matches`);
    });
  });
});

test("LLMNavProviders 在多次加载后能合并多个 provider", () => {
  const context = { self: {} };
  ["chatgpt", "gemini", "claude", "deepseek", "grok", "kimi", "perplexity", "manus"].forEach((name) => {
    const source = fs.readFileSync(path.join(__dirname, `../providers/${name}.js`), "utf8");
    vm.runInNewContext(source, context);
  });
  assert.deepEqual(
    Object.keys(context.self.LLMNavProviders).sort(),
    ["chatgpt", "claude", "deepseek", "gemini", "grok", "kimi", "manus", "perplexity"]
  );
});
