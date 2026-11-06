(() => {
  const site = location.hostname.includes("instagram.com") ? "instagram" : location.hostname.includes("linkedin.com") ? "linkedin" : location.hostname.includes("facebook.com") ? "facebook" : location.hostname;
  let label = site === "instagram" ? "Instagram" : site === "linkedin" ? "LinkedIn" : site === "facebook" ? "Facebook" : location.hostname;
  let root;
  let shadowRoot;
  let statusRoot;
  let statusShadow;
  let heartbeatStarted = false;
  let session;

  const send = (message) => new Promise((resolve) => chrome.runtime.sendMessage({ ...message, site }, resolve));
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const minutes = (ms) => Math.max(0, Math.ceil(ms / 60000));
  const mount = (html) => {
    root ||= document.documentElement.appendChild(document.createElement("before-you-scroll-gate"));
    const shadow = shadowRoot ||= root.attachShadow({ mode: "closed" });
    shadow.innerHTML = `<style>
      :host{all:initial}.veil{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:22px;background:#f5f2ea;color:#1c2923;font:16px/1.5 Inter,ui-sans-serif,system-ui,sans-serif}.card{width:min(480px,100%);padding:40px;border:1px solid #cfcdbf;border-left:5px solid #285b43;background:#fffdf8;box-shadow:10px 12px 0 #e4dfd3;animation:in .22s ease-out}.mark{font-size:10px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#285b43}h1{font:700 35px/.99 Georgia,"Times New Roman",serif;margin:15px 0 13px;letter-spacing:-.055em}p{line-height:1.55;color:#68736b;margin:0 0 25px}.choices{display:grid;gap:9px}.button,button{min-height:51px;border:1px solid #cfcdbf;border-radius:3px;padding:13px 15px;font:750 15px Inter,ui-sans-serif,system-ui,sans-serif;cursor:pointer;background:#f5f2ea;color:#1c2923;text-align:left;transition:background .15s ease,color .15s ease}.button:hover,button:hover{background:#ebe6da}.button:focus-visible,button:focus-visible,input:focus-visible{outline:2px solid #285b43;outline-offset:3px}.primary{border-color:#285b43;background:#285b43;color:#fff}.primary:hover{background:#193d2d}.secondary{background:transparent}label{display:block;margin-top:14px;font-size:13px;font-weight:800}input{box-sizing:border-box;width:100%;margin:7px 0 14px;border:1px solid #cfcdbf;border-radius:2px;padding:13px;background:#fffdf8;color:#1c2923;font:inherit}.tiny{margin-top:18px;margin-bottom:0;font-size:12px;color:#68736b}.spent{padding:13px;border-top:1px solid #cfcdbf;border-bottom:1px solid #cfcdbf;color:#285b43;font-weight:700}@keyframes in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}@media(max-width:440px){.card{padding:31px 24px}h1{font-size:31px}}@media(prefers-color-scheme:dark){.veil{background:#18201b;color:#edf1ea}.card{border-color:#4a554c;border-left-color:#8bb79a;background:#202a23;box-shadow:10px 12px 0 #101612}p,.tiny{color:#b2bbb2}.button,button{border-color:#4a554c;background:#222d26;color:#edf1ea}.button:hover,button:hover{background:#2c3a30}.primary{border-color:#8bb79a;background:#8bb79a;color:#142118}.primary:hover{background:#b4d4b9}.secondary{background:transparent}input{border-color:#4a554c;background:#18201b;color:#fff}.spent{border-color:#4a554c;color:#d5ead7}}</style><main class="veil" role="dialog" aria-modal="true" aria-label="Before You Scroll check"><section class="card">${html}</section></main>`;
    queueMicrotask(() => shadow.querySelector("button, input")?.focus());
    return shadow;
  };
  const close = () => { root?.remove(); root = undefined; shadowRoot = undefined; };
  const hideStatus = () => { statusRoot?.remove(); statusRoot = undefined; statusShadow = undefined; };
  const showStatus = (record) => {
    if (!record || record.status !== "active") return hideStatus();
    const extraMinutes = (record.extensions || []).reduce((total, extension) => total + Number(extension.minutes || 0), 0);
    const remaining = Math.max(0, Math.ceil((Number(record.plannedMinutes || 0) + extraMinutes) - Number(record.activeMs || 0) / 60000));
    statusRoot ||= document.documentElement.appendChild(document.createElement("before-you-scroll-status"));
    const shadow = statusShadow ||= statusRoot.attachShadow({ mode: "closed" });
    shadow.innerHTML = `<style>:host{all:initial}.chip{position:fixed;right:18px;bottom:18px;z-index:2147483646;display:flex;align-items:center;gap:10px;max-width:calc(100vw - 36px);padding:10px 12px;border:1px solid #cfcdbf;border-left:3px solid #285b43;background:#fffdf8;color:#1c2923;box-shadow:5px 6px 0 #ddd7c9;font:700 12px/1.2 Inter,ui-sans-serif,system-ui,sans-serif}.dot{width:7px;height:7px;background:#285b43}.chip strong{font-weight:800}@media(prefers-color-scheme:dark){.chip{border-color:#4a554c;border-left-color:#8bb79a;background:#202a23;color:#edf1ea;box-shadow:5px 6px 0 #101612}.dot{background:#8bb79a}}</style><div class="chip" role="status"><i class="dot"></i><span>Before You Scroll · <strong>${remaining} min remaining</strong></span></div>`;
  };
  const startHeartbeat = () => {
    if (heartbeatStarted) return;
    heartbeatStarted = true;
    setInterval(async () => {
      const result = await send({ type: "HEARTBEAT" });
      if (result?.session) { session = result.session; showStatus(session); }
      else hideStatus();
    }, 15000);
  };
  const gate = () => {
    const shadow = mount(`<div class="mark">A moment for yourself</div><h1>Do you really need to open ${label} right now?</h1><p>A short pause can protect your attention. Could this wait until later?</p><div class="choices"><button class="primary" id="no">No, not now</button><button class="secondary" id="yes">Continue with a purpose</button></div><p class="tiny">Choosing not to open it is a win for the time you want back.</p>`);
    shadow.getElementById("yes").onclick = reasonStep;
    shadow.getElementById("no").onclick = async () => {
      await send({ type: "AVOID_VISIT" });
      mount(`<div class="mark">Nice choice</div><h1>You chose not to open ${label}.</h1><p>That small pause is how reclaimed time adds up.</p>`);
      setTimeout(() => send({ type: "GO_BACK" }), 900);
    };
  };
  const reasonStep = () => {
    const shadow = mount(`<div class="mark">A small intention</div><h1>What are you here to do?</h1><p>Give this visit a purpose before you begin.</p><div class="choices" id="reasons"></div><label for="custom">Other</label><input id="custom" maxlength="240" placeholder="Write your reason"><button class="primary" id="custom-next">Continue</button>`);
    const reasons = window.__beforeYouScrollSettings?.reasons || ["Reply to messages", "Check a specific update"];
    const container = shadow.getElementById("reasons");
    reasons.forEach((reason) => { const button = document.createElement("button"); button.textContent = reason; button.onclick = () => durationStep(reason); container.append(button); });
    shadow.getElementById("custom-next").onclick = () => { const value = shadow.getElementById("custom").value.trim(); if (value) durationStep(value); else shadow.getElementById("custom").focus(); };
  };
  const durationStep = (reason) => {
    const defaultMinutes = window.__beforeYouScrollSettings?.defaultMinutes || 10;
    const shadow = mount(`<div class="mark">Set a boundary</div><h1>How much time do you need?</h1><p>A gentle limit helps this visit stay on track.</p><div class="choices"><button data-minutes="5">5 minutes</button><button data-minutes="10">10 minutes</button><button data-minutes="15">15 minutes</button><button data-minutes="30">30 minutes</button></div><label for="custom-minutes">Custom duration (minutes)</label><input id="custom-minutes" type="number" min="1" max="120" value="${defaultMinutes}"><button class="primary" id="start">Start planned visit</button>`);
    shadow.querySelectorAll("[data-minutes]").forEach((button) => button.onclick = () => startSession(reason, Number(button.dataset.minutes)));
    shadow.getElementById("start").onclick = () => { const value = Number(shadow.getElementById("custom-minutes").value); if (value >= 1 && value <= 120) startSession(reason, value); else shadow.getElementById("custom-minutes").focus(); };
  };
  const startSession = async (reason, plannedMinutes) => { const result = await send({ type: "START_SESSION", reason, plannedMinutes }); session = result.session; close(); showStatus(session); startHeartbeat(); };
  const expired = (record) => {
    session = record;
    hideStatus();
    const shadow = mount(`<div class="mark">Time check</div><h1>Your time is up!</h1><p>You've reached your planned time. You came here to: <strong>${esc(record.reason)}</strong>.</p><p class="spent">Active time: ${minutes(record.activeMs)} minutes</p><div class="choices"><button class="primary" id="extend">Extend with a purpose</button><button class="secondary" id="leave">Close ${label}</button></div><p class="tiny">Extensions are tracked separately in your dashboard.</p>`);
    shadow.getElementById("extend").onclick = () => extendStep();
    shadow.getElementById("leave").onclick = () => send({ type: "CLOSE_CURRENT_TAB" });
  };
  const extendStep = () => {
    const shadow = mount(`<div class="mark">Choose deliberately</div><h1>How much more time?</h1><p>One small extension at a time.</p><div class="choices"><button data-extension="5">Add 5 minutes</button><button data-extension="10">Add 10 minutes</button><button data-extension="15">Add 15 minutes</button></div>`);
    shadow.querySelectorAll("[data-extension]").forEach((button) => button.onclick = async () => { const result = await send({ type: "EXTEND_SESSION", minutes: Number(button.dataset.extension) }); session = result.session; close(); showStatus(session); startHeartbeat(); });
  };
  chrome.runtime.onMessage.addListener((message) => { if (message.type === "SESSION_EXPIRED") expired(message.session); });
  send({ type: "INIT" }).then((result) => {
    if (!result?.enabled) return;
    window.__beforeYouScrollSettings = result.settings;
    label = result.siteLabel || label;
    if (result.expired) expired(result.expired);
    else if (result.session) { session = result.session; close(); showStatus(session); startHeartbeat(); }
    else gate();
  });
})();
