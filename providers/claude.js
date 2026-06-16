(function (root) {
  const config = {
    name: "claude",
    origins: ["https://claude.ai"],
    matches: ["https://claude.ai/*"],
    newChatUrl: "https://claude.ai/new",
    label: "Claude",
    badge: { letter: "C", color: "#cc785c" },
    quickActions: [
      { id: "claude.artifacts", label: "artifacts", url: "https://claude.ai/artifacts/my" },
      { id: "claude.code", label: "code", url: "https://claude.ai/code" },
      { id: "claude.design", label: "设计", url: "https://claude.ai/design" }
    ],
    scraping: {
      historyRootSelector: 'nav[aria-label="Sidebar"]',
      historyLinkSelector: 'a[href^="/chat/"]',
      historyPathPrefix: "/chat/",
      titleSubSelector: null,
      hideSidebarSelector: 'nav[aria-label="Sidebar"]',
      hideStyleId: "llmnav-hide-claude-sidebar"
    }
  };

  root.LLMNavProvider = config;
  root.LLMNavProviders = root.LLMNavProviders || {};
  root.LLMNavProviders[config.name] = config;
})(typeof self !== "undefined" ? self : globalThis);
