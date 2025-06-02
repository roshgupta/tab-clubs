const configuration = {
  minTabCount: 2,
  tabGroupCustomNames: [
    {
      group: "github",
      domain: ["github.com"],
      color: "blue"
    },
    {
      group: "social",
      domain: ["facebook.com", "twitter.com", "instagram.com", "linkedin.com", "x.com"],
      color: "green"
    },
    {
      group: "news",
      domain: ["bbc.com", "cnn.com", "nytimes.com"],
      color: "red"
    }
  ],
  doNotGroupDomains: ["google.com"],
  colorIndex: 0,
  alreadyGroupedTabs: [],
}

const DEFAULT_COLORS = ["blue", "green", "red", "yellow", "purple"];

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    handleTab(tab);
  }
});

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.url && !tab.url.startsWith("chrome://")) {
    handleTab(tab);
  }
});



function extractHost(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch (e) {
    return null;
  }
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
  if (!tab.url || tab.url.startsWith("chrome://") || tab.url === "about:blank") return;

  const host = extractHost(tab.url);
  if (!host || configuration.doNotGroupDomains.includes(host)) return;

  const matchedGroup = findGroupByDomain(host);
  const groupName = matchedGroup ? matchedGroup.group : host.split('.')[0];
  const groupColor = matchedGroup ? matchedGroup.color : DEFAULT_COLORS[configuration.colorIndex++ % DEFAULT_COLORS.length];

  const allTabs = await chrome.tabs.query({});
  const relevantTabs = allTabs.filter(t => {
    const tHost = extractHost(t.url);
    if (!tHost) return false;

    if (matchedGroup) {
      return matchedGroup.domain.includes(tHost);
    } else {
      return tHost === host;
    }
  });

  if (relevantTabs.length < configuration.minTabCount) return;

  const tabIds = relevantTabs.map(t => t.id);
  const groupId = await chrome.tabs.group({ tabIds });

  chrome.tabGroups.update(groupId, { title: groupName, color: groupColor });
}


