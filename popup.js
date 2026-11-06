import { analyticsFor } from "./shared/session-core.js";

const start = new Date();
start.setHours(0, 0, 0, 0);
chrome.runtime.sendMessage({ type: "GET_DASHBOARD", start: start.getTime() }, (result) => {
  const stats = result?.analytics || analyticsFor([], []);
  const active = Math.round(stats.totalMs / 60000);
  const time = active >= 60 ? `${Math.floor(active / 60)}h ${active % 60}m` : `${active}m`;
  document.querySelector("#social-time").textContent = time;
  document.querySelector("#summary").textContent = `You've already spent ${time} on your monitored social sites today. ${stats.visits} visit${stats.visits === 1 ? "" : "s"} and ${stats.avoided} avoided.`;
});
