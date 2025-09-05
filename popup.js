document.getElementById("groupTabs").addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "groupTabs" });
});

document.getElementById("collapseGroups").addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "collapseGroups" });
});

document.getElementById("expandGroups").addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "expandGroups" });
});


