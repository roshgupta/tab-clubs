const DEFAULT_COLORS = ["blue", "green", "red", "yellow", "purple"];

const configuration = {
  minTabCount: 2,
  tabGroupCustomNames: [
    { group: "github", domain: ["github.com"], color: "blue", },
    { group: "social", domain: ["facebook.com", "twitter.com", "instagram.com", "linkedin.com", "x.com", "reddit.com"], color: "green", },
    { group: "news", domain: ["bbc.com", "cnn.com", "nytimes.com"], color: "red", },
  ],
  doNotGroupDomains: ["google.com"],
  alreadyGroupedTabs: new Set(),
};

let colorIndex = 0;
function getNextColor() {
  return DEFAULT_COLORS[colorIndex++ % DEFAULT_COLORS.length];
}



// Build lookup for faster group matching
const domainToGroup = new Map();
for (const g of configuration.tabGroupCustomNames) {
  g.domain.forEach(d => domainToGroup.set(d, g));
}

function extractHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}


function shouldSkipTab(tab) {
  if (!tab?.url) return true;
  if (tab.url.startsWith("chrome://") || tab.url === "about:blank") return true;

  const host = extractHost(tab.url);
  return !host || configuration.doNotGroupDomains.includes(host);
}

function getGroupInfo(host) {
  const matchedGroup = domainToGroup.get(host);
  if (matchedGroup) return { group: matchedGroup.group, color: matchedGroup.color };

  return {
    group: host.split(".")[0],
    color: getNextColor(),
  }
}

async function groupTabs(tabs, host) {
  if (tabs.length < configuration.minTabCount) return;

  const { group, color } = getGroupInfo(host);
  const tabIds = tabs.map(t => t.id);

  const groupId = await chrome.tabs.group({ tabIds });
  await chrome.tabGroups.update(groupId, { title: group, color });
}

async function handleTab(tab) {
  if (shouldSkipTab(tab)) return;

  const host = extractHost(tab.url);
  if (!host) return;

  const { group, color } = getGroupInfo(host);
  const allTabs = await chrome.tabs.query({ windowId: tab.windowId });

  const relevant = allTabs.filter(t => {
    const h = extractHost(t.url);
    return h && getGroupInfo(h).group === group;
  });

  if (relevant.length >= configuration.minTabCount) {
    const tabIds = relevant.map(t => t.id);
    const groupId = await chrome.tabs.group({ tabIds });
    await chrome.tabGroups.update(groupId, { title: group, color });
  }
}

async function groupAllTabs() {
  const tabs = (await chrome.tabs.query({})).filter(t => !shouldSkipTab(t));

  // Bucket tabs by host
  const groupBuckets = {};
  for (const tab of tabs) {
    const host = extractHost(tab.url);
    if (!host) continue;

    const { group, color } = getGroupInfo(host);
    (groupBuckets[group] ||= { tabs: [], color }).tabs.push(tab);
  }

  // Group per group name
  for (const [group, { tabs: bucket, color }] of Object.entries(groupBuckets)) {
    if (bucket.length >= configuration.minTabCount) {
      const tabIds = bucket.map(t => t.id);
      const groupId = await chrome.tabs.group({ tabIds });
      await chrome.tabGroups.update(groupId, { title: group, color, collapsed: true });
    }
  }
}

// Collapse / expand
async function setGroupCollapse(collapsed) {
  const tabGroups = await chrome.tabGroups.query({});
  await Promise.all(
    tabGroups.map(group => chrome.tabGroups.update(group.id, { collapsed }))
  );
}



// Debounce wrapper
let debounceTimer = null;
const DEBOUNCE_DELAY = 500;
function debounce(fn, ...args) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => fn(...args), DEBOUNCE_DELAY);
}


// Event listeners
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") debounce(handleTab, tab);
});

chrome.tabs.onCreated.addListener(tab => {
  if (tab.status === "complete" && tab.url && !tab.url.startsWith("chrome://")) {
    debounce(handleTab, tab);
  }
});

// Message handling
chrome.runtime.onMessage.addListener((message) => {
  switch (message.action) {
    case "groupTabs":
      groupAllTabs();
      break;
    case "collapseGroups":
      setGroupCollapse(true);
      break;
    case "expandGroups":
      setGroupCollapse(false);
      break;
  }
});