(function (root) {
  const config = {
    name: "grok",
    origins: ["https://grok.com"],
    matches: ["https://grok.com/*"],
    newChatUrl: "https://grok.com/",
    label: "Grok",
    badge: { letter: "G", color: "#000000" },
    quickActions: [
      { id: "grok.imagine", label: "图片", url: "https://grok.com/imagine" }
    ],
    scraping: {
      historyRootSelector: 'div[data-variant="sidebar"]',
      historyLinkSelector: 'a[href^="/c/"]',
      historyPathPrefix: "/c/",
      titleSubSelector: "span.truncate",
      hideSidebarSelector: 'div[data-variant="sidebar"]',
      hideStyleId: "llmnav-hide-grok-sidebar"
    }
  };

  root.LLMNavProvider = config;
  root.LLMNavProviders = root.LLMNavProviders || {};
  root.LLMNavProviders[config.name] = config;
})(typeof self !== "undefined" ? self : globalThis);
