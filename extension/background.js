const TAB_META_KEY = "tabMeta";

async function getTabMeta() {
  const result = await chrome.storage.local.get(TAB_META_KEY);
  return result[TAB_META_KEY] || {};
}

async function setTabMeta(meta) {
  await chrome.storage.local.set({ [TAB_META_KEY]: meta });
}

async function rememberTab(tabId, timestamp = Date.now()) {
  if (typeof tabId !== "number") return;

  const meta = await getTabMeta();
  meta[String(tabId)] = {
    ...(meta[String(tabId)] || {}),
    lastOpenedAt: timestamp
  };
  await setTabMeta(meta);
}

async function removeTab(tabId) {
  const meta = await getTabMeta();
  delete meta[String(tabId)];
  await setTabMeta(meta);
}

async function pruneMissingTabs() {
  const tabs = await chrome.tabs.query({});
  const openIds = new Set(tabs.map((tab) => String(tab.id)));
  const meta = await getTabMeta();
  let changed = false;

  for (const tabId of Object.keys(meta)) {
    if (!openIds.has(tabId)) {
      delete meta[tabId];
      changed = true;
    }
  }

  for (const tab of tabs) {
    const key = String(tab.id);
    if (!meta[key]) {
      meta[key] = { lastOpenedAt: Date.now() };
      changed = true;
    }
  }

  if (changed) {
    await setTabMeta(meta);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  pruneMissingTabs();
});

chrome.runtime.onStartup.addListener(() => {
  pruneMissingTabs();
});

chrome.tabs.onCreated.addListener((tab) => {
  rememberTab(tab.id);
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  rememberTab(tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  removeTab(tabId);
});

chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  removeTab(removedTabId);
  rememberTab(addedTabId);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "sync-tab-meta") return false;

  pruneMissingTabs()
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});
