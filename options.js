const DEFAULT_COLORS = ["blue", "green", "red", "yellow", "purple"];

function $(id) { return document.getElementById(id); }

function createGroupRow(groupObj, idx) {
  const div = document.createElement('div');
  div.className = 'group-row';
  div.dataset.index = idx;

  const name = document.createElement('input');
  name.type = 'text';
  name.placeholder = 'group name';
  name.value = groupObj.group || '';

  const domains = document.createElement('input');
  domains.type = 'text';
  domains.placeholder = 'comma separated domains (example.com,example2.com)';
  domains.value = (groupObj.domain || []).join(',');

  const color = document.createElement('select');
  for (const c of DEFAULT_COLORS) {
    const opt = document.createElement('option');
    opt.value = c; opt.textContent = c;
    if (c === groupObj.color) opt.selected = true;
    color.appendChild(opt);
  }

  const del = document.createElement('button');
  del.textContent = 'Delete';
  del.addEventListener('click', () => div.remove());

  div.appendChild(name);
  div.appendChild(domains);
  div.appendChild(color);
  div.appendChild(del);
  return div;
}

function loadConfigurationToUI(cfg) {
  $('minTabCount').value = cfg.minTabCount || 2;
  $('doNotGroupDomains').value = (cfg.doNotGroupDomains || []).join(',');
  const container = $('groupsContainer');
  container.innerHTML = '';
  (cfg.tabGroupCustomNames || []).forEach((g, i) => {
    container.appendChild(createGroupRow(g, i));
  });
}

function readUIToConfiguration() {
  const cfg = { minTabCount: 2, tabGroupCustomNames: [], doNotGroupDomains: [] };
  cfg.minTabCount = parseInt($('minTabCount').value, 10) || 1;
  cfg.doNotGroupDomains = $('doNotGroupDomains').value.split(',').map(s => s.trim()).filter(Boolean);

  const rows = document.querySelectorAll('.group-row');
  rows.forEach(r => {
    const inputs = r.querySelectorAll('input, select');
    const [nameInput, domainsInput, colorSelect] = inputs;
    const group = nameInput.value.trim();
    const domains = domainsInput.value.split(',').map(s => s.trim()).filter(Boolean);
    const color = colorSelect.value;
    if (group && domains.length) {
      cfg.tabGroupCustomNames.push({ group, domain: domains, color });
    }
  });

  return cfg;
}

document.addEventListener('DOMContentLoaded', () => {
  // ask background for current configuration
  chrome.runtime.sendMessage({ action: 'getConfiguration' }, (resp) => {
    const cfg = (resp && resp.configuration) ? resp.configuration : null;
    if (cfg) loadConfigurationToUI(cfg);
    else {
      // fallback: request storage directly
      chrome.storage.sync.get('configuration', items => {
        loadConfigurationToUI(items.configuration || {});
      });
    }
  });

  $('addGroup').addEventListener('click', () => {
    $('groupsContainer').appendChild(createGroupRow({ group: '', domain: [], color: DEFAULT_COLORS[0] }));
  });

  $('saveBtn').addEventListener('click', () => {
    const newCfg = readUIToConfiguration();
    chrome.runtime.sendMessage({ action: 'saveConfiguration', configuration: newCfg }, (resp) => {
      if (resp && resp.success) {
        alert('Saved!');
      } else {
        alert('Save failed');
      }
    });
  });

  $('resetDefault').addEventListener('click', () => {
    if (!confirm('Reset to built-in defaults?')) return;
    chrome.runtime.sendMessage({ action: 'resetConfiguration' }, (resp) => {
      if (resp && resp.success) {
        loadConfigurationToUI(resp.configuration);
        alert('Configuration reset to default!');
      }
    })
  });
});


// Utility: validate configuration shape
function isValidConfiguration(obj) {
  if (typeof obj !== 'object' || obj === null) return false;
  if (typeof obj.minTabCount !== 'number') return false;
  if (!Array.isArray(obj.doNotGroupDomains)) return false;
  if (!Array.isArray(obj.tabGroupCustomNames)) return false;

  for (const g of obj.tabGroupCustomNames) {
    if (typeof g.group !== 'string') return false;
    if (!Array.isArray(g.domain)) return false;
    if (typeof g.color !== 'string') return false;
  }
  return true;
}

// Export configuration to JSON file
$('exportBtn').addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'getConfiguration' }, (resp) => {
    if (!resp || !resp.configuration) {
      alert('Failed to fetch configuration');
      return;
    }
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(resp.configuration, null, 2));
    const dl = document.createElement('a');
    dl.setAttribute("href", dataStr);
    dl.setAttribute("download", "tab-clubs-config.json");
    dl.click();
  });
});

// Trigger file input for import
$('importBtn').addEventListener('click', () => {
  $('importFile').click();
});

// Handle file import
$('importFile').addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (!file) return;

  if (file.type !== "application/json" && !file.name.endsWith(".json")) {
    alert("Please select a valid JSON file");
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const obj = JSON.parse(e.target.result);
      if (!isValidConfiguration(obj)) {
        alert("Invalid configuration format");
        return;
      }

      // Save imported config
      chrome.runtime.sendMessage({ action: 'saveConfiguration', configuration: obj }, (resp) => {
        if (resp && resp.success) {
          loadConfigurationToUI(obj); // refresh UI
          alert("Configuration imported successfully!");
        } else {
          alert("Failed to save configuration");
        }
      });
    } catch (err) {
      alert("Error parsing JSON file: " + err.message);
    }
  };
  reader.readAsText(file);
});