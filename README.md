# Before You Scroll

Before You Scroll is a private, local-only Chrome extension that adds a mindful pause before Facebook, Instagram, and LinkedIn, then measures active browsing time instead of wall-clock time.

## Install locally

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select the project folder containing `manifest.json`.
5. Pin **Before You Scroll** from Chrome's extensions menu. Its dashboard is also available from the extension icon.

There is no build or server step. All source files are the loadable extension.

## Use it freely

This is a vibe-coded project. Feel free to use, modify, and share it.

Use it at your own risk. Provided as-is, with no warranty.

## What it does

- Shows a confirmation, intention, and time-limit flow on Facebook, Instagram, and LinkedIn.
- Makes the leave action the primary choice on every monitored social site, with positive, non-judgmental reinforcement when a visit is avoided.
- Lets you add any other site from Settings. Chrome requests permission for that specific domain only; removing it from Settings also removes that permission.
- Tracks only while a monitored site is the focused active tab (and, by default, while Chrome is active).
- Treats all open tabs for one site as one session, so changing tabs does not double-count time. Closing that site's final tab completes its authorization; the next visit starts with a new intention prompt.
- Uses persisted session state plus a Chrome alarm to survive service-worker suspension, page refreshes, and browser restarts.
- Displays a blocking time-up screen until the person explicitly extends or leaves.
- Stores session records and avoided visits in `chrome.storage.local`, provides a dashboard, settings, and an Excel-friendly UTF-8 CSV download.

## Privacy

Before You Scroll has no backend, analytics, or external network requests. It only reads the URL domain needed to recognize configured Facebook, Instagram, and LinkedIn pages. It never reads posts, messages, credentials, profiles, or activity outside those sites. Reasons are submitted voluntarily and kept locally.

## Architecture notes

The MV3 service worker owns the durable session record. Every browser-focus/tab/idle event first accrues the old tracking interval, then determines whether a matching focused tab should run the next interval. A one-minute alarm makes expiry reliable even when no navigation happens and avoids relying on an in-memory JavaScript timer. Active session IDs are keyed by website, which prevents duplicate sessions from multiple Facebook or Instagram tabs.

Historical data is deliberately kept in Chrome local storage rather than IndexedDB: the record shape is compact, export is simple, and users can clear it entirely through Settings. The implementation avoids unsafe HTML insertion for user-supplied reasons by escaping dashboard and overlay output.

## Verify

Run the pure session-state tests from this folder:

```powershell
node --test tests/*.test.mjs
```

To test the extension manually, visit Instagram or Facebook in a normal tab, choose an intention and a short time limit, switch tabs to see active-time pausing, and open the dashboard from the extension icon.
