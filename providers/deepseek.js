(function (root) {
  const config = {
    name: "deepseek",
    origins: ["https://chat.deepseek.com"],
    matches: ["https://chat.deepseek.com/*"],
    newChatUrl: "https://chat.deepseek.com/",
    label: "DeepSeek",
    badge: { letter: "D", color: "#4d6bfe" },
    scraping: {
      accountSelectors: ['div:has(> div > img[src*="/user-avatar/"])'],
      accountDisplaySubSelector: null,
      accountRawText: true,
      historyRootSelector: 'div:has(> a[href^="/a/chat/s/"])',
      historyLinkSelector: 'a[href^="/a/chat/s/"]',
      historyPathPrefix: "/a/chat/s/",
      titleSubSelector: null,
      hideSidebarSelector: 'body > div:has(a[href^="/a/chat/s/"])',
      hideStyleId: "llmnav-hide-deepseek-sidebar"
    }
  };

  root.LLMNavProvider = config;
  root.LLMNavProviders = root.LLMNavProviders || {};
  root.LLMNavProviders[config.name] = config;
})(typeof self !== "undefined" ? self : globalThis);
