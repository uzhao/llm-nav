(function (root) {
  const config = {
    name: "chatgpt",
    origins: ["https://chatgpt.com", "https://chat.openai.com"],
    matches: ["https://chatgpt.com/*", "https://chat.openai.com/*"],
    newChatUrl: "https://chatgpt.com/",
    label: "ChatGPT",
    badge: { letter: "C", color: "#10a37f" },
    quickActions: [
      { id: "chatgpt.apps", label: "应用", url: "https://chatgpt.com/apps" },
      { id: "chatgpt.images", label: "图片", url: "https://chatgpt.com/images" },
      { id: "chatgpt.deep-research", label: "深度研究", url: "https://chatgpt.com/deep-research" }
    ],
    scraping: {
      accountSelectors: [
        '[data-testid="accounts-profile-button"]',
        '[data-testid="profile-button"]',
        'button[aria-label*="account" i]',
        'button[aria-label*="profile" i]',
        '[aria-label*="@"]'
      ],
      accountDisplaySubSelector: ".truncate",
      historyRootSelector: "#history",
      historyLinkSelector: 'a[href^="/c/"], a[href^="https://chatgpt.com/c/"], a[href^="https://chat.openai.com/c/"]',
      historyPathPrefix: "/c/",
      titleSubSelector: null,
      hideSidebarSelector: '#stage-slideover-sidebar, nav[aria-label="Chat history"], nav[aria-label="聊天记录"], aside:has(a[href^="/c/"])',
      hideStyleId: "llmnav-hide-chatgpt-sidebar"
    }
  };

  root.LLMNavProvider = config;
  root.LLMNavProviders = root.LLMNavProviders || {};
  root.LLMNavProviders[config.name] = config;
})(typeof self !== "undefined" ? self : globalThis);
