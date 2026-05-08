// ─────────────────────────────────────────────
// QuickSnip — Background Service Worker
// Handles variable resolution via cross-tab scraping
// Supports multi-tab selection when multiple tabs match
// ─────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'EXPAND_SNIPPET') {
    handleExpansion(message.snippet).then(sendResponse);
    return true; // keep channel open for async
  }

  if (message.type === 'EXPAND_WITH_SELECTIONS') {
    handleExpansionWithSelections(message.snippet, message.tabSelections).then(sendResponse);
    return true;
  }

  if (message.type === 'START_INSPECTOR') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'INJECT_INSPECTOR' });
      }
    });
  }

  if (message.type === 'CANCEL_INSPECTOR') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'STOP_INSPECTOR' });
        // Reopen popup without saving changes
        chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?tab=true') });
      }
    });
  }

  if (message.type === 'INSPECTOR_RESULT') {
    // 1. Tell all frames to stop
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'STOP_INSPECTOR' });
      }
    });

    // 2. Get draft
    chrome.storage.local.get('draftVariable', (data) => {
      const draft = data.draftVariable || {};
      draft.selector = message.selector;
      draft.preview = message.preview;

      // 3. Save updated draft
      chrome.storage.local.set({ draftVariable: draft }, () => {
        // 4. Open extension in tab mode to resume edit
        chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?tab=true') });
      });
    });
  }
});

/**
 * Resolves all {{variables}} in a snippet's text.
 * If any variable has multiple matching tabs, returns a needsSelection response
 * so the content script can show a tab picker.
 */
async function handleExpansion(snippet) {
  const text = snippet.text;
  const variablePattern = /\{\{(\w+)\}\}/g;
  const matches = [...text.matchAll(variablePattern)];

  if (matches.length === 0) {
    return { expandedText: text };
  }

  // Load configured variables
  const { variables = [] } = await chrome.storage.local.get('variables');
  const variableMap = {};
  for (const v of variables) {
    variableMap[v.name] = v;
  }

  const allTabs = await chrome.tabs.query({});
  const resolved = {};
  const pendingVars = [];
  const checked = new Set();

  for (const match of matches) {
    const varName = match[1];
    if (checked.has(varName)) continue;
    checked.add(varName);

    const varConfig = variableMap[varName];
    if (!varConfig) {
      resolved[varName] = `[${varName}]`;
      continue;
    }

    const matchingTabs = allTabs.filter(tab => matchUrl(tab.url, varConfig.url));

    if (matchingTabs.length === 0) {
      resolved[varName] = `[${varName}]`;
    } else if (matchingTabs.length === 1) {
      // Single match — resolve directly
      try {
        resolved[varName] = await extractFromTab(matchingTabs[0].id, varConfig.selector);
      } catch {
        resolved[varName] = `[${varName}]`;
      }
    } else {
      // Multiple matches — need user selection
      pendingVars.push({
        varName,
        tabs: matchingTabs.map(t => ({
          id: t.id,
          title: t.title || 'Sem título',
          favIconUrl: t.favIconUrl || ''
        }))
      });
    }
  }

  // If any variable needs tab selection, return early
  if (pendingVars.length > 0) {
    return { needsSelection: true, pendingVars, resolvedSoFar: resolved };
  }

  // All resolved — build final text
  const expandedText = text.replace(variablePattern, (_, varName) => {
    return resolved[varName] !== undefined ? resolved[varName] : `[${varName}]`;
  });

  return { expandedText };
}

/**
 * Resolves variables using pre-selected tab IDs from the user.
 */
async function handleExpansionWithSelections(snippet, tabSelections) {
  const text = snippet.text;
  const variablePattern = /\{\{(\w+)\}\}/g;
  const matches = [...text.matchAll(variablePattern)];

  const { variables = [] } = await chrome.storage.local.get('variables');
  const variableMap = {};
  for (const v of variables) {
    variableMap[v.name] = v;
  }

  const allTabs = await chrome.tabs.query({});
  const resolved = {};
  const checked = new Set();

  for (const match of matches) {
    const varName = match[1];
    if (checked.has(varName)) continue;
    checked.add(varName);

    const varConfig = variableMap[varName];
    if (!varConfig) {
      resolved[varName] = `[${varName}]`;
      continue;
    }

    // Use user-selected tab if available
    const selectedTabId = tabSelections[varName];
    if (selectedTabId) {
      try {
        resolved[varName] = await extractFromTab(selectedTabId, varConfig.selector);
      } catch {
        resolved[varName] = `[${varName}]`;
      }
    } else {
      // Fallback to first matching tab
      const matchingTabs = allTabs.filter(tab => matchUrl(tab.url, varConfig.url));
      if (matchingTabs.length > 0) {
        try {
          resolved[varName] = await extractFromTab(matchingTabs[0].id, varConfig.selector);
        } catch {
          resolved[varName] = `[${varName}]`;
        }
      } else {
        resolved[varName] = `[${varName}]`;
      }
    }
  }

  const expandedText = text.replace(variablePattern, (_, varName) => {
    return resolved[varName] !== undefined ? resolved[varName] : `[${varName}]`;
  });

  return { expandedText };
}

/**
 * Extracts content from a specific tab using a CSS selector.
 */
async function extractFromTab(tabId, selector) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;

      // 1. Input ou textarea — valor fica em .value
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
        return el.value.trim() || null;
      }

      // 2. Atributo data-value
      if (el.dataset && el.dataset.value) {
        return el.dataset.value.trim();
      }

      // 3. Nó de texto direto — ignora elementos filhos como <i> e <svg>
      const textNode = [...el.childNodes].find(
        node => node.nodeType === Node.TEXT_NODE && node.textContent.trim() !== ""
      );
      if (textNode) return textNode.textContent.trim();

      // 4. innerText completo como último recurso
      return el.innerText.trim() || null;
    },
    args: [selector]
  });

  // Procurar em todos os frames injetados (o elemento pode estar num iframe)
  const validResult = results?.find(r => r.result);

  if (validResult) {
    return validResult.result;
  }

  throw new Error('Element not found');
}

/**
 * Matches a tab URL against a pattern that supports wildcards (*).
 * Example pattern: "https://ixc.example.com/cliente/*"
 */
function matchUrl(tabUrl, pattern) {
  if (!tabUrl || !pattern) return false;
  try {
    // Escape regex special chars, then replace \* with .*
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    const regex = new RegExp('^' + escaped, 'i');
    return regex.test(tabUrl);
  } catch {
    return tabUrl.includes(pattern);
  }
}
