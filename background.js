const DEFAULT_COLORS = ["blue", "green", "red", "yellow", "purple"];

const DEFAULT_CONFIGURATION = {
  minTabCount: 2,
  tabGroupCustomNames: [
    { group: "github", domain: ["github.com"], color: "blue", },
    { group: "social", domain: ["facebook.com", "twitter.com", "instagram.com", "linkedin.com", "x.com", "reddit.com"], color: "green", },
    { group: "news", domain: ["bbc.com", "cnn.com", "nytimes.com"], color: "red", },
  ],
  doNotGroupDomains: ["google.com"],
};

let currentConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIGURATION));
let colorIndex = 0;
const domainToGroup = new Map();
const alreadyGroupedTabs = new Set();

function rebuildDomainToGroup() {
  domainToGroup.clear();
  for (const g of currentConfig.tabGroupCustomNames) {
    g.domain.forEach(d => domainToGroup.set(d, g));
  }
}

function loadConfigFromStorage() {
  chrome.storage.sync.get(['configuration', 'colorIndex'], (items) => {
    if (chrome.runtime.lastError) {
      console.error('Failed to read config from storage', chrome.runtime.lastError);
    }

    if (items.configuration) {
      currentConfig = items.configuration;
    } else {
      // first-run: populate storage with defaults so options page sees them
      chrome.storage.sync.set({ configuration: DEFAULT_CONFIGURATION }, () => { });
      currentConfig = DEFAULT_CONFIGURATION;
    }

    colorIndex = (typeof items.colorIndex === 'number') ? items.colorIndex : 0;
    rebuildDomainToGroup();
  });
}

function saveColorIndexToStorage() {
  try {
    chrome.storage.sync.set({ colorIndex });
  } catch (e) {
    console.warn('Could not persist colorIndex', e);
  }
}

function getNextColor() {
  const color = DEFAULT_COLORS[colorIndex % DEFAULT_COLORS.length];
  colorIndex++;
  saveColorIndexToStorage();
  return color;
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
  return !host || (currentConfig.doNotGroupDomains || []).includes(host);
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
  if (tabs.length < (currentConfig.minTabCount || 3)) return;

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

  if (relevant.length >= (currentConfig.minTabCount || 3)) {
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
    if (bucket.length >= (currentConfig.minTabCount || 3)) {
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


function debounce(fn, delay = 500) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  }
}

const debouncedHandleTab = debounce(handleTab, 500);
const debouncedGroupAllTabs = debounce(groupAllTabs, 800);
const debounceSetGroupCollapse = debounce(setGroupCollapse, 300);

// Event listeners
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") debouncedHandleTab(tab);
});

chrome.tabs.onCreated.addListener(tab => {
  if (tab.status === "complete" && tab.url && !tab.url.startsWith("chrome://")) {
    debouncedHandleTab(tab);
  }
});

// Listen to storage changes (in case options page edited configuration)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  if (changes.configuration) {
    currentConfig = changes.configuration.newValue;
    rebuildDomainToGroup();
  }
  if (changes.colorIndex) {
    colorIndex = changes.colorIndex.newValue;
  }
});


// Message handling — options page can call getConfiguration / saveConfiguration
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case 'groupTabs':
      debouncedGroupAllTabs();
      break;
    case 'collapseGroups':
      debounceSetGroupCollapse(true);
      break;
    case 'expandGroups':
      debounceSetGroupCollapse(false);
      break;
    case 'getConfiguration':
      // return current configuration and runtime-only values
      sendResponse({ configuration: currentConfig, colorIndex });
      break;
    case 'saveConfiguration':
      if (message.configuration) {
        currentConfig = message.configuration;
        rebuildDomainToGroup();
        chrome.storage.sync.set({ configuration: currentConfig }, () => {
          sendResponse({ success: true });
        });
        return true; // will respond asynchronously
      }
      sendResponse({ success: false, error: 'missing configuration' });
      break;
    case 'resetConfiguration':
      currentConfig = DEFAULT_CONFIGURATION;
      rebuildDomainToGroup();
      chrome.storage.sync.set({ configuration: currentConfig }, () => {
        sendResponse({ success: true, configuration: currentConfig });
      });
      return true; // keep channel open for async sendResponse
  }
});

// Initialize on load
loadConfigFromStorage();