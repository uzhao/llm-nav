(function (root) {
  const config = {
    name: "manus",
    origins: ["https://manus.im", "https://app.manus.im"],
    matches: ["https://manus.im/*", "https://app.manus.im/*"],
    newChatUrl: "https://manus.im/",
    label: "Manus",
    badge: { letter: "M", color: "#6b46c1" },
    scraping: {
      accountSelectors: ['div:has(> img[alt*="avatar" i])', 'div[class*="user" i]'],
      accountDisplaySubSelector: null,
      historyRootSelector: 'nav:has(div[data-session-item="true"])',
      historyLinkSelector: 'div[data-session-item="true"]',
      historyPathPrefix: "/",
      urlAttribute: "data-session-id",
      urlPrefix: "/",
      titleSubSelector: "span.truncate",
      hideSidebarSelector: 'nav:has(div[data-session-item="true"])',
      hideStyleId: "llmnav-hide-manus-sidebar"
    }
  };

  root.LLMNavProvider = config;
  root.LLMNavProviders = root.LLMNavProviders || {};
  root.LLMNavProviders[config.name] = config;
})(typeof self !== "undefined" ? self : globalThis);
