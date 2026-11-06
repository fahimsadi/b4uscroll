import { DEFAULT_SETTINGS, accrueActiveTime, allowedMs, analyticsFor, createSession, siteForUrl, siteLabel, sessionsToCsv } from "./shared/session-core.js";

const STATE_KEY = "beforeYouScrollState";
const LEGACY_STATE_KEY = "intentionalState";
const ALARM_NAME = "before-you-scroll-tick";
let queue = Promise.resolve();
chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });

function defaultState() {
  return { settings: { ...DEFAULT_SETTINGS }, sessions: [], avoidedVisits: [], activeBySite: {} };
}

async function readState() {
  const data = await chrome.storage.local.get([STATE_KEY, LEGACY_STATE_KEY]);
  const state = data[STATE_KEY] || data[LEGACY_STATE_KEY] || defaultState();
  state.settings = { ...DEFAULT_SETTINGS, ...(state.settings || {}) };
  delete state.settings.expiryNotifications;
  delete state.settings.theme;
  state.settings.customSites = (state.settings.customSites || []).filter((entry) => typeof entry?.domain === "string");
  if (!state.settings.reasons.includes("Someone sent me a reel")) {
    state.settings.reasons.push("Someone sent me a reel");
  }
  state.sessions ||= [];
  state.avoidedVisits ||= [];
  state.activeBySite ||= {};
  return state;
}

async function saveState(state) {
  await chrome.storage.local.set({ [STATE_KEY]: state });
  await chrome.storage.local.remove(LEGACY_STATE_KEY);
}

function serial(task) {
  const next = queue.then(task, task);
  queue = next.catch(() => {});
  return next;
}

function activeSession(state, site) {
  const id = state.activeBySite[site];
  return id ? state.sessions.find((session) => session.id === id && session.status === "active") : null;
}

function isSiteEnabled(site, settings) {
  if (site?.startsWith("custom:")) return settings.customSites.some((entry) => `custom:${entry.domain}` === site && entry.enabled !== false);
  return Boolean(settings[`${site}Enabled`]);
}

function siteForTab(url, customSites) {
  return siteForUrl(url, customSites);
}

async function currentFocusedSite(customSites) {
  const windows = await chrome.windows.getAll({ populate: true });
  const focused = windows.find((window) => window.focused);
  const tab = focused?.tabs?.find((candidate) => candidate.active);
  if (!tab) return null;
  return { tabId: tab.id, site: siteForTab(tab.url, customSites) };
}

async function browserIsActive() {
  return (await chrome.idle.queryState(60)) === "active";
}

async function sendToSiteTabs(site, message, customSites) {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.filter((tab) => siteForTab(tab.url, customSites) === site).map((tab) => chrome.tabs.sendMessage(tab.id, message).catch(() => {})));
}

function customScriptId(domain) {
  return `before-you-scroll-custom-${domain.replace(/[^a-z0-9]/gi, "-")}`;
}

async function syncCustomSiteScripts(customSites) {
  const registered = await chrome.scripting.getRegisteredContentScripts();
  const oldIds = registered.filter((script) => script.id.startsWith("before-you-scroll-custom-") || script.id.startsWith("intentional-custom-")).map((script) => script.id);
  if (oldIds.length) await chrome.scripting.unregisterContentScripts({ ids: oldIds });
  const permittedSites = [];
  for (const site of customSites.filter((site) => site.enabled !== false)) {
    const hasPermission = await chrome.permissions.contains({ origins: [`*://${site.domain}/*`, `*://*.${site.domain}/*`] });
    if (hasPermission) permittedSites.push(site);
  }
  const scripts = permittedSites.map((site) => ({
    id: customScriptId(site.domain),
    matches: [`*://${site.domain}/*`, `*://*.${site.domain}/*`],
    js: ["content.js"],
    runAt: "document_start"
  }));
  if (scripts.length) await chrome.scripting.registerContentScripts(scripts);
}

async function reconcile(state, now = Date.now()) {
  const focused = await currentFocusedSite(state.settings.customSites);
  const canTrack = !state.settings.pauseWhenInactive || await browserIsActive();
  const openTabs = await chrome.tabs.query({});
  const openSites = new Set(openTabs.map((tab) => siteForTab(tab.url, state.settings.customSites)).filter(Boolean));
  const changed = [];
  for (const site of Object.keys(state.activeBySite)) {
    const session = activeSession(state, site);
    if (!session) continue;
    accrueActiveTime(session, now);
    if (!openSites.has(site)) {
      session.isTracking = false;
      session.endTime = now;
      if (session.activeMs >= allowedMs(session)) {
        session.status = "expired";
        changed.push(session);
      } else {
        session.status = "completed";
      }
      delete state.activeBySite[site];
      continue;
    }
    session.isTracking = Boolean(canTrack && focused?.site === site && isSiteEnabled(site, state.settings));
    if (session.isTracking) session.inactiveSince = null;
    else session.inactiveSince ||= now;
    if (session.activeMs >= allowedMs(session)) {
      session.isTracking = false;
      session.status = "expired";
      session.endTime = now;
      delete state.activeBySite[site];
      changed.push(session);
    } else if (session.inactiveSince && now - session.inactiveSince >= 30 * 60000) {
      // Keep a just-closed session resumable through short interruptions/restarts,
      // but don't leave an unfinished record active indefinitely.
      session.status = "completed";
      session.endTime = now;
      delete state.activeBySite[site];
    }
  }
  return changed;
}

async function reconcileAndNotify() {
  return serial(async () => {
    const state = await readState();
    const expired = await reconcile(state);
    await saveState(state);
    await Promise.all(expired.map((session) => sendToSiteTabs(session.website, { type: "SESSION_EXPIRED", session }, state.settings.customSites)));
  });
}

async function init() {
  await chrome.alarms.clear("intentional-tick");
  await chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
  const state = await readState();
  await syncCustomSiteScripts(state.settings.customSites);
  await reconcileAndNotify();
}
chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === ALARM_NAME) reconcileAndNotify(); });
chrome.tabs.onActivated.addListener(reconcileAndNotify);
chrome.tabs.onUpdated.addListener((_id, change) => { if (change.status === "complete" || change.url) reconcileAndNotify(); });
chrome.tabs.onRemoved.addListener(reconcileAndNotify);
chrome.windows.onFocusChanged.addListener(reconcileAndNotify);
chrome.idle.onStateChanged.addListener(reconcileAndNotify);

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  serial(async () => {
    const state = await readState();
    const now = Date.now();
    const site = sender.tab ? siteForTab(sender.tab.url, state.settings.customSites) : message.site || null;
    const expired = await reconcile(state, now);
    let result;

    if (message.type === "INIT") {
      const enabled = site && isSiteEnabled(site, state.settings);
      const session = site ? activeSession(state, site) : null;
      const recentlyExpired = state.sessions.find((s) => s.website === site && s.status === "expired" && now - s.endTime < 3600000);
      result = { enabled, session, expired: recentlyExpired || null, settings: state.settings, siteLabel: site ? siteLabel(site) : "this site" };
    } else if (message.type === "START_SESSION") {
      if (!site) throw new Error("Unsupported website");
      let session = activeSession(state, site);
      if (!session) {
        session = createSession({ site, reason: message.reason, plannedMinutes: message.plannedMinutes, now });
        state.sessions.push(session);
        state.activeBySite[site] = session.id;
      }
      await reconcile(state, now);
      result = { session, settings: state.settings };
    } else if (message.type === "EXTEND_SESSION") {
      const session = activeSession(state, site) || state.sessions.find((candidate) => candidate.website === site && candidate.status === "expired" && now - candidate.endTime < 3600000);
      if (!session) throw new Error("No active session to extend");
      const minutes = Math.max(1, Math.min(120, Number(message.minutes) || 5));
      session.extensions.push({ minutes, at: now });
      session.status = "active";
      session.endTime = null;
      state.activeBySite[site] = session.id;
      session.lastAccountingAt = now;
      result = { session };
    } else if (message.type === "HEARTBEAT") {
      result = { session: site ? activeSession(state, site) : null };
    } else if (message.type === "AVOID_VISIT") {
      if (site) state.avoidedVisits.push({ site, at: now });
      result = { ok: true };
    } else if (message.type === "GO_BACK") {
      if (sender.tab?.id) {
        try { await chrome.tabs.goBack(sender.tab.id); }
        catch (_) { const tab = await chrome.tabs.create({ active: true }); await chrome.tabs.remove(sender.tab.id); }
      }
      result = { ok: true };
    } else if (message.type === "CLOSE_CURRENT_TAB") {
      if (sender.tab?.id) await chrome.tabs.remove(sender.tab.id);
      result = { ok: true };
    } else if (message.type === "GET_DASHBOARD") {
      result = { state, analytics: analyticsFor(state.sessions, state.avoidedVisits, message.start || 0, message.end || now) };
    } else if (message.type === "SAVE_SETTINGS") {
      const previousCustomSites = state.settings.customSites || [];
      state.settings = { ...state.settings, ...message.settings };
      state.settings.customSites = (state.settings.customSites || []).filter((entry) => typeof entry?.domain === "string");
      const removedSites = previousCustomSites.filter((oldSite) => !state.settings.customSites.some((newSite) => newSite.domain === oldSite.domain));
      await Promise.all(removedSites.map((site) => chrome.permissions.remove({ origins: [`*://${site.domain}/*`, `*://*.${site.domain}/*`] }).catch(() => {})));
      await syncCustomSiteScripts(state.settings.customSites);
      result = { settings: state.settings };
    } else if (message.type === "EXPORT_CSV") {
      result = { csv: sessionsToCsv(state.sessions) };
    } else if (message.type === "CLEAR_HISTORY") {
      state.sessions = [];
      state.avoidedVisits = [];
      state.activeBySite = {};
      result = { ok: true };
    } else {
      result = { ok: false };
    }
    await saveState(state);
    await Promise.all(expired.map((session) => sendToSiteTabs(session.website, { type: "SESSION_EXPIRED", session }, state.settings.customSites)));
    respond(result);
  }).catch((error) => respond({ error: error.message }));
  return true;
});
