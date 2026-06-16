(function () {
  if (typeof window === "undefined" || !window.LLMNavProviders) {
    return;
  }

  let provider = null;
  for (const key in window.LLMNavProviders) {
    const p = window.LLMNavProviders[key];
    if (p.origins && p.origins.some(o => location.href.startsWith(o))) {
      provider = p;
      break;
    }
  }

  if (!provider) {
    return;
  }

  if (provider.scraping && provider.scraping.hideSidebarSelector) {
    const style = document.createElement("style");
    style.textContent = `
      ${provider.scraping.hideSidebarSelector} {
        display: none !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  const HOST_ID = "llmnav-host";
  const HANDLE_ID = "llmnav-handle";
  const COLLAPSE_KEY = "llmnav:sidebarCollapsed";

  let hostMargin = null;
  let observerStarted = false;

  const scraping = provider.scraping;
  let syncTimer = 0;

  function scrapeVisibleHistory() {
    const seen = new Set();
    const records = [];
    const historyRoot = document.querySelector(scraping.historyRootSelector);
    const sourceRoot = historyRoot || document;

    sourceRoot.querySelectorAll(scraping.historyLinkSelector).forEach((link) => {
      if (!historyRoot && !isVisible(link)) return;

      let rawUrl = link.getAttribute("href");
      if (!rawUrl && scraping.urlAttribute) {
        rawUrl = link.getAttribute(scraping.urlAttribute);
        if (rawUrl && scraping.urlPrefix) {
          rawUrl = scraping.urlPrefix + rawUrl;
        }
      }

      const url = normalizeHistoryUrl(rawUrl);
      if (!url || seen.has(url)) return;

      seen.add(url);
      records.push({ title: pickTitle(link), url });
    });

    return records;
  }

  function pickTitle(link) {
    const aria = link.getAttribute("aria-label");
    if (aria && aria.trim()) return normalizeTitle(aria);

    if (scraping.titleSubSelector) {
      const node = link.querySelector(scraping.titleSubSelector);
      if (node) return normalizeTitle(node.textContent);
    }

    return normalizeTitle(link.textContent);
  }

  function normalizeHistoryUrl(href) {
    try {
      const url = new URL(href, location.origin);
      if (!url.pathname.startsWith(scraping.historyPathPrefix)) return "";
      url.hash = "";
      url.search = "";
      return url.toString();
    } catch (error) {
      return "";
    }
  }

  function normalizeTitle(title) {
    return String(title || "").replace(/\s+/g, " ").trim() || "未命名对话";
  }

  function isVisible(element) {
    return element.getClientRects().length > 0;
  }

  async function syncVisibleHistory() {
    const records = scrapeVisibleHistory();

    if (window.LLMNavSidebar && window.LLMNavSidebar.updatePageState) {
      window.LLMNavSidebar.updatePageState({
        supported: true,
        provider: provider.name,
        hasHistory: records.length > 0
      });
    }

    try {
      const stored = await chrome.storage.local.get(["folders"]);
      const next = window.LLMNavModel.upsertVisibleConversations(
        { folders: stored.folders },
        provider.name,
        records
      );
      await chrome.storage.local.set({
        folders: next.folders
      });
    } catch (error) {
      void error;
    }
  }

  function scheduleSync() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncVisibleHistory, 500);
  }

  function collapseStorage() {
    return {
      get: () => localStorage.getItem(COLLAPSE_KEY) || "0",
      set: (value) => localStorage.setItem(COLLAPSE_KEY, value)
    };
  }

  function isCollapsed() {
    return collapseStorage().get() === "1";
  }

  function buildHostMarginSheet() {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`
      #${HANDLE_ID} {
        position: fixed;
        left: 0;
        top: 8px;
        width: 40px;
        height: 40px;
        background: #ffffff;
        border: 1px solid #dadce0;
        border-radius: 0 8px 8px 0;
        cursor: pointer;
        display: none;
        align-items: center;
        justify-content: center;
        z-index: 2147483647;
        font-size: 16px;
        color: rgb(31, 31, 31);
      }
      body.llmnav-collapsed #${HANDLE_ID} {
        display: flex;
      }
      #${HOST_ID} {
        position: fixed !important;
        left: 0 !important;
        top: 0 !important;
        width: 360px !important;
        height: 100vh !important;
        z-index: 2147483646 !important;
      }
      ${provider.scraping.hideSidebarSelector} {
        display: none !important;
      }
    `);
    return sheet;
  }

  async function fetchText(filename) {
    const res = await fetch(chrome.runtime.getURL(filename));
    return res.text();
  }

  async function buildShadowSheet() {
    const cssText = await fetchText("sidepanel.css");
    const sheet = new CSSStyleSheet();
    await sheet.replace(cssText);
    return sheet;
  }

  function applyCollapseClass() {
    const host = document.getElementById(HOST_ID);
    if (isCollapsed()) {
      document.body.classList.add("llmnav-collapsed");
      if (host) host.classList.add("llmnav-collapsed");
    } else {
      document.body.classList.remove("llmnav-collapsed");
      if (host) host.classList.remove("llmnav-collapsed");
    }
  }

  function buildHandle() {
    const handle = document.createElement("div");
    handle.id = HANDLE_ID;
    handle.setAttribute("aria-label", "展开侧栏");
    handle.title = "展开";
    handle.textContent = "»";
    handle.onclick = () => {
      collapseStorage().set("0");
      applyCollapseClass();
    };
    return handle;
  }

  async function injectOnce() {
    if (document.getElementById(HOST_ID)) {
      return;
    }

    if (!hostMargin) {
      hostMargin = buildHostMarginSheet();
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, hostMargin];
    }

    if (!document.getElementById(HANDLE_ID)) {
      document.body.appendChild(buildHandle());
    }

    applyCollapseClass();

    const host = document.createElement("div");
    host.id = HOST_ID;
    document.body.appendChild(host);

    const shadowRoot = host.attachShadow({ mode: "open" });
    const sheet = await buildShadowSheet();
    shadowRoot.adoptedStyleSheets = [sheet];

    const html = await fetchText("sidepanel.html");
    const doc = new DOMParser().parseFromString(html, "text/html");
    Array.from(doc.body.children).forEach((node) => shadowRoot.appendChild(node));

    if (window.LLMNavSidebar && window.LLMNavSidebar.mount) {
      window.LLMNavSidebar.mount(shadowRoot, {
        pageState: {
          supported: true,
          provider: provider.name,
          hasHistory: scrapeVisibleHistory().length > 0
        },
        navigate: (url) => {
          window.location.href = url;
        },
        collapseHost: {
          classList: {
            add: (cls) => { host.classList.add(cls); document.body.classList.add(cls); },
            remove: (cls) => { host.classList.remove(cls); document.body.classList.remove(cls); }
          }
        },
        collapseStorage: collapseStorage()
      });
    }
  }

  function startObserver() {
    if (observerStarted) return;
    observerStarted = true;
    const observer = new MutationObserver(() => {
      if (!document.getElementById(HOST_ID)) {
        injectOnce();
      }
    });
    observer.observe(document.body, { childList: true, subtree: false });
  }

  async function start() {
    await injectOnce();
    startObserver();
    syncVisibleHistory();
    window.addEventListener("focus", scheduleSync);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) scheduleSync();
    });
    const scrapeObserver = new MutationObserver(scheduleSync);
    scrapeObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
