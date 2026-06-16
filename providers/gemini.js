(function (root) {
  const config = {
    name: "gemini",
    origins: ["https://gemini.google.com"],
    matches: ["https://gemini.google.com/*"],
    newChatUrl: "https://gemini.google.com/app",
    label: "Gemini",
    badge: { letter: "G", color: "#4285f4" },
    quickActions: [
      { id: "gemini.notebooks", label: "笔记本", url: "https://gemini.google.com/notebooks/view" }
    ],
    scraping: {
      historyRootSelector: 'bard-sidenav',
      historyLinkSelector: 'a[href^="/app/"], a[href^="https://gemini.google.com/app/"]',
      historyPathPrefix: "/app/",
      titleSubSelector: ".title-text",
      hideSidebarSelector: "bard-sidenav",
      hideStyleId: "llmnav-hide-gemini-sidebar"
    }
  };

  root.LLMNavProvider = config;
  root.LLMNavProviders = root.LLMNavProviders || {};
  root.LLMNavProviders[config.name] = config;
})(typeof self !== "undefined" ? self : globalThis);
