# Tabs around your task

A small Chrome extension that turns the new tab page into a local tab dashboard.

It starts with four core ideas:

- Group every open tab by website.
- Show when each tab was last opened or activated.
- Close a single tab or every tab from the same website.
- Create named tasks and attach tabs or whole websites to the work they belong to.
- Complete a task to close its related tabs and clear the task from the board.

Everything runs locally in Chrome. There is no server, account, analytics, or external API.

## Install

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the `extension/` folder in this project.
5. Open a new tab.

## Project Structure

```text
extension/
  manifest.json       Chrome extension manifest
  background.js       Tracks tab open and activation timestamps
  newtab.html         New tab page shell
  preview.html        Browser preview with mock tab data
  app.js              Groups tabs, manages tasks, and moves task tabs together
  styles.css          Dashboard styling
```

## Notes

Chrome does not expose a historical "last opened" timestamp for tabs that were already open before the extension was installed. For those tabs, the extension seeds the timestamp the first time it sees them. After that, it keeps the value fresh when tabs are created or activated.

When a tab or website is dropped onto a task, Tabs around your task stores that task locally and asks Chrome to move those tabs together in the same browser window.
