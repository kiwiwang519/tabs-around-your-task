const groupList = document.querySelector("#groupList");
const emptyState = document.querySelector("#emptyState");
const groupTemplate = document.querySelector("#groupTemplate");
const tabTemplate = document.querySelector("#tabTemplate");
const refreshButton = document.querySelector("#refreshButton");
const taskForm = document.querySelector("#taskForm");
const taskList = document.querySelector("#taskList");
const taskEmptyState = document.querySelector("#taskEmptyState");
const taskTemplate = document.querySelector("#taskTemplate");
const taskItemTemplate = document.querySelector("#taskItemTemplate");
const celebration = document.querySelector("#celebration");

let allTabs = [];
let tabMeta = {};
let tasks = [];
let celebrationTimer;
let taskDragId;

function isOwnDashboardTab(tab) {
  if (!chrome.runtime.getURL || !tab.url) return false;

  return tab.url === chrome.runtime.getURL("newtab.html");
}

function getDisplayUrl(tab) {
  if (!tab.url) return "No URL";

  try {
    const url = new URL(tab.url);
    if (url.protocol === "chrome-extension:") return "Extension page";
    return url.href.replace(url.hash, "");
  } catch {
    return tab.url;
  }
}

function getFaviconUrl(tab) {
  if (tab.favIconUrl) return tab.favIconUrl;
  if (!tab.url) return "";

  try {
    const url = new URL(tab.url);
    if (!url.hostname || url.protocol === "chrome:" || url.protocol === "file:") return "";
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(url.hostname)}&sz=64`;
  } catch {
    return "";
  }
}

function getSiteInfo(tab) {
  if (!tab.url) {
    return { key: "unknown", label: "Unknown", detail: "Tabs without a visible URL" };
  }

  try {
    const url = new URL(tab.url);
    if (url.protocol === "chrome:" || url.protocol === "chrome-extension:") {
      return { key: url.protocol, label: "Chrome", detail: "Browser pages" };
    }

    if (url.protocol === "file:") {
      return { key: "local-files", label: "Local files", detail: "file://" };
    }

    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      const port = url.port ? `:${url.port}` : "";
      return { key: `${url.hostname}${port}`, label: `${url.hostname}${port}`, detail: "Local development" };
    }

    const hostname = url.hostname.replace(/^www\./, "");
    return { key: hostname, label: hostname, detail: url.origin };
  } catch {
    return { key: "other", label: "Other", detail: tab.url };
  }
}

function getLastOpenedAt(tab) {
  return tabMeta[String(tab.id)]?.lastOpenedAt || Date.now();
}

function getTabIds(tabs) {
  return tabs.map((tab) => tab.id).filter((id) => typeof id === "number");
}

function getNextTaskName() {
  const usedNumbers = new Set(
    tasks
      .map((task) => /^task(\d+)$/i.exec(task.name.trim()))
      .filter(Boolean)
      .map((match) => Number(match[1]))
  );
  let index = 1;

  while (usedNumbers.has(index)) {
    index += 1;
  }

  return `task${index}`;
}

function formatRelativeTime(timestamp) {
  const seconds = Math.max(1, Math.round((Date.now() - timestamp) / 1000));
  const ranges = [
    ["year", 31536000],
    ["month", 2592000],
    ["week", 604800],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
    ["second", 1]
  ];
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const [unit, size] = ranges.find(([, value]) => seconds >= value);
  return formatter.format(-Math.floor(seconds / size), unit);
}

function formatAbsoluteTime(timestamp) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(timestamp);
}

function groupTabs(tabs) {
  const groups = new Map();

  for (const tab of tabs) {
    const site = getSiteInfo(tab);

    if (!groups.has(site.key)) {
      groups.set(site.key, { ...site, tabs: [] });
    }

    groups.get(site.key).tabs.push(tab);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      tabs: group.tabs.sort((a, b) => getLastOpenedAt(b) - getLastOpenedAt(a))
    }))
    .sort((a, b) => {
      const mostRecentA = Math.max(...a.tabs.map(getLastOpenedAt));
      const mostRecentB = Math.max(...b.tabs.map(getLastOpenedAt));
      return mostRecentB - mostRecentA;
    });
}

function render() {
  const groups = groupTabs(allTabs);

  groupList.replaceChildren();
  emptyState.hidden = groups.length !== 0;

  const fragment = document.createDocumentFragment();

  for (const group of groups) {
    const groupNode = groupTemplate.content.firstElementChild.cloneNode(true);
    const siteMark = groupNode.querySelector(".site-mark");
    const title = groupNode.querySelector("h2");
    const detail = groupNode.querySelector("p");
    const count = groupNode.querySelector(".group-count");
    const tabList = groupNode.querySelector(".tab-list");
    const closeSiteButton = groupNode.querySelector(".close-site");
    const groupTabIds = getTabIds(group.tabs);
    const siteIconUrl = group.tabs.map(getFaviconUrl).find(Boolean);

    siteMark.textContent = group.label.slice(0, 1).toUpperCase();
    if (siteIconUrl) {
      const icon = document.createElement("img");
      icon.src = siteIconUrl;
      icon.alt = "";
      siteMark.textContent = "";
      siteMark.append(icon);
    }
    title.textContent = group.label;
    detail.textContent = group.detail;
    count.textContent = `${group.tabs.length} tab${group.tabs.length === 1 ? "" : "s"}`;
    groupNode.draggable = true;
    groupNode.addEventListener("dragstart", (event) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("application/json", JSON.stringify({
        type: "site",
        label: group.label,
        detail: group.detail,
        tabIds: groupTabIds
      }));
    });
    closeSiteButton.addEventListener("click", () => closeTabs(groupTabIds));

    for (const tab of group.tabs) {
      const timestamp = getLastOpenedAt(tab);
      const tabNode = tabTemplate.content.firstElementChild.cloneNode(true);
      const button = tabNode.querySelector(".tab-main");
      const time = tabNode.querySelector("time");
      const closeTabButton = tabNode.querySelector(".close-tab");

      tabNode.draggable = true;
      tabNode.addEventListener("dragstart", (event) => {
        event.stopPropagation();
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/json", JSON.stringify({
          type: "tab",
          label: tab.title || "Untitled tab",
          detail: getDisplayUrl(tab),
          tabIds: [tab.id]
        }));
      });
      button.innerHTML = "";
      const tabTitle = document.createElement("strong");
      const tabUrl = document.createElement("span");
      tabTitle.textContent = tab.title || "Untitled tab";
      tabUrl.textContent = getDisplayUrl(tab);
      button.append(tabTitle, tabUrl);
      button.addEventListener("click", () => focusTab(tab));

      time.textContent = formatRelativeTime(timestamp);
      time.dateTime = new Date(timestamp).toISOString();
      time.title = formatAbsoluteTime(timestamp);
      closeTabButton.addEventListener("click", () => closeTabs([tab.id]));

      tabList.append(tabNode);
    }

    fragment.append(groupNode);
  }

  groupList.append(fragment);
  renderTasks();
}

async function focusTab(tab) {
  await chrome.windows.update(tab.windowId, { focused: true });
  await chrome.tabs.update(tab.id, { active: true });
}

async function closeTabs(tabIds) {
  const ids = tabIds.filter((id) => typeof id === "number");
  if (ids.length === 0) return;

  await chrome.tabs.remove(ids);
  tasks = tasks.map((task) => ({
    ...task,
    items: task.items
      .map((item) => ({
        ...item,
        tabIds: item.tabIds.filter((id) => !ids.includes(id))
      }))
      .filter((item) => item.tabIds.length > 0)
  }));
  await saveTasks();
  await loadTabs();
}

async function closeTaskItem(taskId, itemIndex) {
  const task = tasks.find((item) => item.id === taskId);
  const taskItem = task?.items[itemIndex];
  if (!taskItem) return;

  await closeTabs(taskItem.tabIds);
}

async function completeTask(taskId) {
  const task = tasks.find((item) => item.id === taskId);
  if (!task) return;

  const openTabIds = new Set(allTabs.map((tab) => tab.id));
  const ids = [...new Set(task.items.flatMap((item) => item.tabIds))]
    .filter((id) => typeof id === "number" && openTabIds.has(id));

  tasks = tasks
    .filter((item) => item.id !== taskId)
    .map((item) => ({
      ...item,
      items: item.items
        .map((taskItem) => ({
          ...taskItem,
          tabIds: taskItem.tabIds.filter((id) => !ids.includes(id))
        }))
        .filter((taskItem) => taskItem.tabIds.length > 0)
    }));
  await saveTasks();

  if (ids.length > 0) {
    await chrome.tabs.remove(ids);
  }

  celebrateTaskComplete(task.name);
  await loadTabs();
}

function celebrateTaskComplete(taskName) {
  if (!celebration) return;

  clearTimeout(celebrationTimer);
  celebration.querySelector("p").textContent = `${taskName} complete`;
  celebration.hidden = false;
  celebration.classList.remove("is-showing");
  void celebration.offsetWidth;
  celebration.classList.add("is-showing");

  celebrationTimer = setTimeout(() => {
    celebration.classList.remove("is-showing");
    celebration.hidden = true;
  }, 1900);
}

async function saveTasks() {
  await chrome.storage.local.set({ tasks });
}

function createTask(name) {
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    name,
    items: []
  };
}

function getDragPayload(event) {
  const raw = event.dataTransfer.getData("application/json");
  if (!raw) return null;

  try {
    const payload = JSON.parse(raw);
    if (!Array.isArray(payload.tabIds) || !payload.type || !payload.label) return null;
    return payload;
  } catch {
    return null;
  }
}

function addPayloadToTask(taskId, payload) {
  tasks = tasks.map((task) => {
    if (task.id !== taskId) return task;

    const key = `${payload.type}:${payload.label}:${payload.tabIds.join(",")}`;
    const existingKeys = new Set(task.items.map((item) => `${item.type}:${item.label}:${item.tabIds.join(",")}`));
    if (existingKeys.has(key)) return task;

    return {
      ...task,
      items: [...task.items, payload]
    };
  });
}

function renameTask(taskId, name) {
  const trimmed = name.trim();
  tasks = tasks.map((task) => (
    task.id === taskId ? { ...task, name: trimmed || getNextTaskName() } : task
  ));
}

function reorderTask(sourceId, targetId) {
  if (!sourceId || !targetId || sourceId === targetId) return false;

  const sourceIndex = tasks.findIndex((task) => task.id === sourceId);
  const targetIndex = tasks.findIndex((task) => task.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) return false;

  const nextTasks = [...tasks];
  const [sourceTask] = nextTasks.splice(sourceIndex, 1);
  nextTasks.splice(targetIndex, 0, sourceTask);
  tasks = nextTasks;
  return true;
}

async function moveTabsTogether(tabIds) {
  const ids = tabIds.filter((id) => typeof id === "number");
  if (ids.length === 0) return;

  const tabsById = new Map(allTabs.map((tab) => [tab.id, tab]));
  const firstTab = tabsById.get(ids[0]);
  if (!firstTab) return;

  try {
    await chrome.tabs.move(ids, {
      windowId: firstTab.windowId,
      index: -1
    });
  } catch (error) {
    console.warn("Could not move tabs together", error);
  }
}

function renderTasks() {
  taskList.replaceChildren();
  taskEmptyState.hidden = tasks.length !== 0;

  const fragment = document.createDocumentFragment();

  for (const task of tasks) {
    const taskNode = taskTemplate.content.firstElementChild.cloneNode(true);
    const nameField = taskNode.querySelector(".task-name-field");
    const count = taskNode.querySelector("span");
    const items = taskNode.querySelector(".task-items");
    const completeButton = taskNode.querySelector(".complete-task");

    taskNode.draggable = true;
    taskNode.dataset.taskId = task.id;
    nameField.value = task.name;
    count.textContent = String(task.items.length);
    nameField.addEventListener("pointerdown", (event) => event.stopPropagation());
    nameField.addEventListener("change", async () => {
      renameTask(task.id, nameField.value);
      await saveTasks();
      renderTasks();
    });
    nameField.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        nameField.blur();
      }
    });
    completeButton.addEventListener("click", () => completeTask(task.id));
    taskNode.addEventListener("dragstart", (event) => {
      if (event.target.closest("input, button, .task-item")) {
        event.preventDefault();
        return;
      }

      taskDragId = task.id;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("application/x-task-id", task.id);
      taskNode.classList.add("is-dragging");
    });
    taskNode.addEventListener("dragend", () => {
      taskDragId = undefined;
      taskNode.classList.remove("is-dragging");
    });

    taskNode.addEventListener("dragover", (event) => {
      event.preventDefault();
      taskNode.classList.add("is-drag-over");
    });
    taskNode.addEventListener("dragleave", () => {
      taskNode.classList.remove("is-drag-over");
    });
    taskNode.addEventListener("drop", async (event) => {
      event.preventDefault();
      taskNode.classList.remove("is-drag-over");
      const droppedTaskId = event.dataTransfer.getData("application/x-task-id") || taskDragId;
      if (droppedTaskId) {
        if (reorderTask(droppedTaskId, task.id)) {
          await saveTasks();
          renderTasks();
        }
        return;
      }

      const payload = getDragPayload(event);
      if (!payload) return;

      addPayloadToTask(task.id, payload);
      await saveTasks();
      renderTasks();
      await moveTabsTogether(payload.tabIds);
      await loadTabs();
    });

    for (const [index, item] of task.items.entries()) {
      const itemNode = taskItemTemplate.content.firstElementChild.cloneNode(true);
      itemNode.querySelector(".task-item-type").textContent = item.type === "site" ? "site" : "tab";
      itemNode.querySelector(".task-item-name").textContent = item.label;
      itemNode.querySelector(".task-item-close").addEventListener("click", () => closeTaskItem(task.id, index));
      items.append(itemNode);
    }

    fragment.append(taskNode);
  }

  taskList.append(fragment);
}

async function loadTabs() {
  refreshButton.disabled = true;

  try {
    await chrome.runtime.sendMessage({ type: "sync-tab-meta" });
  } catch {
    // The dashboard still works if the service worker is waking up slowly.
  }

  const [tabs, storage] = await Promise.all([
    chrome.tabs.query({}),
    chrome.storage.local.get(["tabMeta", "tasks"])
  ]);

  allTabs = tabs.filter((tab) => !isOwnDashboardTab(tab));
  tabMeta = storage.tabMeta || {};
  tasks = storage.tasks || [];
  render();
  refreshButton.disabled = false;
}

refreshButton.addEventListener("click", loadTabs);
taskForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  tasks = [createTask(getNextTaskName()), ...tasks];
  await saveTasks();
  renderTasks();
});

chrome.tabs.onCreated.addListener(loadTabs);
chrome.tabs.onRemoved.addListener(loadTabs);
chrome.tabs.onUpdated.addListener(loadTabs);
chrome.tabs.onActivated.addListener(loadTabs);
chrome.windows.onFocusChanged.addListener(loadTabs);

loadTabs();
