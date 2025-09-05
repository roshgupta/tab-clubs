const configuration = {
  minTabCount: 2,
  tabGroupCustomNames: [
    {
      group: "github",
      domain: ["github.com"],
      color: "blue",
    },
    {
      group: "social",
      domain: [
        "facebook.com",
        "twitter.com",
        "instagram.com",
        "linkedin.com",
        "x.com",
      ],
      color: "green",
    },
    {
      group: "news",
      domain: ["bbc.com", "cnn.com", "nytimes.com"],
      color: "red",
    },
  ],
  doNotGroupDomains: ["google.com"],
  colorIndex: 0,
  alreadyGroupedTabs: [],
};

const DEFAULT_COLORS = ["blue", "green", "red", "yellow", "purple"];

function extractHost(url) {
  if (!url) return null;
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace(/^www\./, "");
  } catch (error) {
    console.error("Invalid URL:", url, error);
    return null;
  }
}

function validateTab(tab) {
  if (!tab) return true;
  return (
    !tab.url ||
    tab.url.startsWith("chrome://") ||
    tab.url == "chrome://newtab" ||
    tab.url === "about:blank" ||
    configuration.doNotGroupDomains.includes(extractHost(tab.url))
  );
}

function findGroupByDomain(host) {
  for (let group of configuration.tabGroupCustomNames) {
    if (group.domain.includes(host)) {
      return group;
    }
  }
  return null;
}

async function handleTab(tab) {
  if (validateTab(tab)) return;

  const host = extractHost(tab.url);
  if (!host || configuration.doNotGroupDomains.includes(host)) return;

  const matchedGroup = findGroupByDomain(host);
  const groupName = matchedGroup ? matchedGroup.group : host.split(".")[0];
  const groupColor = matchedGroup
    ? matchedGroup.color
    : DEFAULT_COLORS[configuration.colorIndex++ % DEFAULT_COLORS.length];

  const allTabs = await chrome.tabs.query({
    windowId: tab.windowId,
  });
  const relevantTabs = allTabs.filter((t) => {
    const tHost = extractHost(t.url);
    if (!tHost) return false;

    if (matchedGroup) {
      return matchedGroup.domain.includes(tHost);
    } else {
      return tHost === host;
    }
  });

  if (relevantTabs.length < configuration.minTabCount) return;

  const tabIds = relevantTabs.map((t) => t.id);
  const groupId = await chrome.tabs.group({ tabIds });

  chrome.tabGroups.update(groupId, { title: groupName, color: groupColor });
}

async function collapseTabGroup() {
  const tabGroups = await chrome.tabGroups.query({});
  for (const group of tabGroups) {
    await chrome.tabGroups.update(group.id, { collapsed: true });
  }
}

async function expandAllGroup() {
  const tabGroups = await chrome.tabGroups.query({});
  for (const group of tabGroups) {
    await chrome.tabGroups.update(group.id, { collapsed: false });
  }
}

let debounceTimer = null;
const DEBOUNCE_DELAY = 1000;
function debounceHandleTab(tab) {
  if (debounceTimer) clearTimeout(debounceTimer);

  debounceTimer = setTimeout(() => {
    handleTab(tab);
    debounceTimer = null;
  }, DEBOUNCE_DELAY);
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") handleTab(tab);
});

chrome.tabs.onCreated.addListener((tab) => {
  if (
    tab.status === "complete" &&
    tab.url &&
    !tab.url.startsWith("chrome://")
  )
    handleTab(tab);
});

async function groupAllTabs() {
  const tabs = await chrome.tabs.query({});

  for (const tab of tabs) {
    if (validateTab(tab)) continue;
    const host = extractHost(tab.url);
    if (!host) continue;

    const matchedGroup = findGroupByDomain(host);
    const groupName = matchedGroup ? matchedGroup.group : host.split(".")[0];
    const groupColor = matchedGroup
      ? matchedGroup.color
      : DEFAULT_COLORS[configuration.colorIndex++ % DEFAULT_COLORS.length];
    const relevantTabs = tabs.filter((t) => {
      const tHost = extractHost(t.url);
      if (!tHost) return false;

      if (matchedGroup) {
        return matchedGroup.domain.includes(tHost);
      } else {
        return tHost === host;
      }
    });
    if (relevantTabs.length < configuration.minTabCount) continue;

    const tabIds = relevantTabs.map((t) => t.id);
    const groupId = await chrome.tabs.group({ tabIds });
    chrome.tabGroups.update(groupId, {
      title: groupName,
      color: groupColor,
      collapsed: true,
    });
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case "groupTabs":
      groupAllTabs(); // You already have logic for grouping
      break;
    case "collapseGroups":
      collapseTabGroup();
      break;
  }
});