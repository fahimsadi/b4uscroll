import { analyticsFor, sessionsToCsv, siteLabel } from "./shared/session-core.js";

const $ = (selector) => document.querySelector(selector);
let selectedRange = "today";
let state;
let customSites = [];

function rangeBounds(range) {
  const now = new Date();
  if (range === "all") return { start: 0, end: Date.now() };
  const start = new Date(now);
  if (range === "today") start.setHours(0, 0, 0, 0);
  else start.setDate(start.getDate() - (range === "7d" ? 6 : 29)), start.setHours(0, 0, 0, 0);
  return { start: start.getTime(), end: Date.now() };
}

const formatMinutes = (ms) => {
  const minutes = Math.round(Number(ms || 0) / 60000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
};

function renderChart(sessions, bounds) {
  let buckets;
  if (selectedRange === "all") {
    const now = new Date();
    const earliest = sessions.length ? new Date(Math.min(...sessions.map((session) => session.startTime))) : now;
    const monthCount = (now.getFullYear() - earliest.getFullYear()) * 12 + now.getMonth() - earliest.getMonth() + 1;
    const stepMonths = monthCount <= 18 ? 1 : monthCount <= 60 ? 3 : 12;
    const first = new Date(earliest.getFullYear(), earliest.getMonth() - (earliest.getMonth() % stepMonths), 1);
    buckets = [];
    for (let start = new Date(first); start <= now; start.setMonth(start.getMonth() + stepMonths)) {
      const label = stepMonths === 1
        ? start.toLocaleDateString(undefined, { month: "short", year: "2-digit" })
        : stepMonths === 3
          ? `Q${Math.floor(start.getMonth() / 3) + 1} ${String(start.getFullYear()).slice(-2)}`
          : String(start.getFullYear());
      buckets.push({ start: new Date(start), ms: 0, label });
    }
    sessions.forEach((session) => {
      const date = new Date(session.startTime);
      const monthsFromFirst = (date.getFullYear() - first.getFullYear()) * 12 + date.getMonth() - first.getMonth();
      const bucket = buckets[Math.floor(monthsFromFirst / stepMonths)];
      if (bucket) bucket.ms += Number(session.activeMs || 0);
    });
    $("#chart-subtitle").textContent = `Minutes spent in planned sessions, by ${stepMonths === 1 ? "month" : stepMonths === 3 ? "quarter" : "year"}`;
  } else {
    const days = selectedRange === "today" ? 1 : selectedRange === "7d" ? 7 : 30;
    buckets = Array.from({ length: days }, (_, index) => {
      const day = new Date(bounds.start + index * 86400000);
      day.setHours(0, 0, 0, 0);
      return { start: day, ms: 0, label: day.toLocaleDateString(undefined, { weekday: days <= 7 ? "short" : undefined, month: "numeric", day: "numeric" }) };
    });
    sessions.forEach((session) => {
      const day = new Date(session.startTime); day.setHours(0, 0, 0, 0);
      const bucket = buckets.find((item) => item.start.getTime() === day.getTime());
      if (bucket) bucket.ms += Number(session.activeMs || 0);
    });
    $("#chart-subtitle").textContent = "Minutes spent in planned sessions, by day";
  }
  const max = Math.max(...buckets.map((item) => item.ms), 60000);
  $("#daily-chart").innerHTML = buckets.map((item) => `<div class="bar" title="${item.label}: ${formatMinutes(item.ms)}"><i style="height:${Math.max(2, (item.ms / max) * 100)}%"></i><span>${item.label}</span></div>`).join("");
}

function renderBreakdown(stats) {
  const sites = Object.keys(stats.bySite);
  const total = Math.max(...sites.map((site) => stats.bySite[site] || 0), 1);
  $("#site-breakdown").innerHTML = sites.map((site) => {
    const ms = stats.bySite[site] || 0;
    return `<div class="break-row"><div><span>${siteLabel(site)}</span><strong>${formatMinutes(ms)}</strong></div><div class="track"><i style="width:${(ms / total) * 100}%"></i></div></div>`;
  }).join("");
  $("#reason-list").innerHTML = stats.reasons.length ? stats.reasons.slice(0, 4).map(([reason, count]) => `<div class="reason-row"><div><span>${escapeHtml(reason)}</span><strong>${count}</strong></div><div class="track"><i style="width:${(count / stats.reasons[0][1]) * 100}%"></i></div></div>`).join("") : '<p class="muted">Your intentions will appear here.</p>';
}

function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])); }

function renderHistory(sessions) {
  const rows = sessions.slice().sort((a, b) => b.startTime - a.startTime);
  $("#session-rows").innerHTML = rows.map((s) => `<tr><td>${new Date(s.startTime).toLocaleDateString()}</td><td>${siteLabel(s.website)}</td><td>${escapeHtml(s.reason)}</td><td>${s.plannedMinutes}m</td><td>${formatMinutes(s.activeMs)}</td><td>${s.extensions.length}</td><td>${s.status}</td></tr>`).join("");
  $("#empty-history").style.display = rows.length ? "none" : "block";
}

async function refresh() {
  const bounds = rangeBounds(selectedRange);
  const response = await chrome.runtime.sendMessage({ type: "GET_DASHBOARD", ...bounds });
  state = response.state;
  const stats = response.analytics || analyticsFor([], []);
  $("#visits").textContent = stats.visits;
  $("#active-time").textContent = formatMinutes(stats.totalMs);
  $("#avoided").textContent = stats.avoided;
  $("#average").textContent = formatMinutes(stats.averageMs);
  $("#extensions").textContent = stats.extensionCount;
  renderChart(stats.sessions, bounds);
  renderBreakdown(stats);
  renderHistory(stats.sessions);
  loadSettings(state.settings);
}

function loadSettings(settings) {
  const form = $("#settings-form");
  ["facebookEnabled", "instagramEnabled", "linkedinEnabled", "pauseWhenInactive"].forEach((name) => { form.elements[name].checked = Boolean(settings[name]); });
  form.elements.defaultMinutes.value = settings.defaultMinutes;
  form.elements.reasons.value = (settings.reasons || []).join("\n");
  customSites = [...(settings.customSites || [])];
  renderCustomSites();
}

function renderCustomSites() {
  $("#custom-sites").innerHTML = customSites.length ? customSites.map((site) => `<span class="site-chip">${escapeHtml(site.domain)}<button type="button" data-remove-site="${escapeHtml(site.domain)}" aria-label="Remove ${escapeHtml(site.domain)}">×</button></span>`).join("") : '<span class="muted">No other sites added.</span>';
  document.querySelectorAll("[data-remove-site]").forEach((button) => button.addEventListener("click", () => {
    customSites = customSites.filter((site) => site.domain !== button.dataset.removeSite);
    renderCustomSites();
  }));
}

document.querySelectorAll("[data-range]").forEach((button) => button.addEventListener("click", () => {
  selectedRange = button.dataset.range;
  document.querySelectorAll("[data-range]").forEach((item) => item.classList.toggle("selected", item === button));
  refresh();
}));
document.querySelectorAll(".nav").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll(".nav").forEach((item) => item.classList.toggle("active", item === button));
  document.querySelectorAll(".view").forEach((item) => item.classList.toggle("active", item.id === button.dataset.view));
}));
$("#settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const settings = {
    facebookEnabled: form.elements.facebookEnabled.checked,
    instagramEnabled: form.elements.instagramEnabled.checked,
    linkedinEnabled: form.elements.linkedinEnabled.checked,
    pauseWhenInactive: form.elements.pauseWhenInactive.checked,
    defaultMinutes: Math.max(1, Math.min(120, Number(form.elements.defaultMinutes.value) || 10)),
    reasons: form.elements.reasons.value.split("\n").map((reason) => reason.trim()).filter(Boolean).slice(0, 12),
    customSites
  };
  await chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings });
  $("#settings-status").textContent = "Saved.";
  setTimeout(() => { $("#settings-status").textContent = ""; }, 2200);
  refresh();
});
$("#add-custom-site").addEventListener("click", async () => {
  const input = $("#custom-site");
  let domain;
  try { domain = new URL(`https://${input.value.trim().replace(/^https?:\/\//, "")}`).hostname.toLowerCase(); }
  catch (_) { input.focus(); return; }
  if (!domain || customSites.some((site) => site.domain === domain)) { input.focus(); return; }
  const granted = await chrome.permissions.request({ origins: [`*://${domain}/*`, `*://*.${domain}/*`] });
  if (!granted) { $("#settings-status").textContent = "Permission was not granted for that site."; return; }
  customSites.push({ domain, enabled: true });
  input.value = "";
  $("#settings-status").textContent = "Site added. Save settings to start monitoring it.";
  renderCustomSites();
});
$("#download").addEventListener("click", async () => {
  const result = await chrome.runtime.sendMessage({ type: "EXPORT_CSV" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob(["\ufeff" + (result.csv || sessionsToCsv([]))], { type: "text/csv;charset=utf-8" }));
  link.download = "before-you-scroll-history.csv";
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 500);
});
$("#clear-history").addEventListener("click", async () => {
  if (!confirm("Clear all local Before You Scroll session history and avoided visits? This cannot be undone.")) return;
  await chrome.runtime.sendMessage({ type: "CLEAR_HISTORY" });
  refresh();
});
$("#theme-toggle").addEventListener("click", () => document.documentElement.classList.toggle("forced-dark"));
refresh();
