(function (root) {
  const config = {
    name: "perplexity",
    origins: ["https://www.perplexity.ai"],
    matches: ["https://www.perplexity.ai/*"],
    newChatUrl: "https://www.perplexity.ai/",
    label: "Perplexity",
    badge: { letter: "P", color: "#20808d" },
    quickActions: [
      { id: "perplexity.computer", label: "computer", url: "https://www.perplexity.ai/computer/tasks" }
    ],
    scraping: {
      historyRootSelector: 'nav[aria-label="主导航"], nav[aria-label="Main navigation"]',
      historyLinkSelector: 'a[href^="/search/"]',
      historyPathPrefix: "/search/",
      titleSubSelector: null,
      hideSidebarSelector: 'nav[aria-label="主导航"], nav[aria-label="Main navigation"]',
      hideStyleId: "llmnav-hide-perplexity-sidebar"
    }
  };

  root.LLMNavProvider = config;
  root.LLMNavProviders = root.LLMNavProviders || {};
  root.LLMNavProviders[config.name] = config;
})(typeof self !== "undefined" ? self : globalThis);
