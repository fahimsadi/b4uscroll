export const DEFAULT_SETTINGS = {
  facebookEnabled: true,
  instagramEnabled: true,
  linkedinEnabled: true,
  defaultMinutes: 10,
  reasons: ["Reply to messages", "Check a specific update", "Someone sent me a reel"],
  pauseWhenInactive: true,
  customSites: []
};

export function siteFromUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === "facebook.com" || host.endsWith(".facebook.com")) return "facebook";
    if (host === "instagram.com" || host.endsWith(".instagram.com")) return "instagram";
    if (host === "linkedin.com" || host.endsWith(".linkedin.com")) return "linkedin";
  } catch (_) {
    // URLs such as chrome:// cannot be monitored.
  }
  return null;
}

export function siteForUrl(url, customSites = []) {
  const builtIn = siteFromUrl(url);
  if (builtIn) return builtIn;
  try {
    const host = new URL(url).hostname.toLowerCase();
    const custom = customSites.find((entry) => host === entry.domain || host.endsWith(`.${entry.domain}`));
    return custom?.enabled !== false ? `custom:${custom.domain}` : null;
  } catch (_) {
    return null;
  }
}

export function siteLabel(site) {
  const builtIn = ({ facebook: "Facebook", instagram: "Instagram", linkedin: "LinkedIn" })[site];
  if (builtIn) return builtIn;
  if (String(site).startsWith("custom:")) return site.slice(7);
  return site;
}

export function createSession({ site, reason, plannedMinutes, now = Date.now() }) {
  return {
    id: `${now}-${Math.random().toString(36).slice(2, 9)}`,
    website: site,
    startTime: now,
    endTime: null,
    reason: String(reason || "Other").slice(0, 240),
    plannedMinutes: Number(plannedMinutes),
    activeMs: 0,
    extensions: [],
    status: "active",
    isTracking: false,
    lastAccountingAt: now,
    inactiveSince: null
  };
}

export function allowedMs(session) {
  const extensionMs = (session.extensions || []).reduce((total, extension) => total + Number(extension.minutes || 0) * 60000, 0);
  return (Number(session.plannedMinutes) * 60000) + extensionMs;
}

export function accrueActiveTime(session, now = Date.now()) {
  if (session.status === "active" && session.isTracking) {
    session.activeMs += Math.max(0, now - Number(session.lastAccountingAt || now));
  }
  session.lastAccountingAt = now;
  return session;
}

export function remainingMs(session) {
  return Math.max(0, allowedMs(session) - Number(session.activeMs || 0));
}

export function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function sessionsToCsv(sessions) {
  const headers = ["date", "website", "start_time", "end_time", "reason", "planned_minutes", "active_minutes", "extensions", "status"];
  const rows = sessions.map((session) => [
    new Date(session.startTime).toISOString().slice(0, 10),
    siteLabel(session.website),
    new Date(session.startTime).toISOString(),
    session.endTime ? new Date(session.endTime).toISOString() : "",
    session.reason,
    session.plannedMinutes,
    (Number(session.activeMs || 0) / 60000).toFixed(2),
    (session.extensions || []).length,
    session.status
  ].map(csvEscape).join(","));
  return [headers.join(","), ...rows].join("\r\n");
}

export function analyticsFor(sessions, avoidedVisits, start = 0, end = Date.now()) {
  const selected = sessions.filter((s) => s.startTime >= start && s.startTime <= end);
  const avoided = avoidedVisits.filter((v) => v.at >= start && v.at <= end);
  const totalMs = selected.reduce((sum, s) => sum + Number(s.activeMs || 0), 0);
  const bySite = { facebook: 0, instagram: 0, linkedin: 0 };
  const reasons = {};
  let extensionCount = 0;
  selected.forEach((s) => {
    bySite[s.website] = (bySite[s.website] || 0) + Number(s.activeMs || 0);
    reasons[s.reason] = (reasons[s.reason] || 0) + 1;
    extensionCount += (s.extensions || []).length;
  });
  return {
    sessions: selected,
    visits: selected.length,
    avoided: avoided.length,
    totalMs,
    averageMs: selected.length ? totalMs / selected.length : 0,
    bySite,
    reasons: Object.entries(reasons).sort((a, b) => b[1] - a[1]),
    extensionCount
  };
}
