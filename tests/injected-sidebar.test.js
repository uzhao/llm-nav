const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function readFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("injected-sidebar source loads sidepanel.html and sidepanel.css", () => {
  const source = readFile("injected-sidebar.js");
  assert.match(source, /sidepanel\.html/);
  assert.match(source, /sidepanel\.css/);
});

test("injected-sidebar uses Shadow DOM open mode", () => {
  const source = readFile("injected-sidebar.js");
  assert.match(source, /attachShadow\(\{\s*mode:\s*"open"\s*\}\)/);
});

test("injected-sidebar creates host with id llmnav-host", () => {
  const source = readFile("injected-sidebar.js");
  assert.match(source, /"llmnav-host"/);
});

test("injected-sidebar bails when LLMNavProvider is missing", () => {
  const source = readFile("injected-sidebar.js");
  assert.match(source, /window\.LLMNavProvider/);
});

test("injected-sidebar uses adoptedStyleSheets for CSS", () => {
  const source = readFile("injected-sidebar.js");
  assert.match(source, /adoptedStyleSheets/);
});

test("injected-sidebar reads collapse state from localStorage", () => {
  const source = readFile("injected-sidebar.js");
  assert.match(source, /llmnav:sidebarCollapsed/);
});


test("injected-sidebar reinjects on MutationObserver detecting host removal", () => {
  const source = readFile("injected-sidebar.js");
  assert.match(source, /MutationObserver/);
});

test("injected-sidebar passes provider config to mount as pageState", () => {
  const source = readFile("injected-sidebar.js");
  assert.match(source, /LLMNavSidebar\.mount/);
  assert.match(source, /pageState/);
});
