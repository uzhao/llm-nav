(function (root) {
  const config = {
    name: "kimi",
    origins: ["https://www.kimi.com"],
    matches: ["https://www.kimi.com/*"],
    newChatUrl: "https://www.kimi.com/?chat_enter_method=new_chat",
    label: "Kimi",
    badge: { letter: "K", color: "#1b83fb" },
    quickActions: [
      { id: "kimi.slides", label: "ppt", url: "https://www.kimi.com/slides" },
      { id: "kimi.docs", label: "文档", url: "https://www.kimi.com/docs" },
      { id: "kimi.sheets", label: "表格", url: "https://www.kimi.com/sheets" },
      { id: "kimi.websites", label: "网站", url: "https://www.kimi.com/websites" },
      { id: "kimi.deep-research", label: "深度研究", url: "https://www.kimi.com/deep-research" },
      { id: "kimi.agent-swarm", label: "agent集群", url: "https://www.kimi.com/agent-swarm" }
    ],
    scraping: {
      historyRootSelector: "aside.sidebar",
      historyLinkSelector: 'a.chat-info-item[href^="/chat/"]',
      historyPathPrefix: "/chat/",
      titleSubSelector: ".chat-name",
      hideSidebarSelector: "aside.sidebar",
      hideStyleId: "llmnav-hide-kimi-sidebar"
    }
  };

  root.LLMNavProvider = config;
  root.LLMNavProviders = root.LLMNavProviders || {};
  root.LLMNavProviders[config.name] = config;
})(typeof self !== "undefined" ? self : globalThis);
