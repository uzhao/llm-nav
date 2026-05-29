const fs = require('fs');
const { Window } = require('happy-dom');

const html = fs.readFileSync('sidebar/gemini.html', 'utf8');
const window = new Window({ url: 'https://gemini.google.com/' });
window.document.write(html);
const document = window.document;

const scraping = {
  historyRootSelector: 'bard-sidenav',
  historyLinkSelector: 'a[href^="/app/"], a[href^="https://gemini.google.com/app/"]',
  historyPathPrefix: "/app/",
  titleSubSelector: ".title-text"
};

function normalizeHistoryUrl(href) {
  try {
    const url = new URL(href, "https://gemini.google.com");
    if (!url.pathname.startsWith(scraping.historyPathPrefix)) return "";
    url.hash = "";
    url.search = "";
    return url.toString();
  } catch (error) {
    return "";
  }
}

const historyRoot = document.querySelector(scraping.historyRootSelector);
const sourceRoot = historyRoot || document;

const seen = new Set();
const records = [];

sourceRoot.querySelectorAll(scraping.historyLinkSelector).forEach((link) => {
  let rawUrl = link.getAttribute("href");
  const url = normalizeHistoryUrl(rawUrl);
  if (!url || seen.has(url)) return;
  seen.add(url);
  records.push(url);
});

console.log("Records found:", records.length);
