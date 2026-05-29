const fs = require('fs');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;

const html = fs.readFileSync('sidebar/gemini.html', 'utf8');
const dom = new JSDOM(html, { url: "https://gemini.google.com/" });
const document = dom.window.document;

const root = document.querySelector('bard-sidenav');
console.log("Root found:", !!root);
if (root) {
  const links = root.querySelectorAll('a[href^="/app/"], a[href^="https://gemini.google.com/app/"]');
  console.log("Links inside root:", links.length);
}

const allLinks = document.querySelectorAll('a[href^="/app/"], a[href^="https://gemini.google.com/app/"]');
console.log("All links in document:", allLinks.length);

