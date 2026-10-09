/*
 * Trip app: front-end logic. Plain JS, no build step, no framework.
 * Data comes from window.TRIP_CONFIG (src/config.js). Server calls go to /api/*.
 *
 * KV budget rules baked in here (the original trip blew its daily KV quota):
 *  - Every poll goes through poller(), which stops while the tab is hidden.
 *  - Polls send ?since=<version>, so "nothing changed" costs the server one KV read.
 *  - Wrap mode loads once and never polls. Archive mode makes no KV calls at all.
 */
(function () {
  "use strict";
  var CFG = window.TRIP_CONFIG || {};
  var TRIP = CFG.trip || {};
  var MODE = CFG.mode === "wrap" || CFG.mode === "archive" ? CFG.mode : "live";
  var BUILD_ID = (document.querySelector('meta[name="app-build"]') || {}).content || "";
  var KEY = (TRIP.slug || "trip-app") + "_";
  var AUTH_KEY = KEY + "auth", NAME_KEY = KEY + "name", NOTIFY_KEY = KEY + "notify";
  var THEME_KEY = "trip_theme"; // read by the inline script in index.html too

  // Poll intervals (ms). Sensible defaults: minutes, not seconds.
  // Override in TRIP_CONFIG.pollSeconds if you must, but keep them in minutes on a real trip.
  var PS = CFG.pollSeconds || {};
  var POLL = { features: (PS.features || 120) * 1000, checkins: (PS.checkins || 180) * 1000, build: (PS.build || 600) * 1000 };

  // ---------- helpers ----------
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }
  function crewNames() { return (CFG.crew || []).map(function (c) { return typeof c === "string" ? c : c.name; }).filter(Boolean); }
  function sha256hex(str) {
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(str)).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) { return b.toString(16).padStart(2, "0"); }).join("");
    });
  }
  function authHeaders(extra) { var h = extra || {}; h["X-Trip-Auth"] = store(AUTH_KEY) || ""; return h; }
  function api(path, opts) {
    opts = opts || {};
    opts.headers = authHeaders(opts.headers);
    return fetch(path, opts).then(function (r) {
      if (r.status === 401 && !previewMode) { store(AUTH_KEY, null); lock("Passcode changed. Enter the new one."); }
      return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, data: d }; });
    });
  }

  /** Visibility-aware poller: runs fn now, then every ms while the tab is visible. */
  function poller(fn, ms) {
    var timer = null, last = 0, fails = 0, stopped = false;
    function run() {
      if (stopped || document.hidden) return;
      last = Date.now();
      Promise.resolve(fn()).then(function (ok) { fails = ok === false ? Math.min(fails + 1, 3) : 0; }, function () { fails = Math.min(fails + 1, 3); })
        .then(schedule);
    }
    function schedule() { clearTimeout(timer); if (!stopped && !document.hidden) timer = setTimeout(run, ms * Math.pow(2, fails)); }
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) { clearTimeout(timer); timer = null; }
      else if (Date.now() - last >= ms) run(); else schedule();
    });
    run();
    return { now: run, stop: function () { stopped = true; clearTimeout(timer); } };
  }

  // ---------- trip time ----------
  function offsetMinutes() {
    var m = String(TRIP.utcOffset || "+00:00").match(/^([+-])(\d{2}):?(\d{2})$/);
    return m ? (m[1] === "-" ? -1 : 1) * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10)) : 0;
  }
  function startDate() {
    if (TRIP.startDate && TRIP.startDate !== "auto") return TRIP.startDate;
    var d = new Date(Date.now() + offsetMinutes() * 60000); // "today" at the trip location
    return d.toISOString().slice(0, 10);
  }
  function dayDate(n) {
    var p = startDate().split("-").map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2] + (n - 1))).toISOString().slice(0, 10);
  }
  function fmtDay(iso) {
    var p = iso.split("-").map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2])).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  }
  function at(iso, hhmm) {
    if (!/^\d{1,2}:\d{2}$/.test(hhmm || "")) return NaN;
    var off = String(TRIP.utcOffset || "+00:00");
    return Date.parse(iso + "T" + hhmm.padStart(5, "0") + ":00" + off);
  }
  /** Flatten the agenda into timed events, sorted. */
  function timeline() {
    var out = [];
    (CFG.agenda || []).forEach(function (day) {
      var iso = dayDate(day.day || 1);
      (day.items || []).forEach(function (it, i) {
        var t = at(iso, it.time);
        if (isNaN(t)) return;
        out.push({ t: t, end: at(iso, it.end), item: it, day: day, id: it.id || ("d" + day.day + "-" + i) });
      });
    });
    out.sort(function (a, b) { return a.t - b.t; });
    out.forEach(function (ev, i) { if (isNaN(ev.end)) ev.end = out[i + 1] ? Math.min(out[i + 1].t, ev.t + 4 * 3600000) : ev.t + 3600000; });
    return out;
  }

  // ---------- gate ----------
  var previewMode = false, started = false;
  function lock(msg) {
    $("gate").classList.remove("hidden");
    $("app").classList.remove("show");
    $("bar").classList.remove("show");
    if (msg) $("gate-err").textContent = msg;
  }
  function unlock() {
    $("gate").classList.add("hidden");
    $("app").classList.add("show");
    if (!started) { started = true; start(); }
  }
  function setupGate() {
    $("gate-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var val = $("passcode").value.trim();
      if (!val) return;
      $("gate-err").textContent = "Checking...";
      sha256hex(val).then(function (hash) {
        return fetch("/api/auth", { method: "POST", headers: { "X-Trip-Auth": hash } }).then(function (r) {
          if (r.ok) { store(AUTH_KEY, hash); $("gate-err").textContent = ""; unlock(); return; }
          // Static preview with no Functions running (e.g. python -m http.server): let devs in.
          if ([404, 405, 501].indexOf(r.status) !== -1 && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) { previewMode = true; unlock(); return; }
          $("gate-err").textContent = r.status === 503 ? "Server not set up yet (TRIP_PASS_HASH missing)." : "Wrong passcode";
          $("passcode").value = "";
        });
      }).catch(function () { $("gate-err").textContent = "Could not check the passcode (offline?)"; });
    });
    if (store(AUTH_KEY)) unlock(); // remembered on this phone; a 401 later re-locks
  }

  // ---------- static content ----------
  function renderStatic() {
    var name = TRIP.name || "Our trip";
    document.title = name;
    $("gate-title").textContent = name;
    $("hero-title").textContent = name;
    $("hero-eyebrow").textContent = TRIP.tagline || "Group trip";
    var days = (CFG.agenda || []).length;
    var first = dayDate(1), last = dayDate(days || 1);
    $("hero-meta").textContent = [TRIP.place, fmtDay(first) + (days > 1 ? " to " + fmtDay(last) : ""), crewNames().length + " people"].filter(Boolean).join("  |  ");
    $("agenda-sub").textContent = "Times are " + (TRIP.timeLabel || "local");
    var agent = (CFG.features && CFG.features.agentName) || "the AI agent";
    document.querySelectorAll(".agent-name").forEach(function (el) {
      var cap = el.textContent.charAt(0) === "T";
      el.textContent = cap ? agent.charAt(0).toUpperCase() + agent.slice(1) : agent;
    });
  }

  function renderTicker() {
    var list = (CFG.notices || []).slice();
    if (MODE !== "live") { list = [CFG.wrapMessage || "That's a wrap."]; $("ticker-tag").textContent = "Wrap"; }
    if (!list.length) { $("ticker").hidden = true; return; }
    var i = 0, el = $("ticker-text");
    function show() { el.style.opacity = 0; setTimeout(function () { el.textContent = list[i % list.length]; el.title = el.textContent; el.style.opacity = 1; i++; }, 250); }
    show();
    if (list.length > 1) setInterval(function () { if (!document.hidden) show(); }, 9000); // no network, just text
  }

  function renderCrew() {
    var crew = CFG.crew || [];
    $("crew-sub").textContent = crew.length + " people";
    $("crew-grid").innerHTML = crew.map(function (c) {
      c = typeof c === "string" ? { name: c } : c;
      return '<div class="crew-card"><span class="crew-ava" aria-hidden="true">' + esc(c.emoji || c.name.charAt(0)) + "</span><span><b>" + esc(c.name) + "</b><small>" + esc(c.role || "") + "</small></span></div>";
    }).join("");
  }

  /** Name chips used by every picker. onPick(name). */
  function chips(el, selected, onPick) {
    el.innerHTML = crewNames().map(function (n) { return '<button type="button" class="crew-chip" data-name="' + esc(n) + '">' + esc(n) + "</button>"; }).join("");
    function mark(name) { el.querySelectorAll(".crew-chip").forEach(function (c) { c.classList.toggle("selected", c.getAttribute("data-name").toLowerCase() === String(name || "").toLowerCase()); }); }
    mark(selected);
    el.addEventListener("click", function (e) { var c = e.target.closest(".crew-chip"); if (!c) return; mark(c.getAttribute("data-name")); onPick(c.getAttribute("data-name")); });
    return mark;
  }

  // ---------- agenda ----------
  function renderAgenda() {
    var todayIso = new Date(Date.now() + offsetMinutes() * 60000).toISOString().slice(0, 10);
    var html = (CFG.agenda || []).map(function (day) {
      var iso = dayDate(day.day || 1);
      var items = (day.items || []).map(function (it, i) {
        var id = it.id || ("d" + day.day + "-" + i);
        var time = esc(it.time || "") + (it.end ? "<br><span class=\"muted\">to " + esc(it.end) + "</span>" : "");
        var map = it.mapQuery ? '<a class="map-link" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(it.mapQuery) + '">Open in Maps</a>' : "";
        var details = "";
        if (it.details && it.details.length) {
          details = '<button type="button" class="details-toggle" aria-expanded="false" data-details="' + esc(id) + '">Full schedule <span class="chev" aria-hidden="true">&#9662;</span></button>' +
            '<div class="details" id="details-' + esc(id) + '" hidden>' + it.details.map(function (d) {
              return '<div class="details-row"><span class="t">' + esc(d.time || "") + "</span><span>" + esc(d.title || "") + (d.notes ? '<br><span class="muted">' + esc(d.notes) + "</span>" : "") + "</span></div>";
            }).join("") + "</div>";
        }
        var checkin = it.checkin && MODE !== "archive" ? '<button type="button" class="btn btn-sm btn-ghost" data-checkin="' + esc(id) + '" data-label="' + esc(it.title) + '">I\'m here</button><span class="checkin-strip" data-strip="' + esc(id) + '"></span>' : "";
        return '<div class="item" data-item="' + esc(id) + '"><div class="time">' + time + '</div><div class="item-body">' +
          "<h4>" + esc(it.title) + (it.badge ? '<span class="badge">' + esc(it.badge) + "</span>" : "") + "</h4>" +
          (it.where ? '<p class="where">' + esc(it.where) + "</p>" : "") +
          (it.notes ? "<p>" + esc(it.notes) + "</p>" : "") + map +
          ((details || checkin) ? '<div class="item-actions">' + details + checkin + "</div>" : "") +
          "</div></div>";
      }).join("");
      return '<div class="day"><div class="day-head"><h3>Day ' + esc(day.day) + ": " + esc(day.title || "") + '</h3><span class="date">' + fmtDay(iso) + "</span>" + (iso === todayIso ? '<span class="today">Today</span>' : "") + '</div><div class="card">' + (items || '<p class="muted">Add your agenda here.</p>') + "</div></div>";
    }).join("");
    $("agenda-list").innerHTML = html || '<div class="card"><p>Add your agenda here: edit TRIP_CONFIG.agenda in src/config.js.</p></div>';
    $("agenda-list").addEventListener("click", function (e) {
      var b = e.target.closest("[data-details]");
      if (!b) return;
      var panel = $("details-" + b.getAttribute("data-details"));
      var open = b.getAttribute("aria-expanded") === "true";
      b.setAttribute("aria-expanded", open ? "false" : "true");
      panel.hidden = open;
    });
  }

  // ---------- Now / Up next bar + local reminders ----------
  var events = [], reminderTimers = [];
  function tickNow() {
    var now = Date.now(), current = null, next = null;
    events.forEach(function (ev) {
      if (now >= ev.t && now < ev.end) current = ev;
      if (!next && ev.t > now) next = ev;
      var row = document.querySelector('[data-item="' + ev.id + '"]');
      if (row) { row.classList.toggle("is-now", now >= ev.t && now < ev.end); row.classList.toggle("is-past", now >= ev.end); }
    });
    var label = $("bar-label"), title = $("bar-title");
    $("bar").classList.toggle("wrapped", MODE !== "live");
    if (MODE !== "live") { label.textContent = "That's a wrap"; title.textContent = CFG.wrapMessage || "Thanks, everyone."; }
    else if (current) { label.textContent = "Now  |  Day " + current.day.day; title.textContent = current.item.title; }
    else if (next) {
      var mins = Math.round((next.t - now) / 60000);
      var todayIso = new Date(now + offsetMinutes() * 60000).toISOString().slice(0, 10);
      var when = mins < 120 ? "in " + mins + " min" : (dayDate(next.day.day || 1) === todayIso ? "Today " : "Day " + next.day.day + ", ") + next.item.time;
      label.textContent = "Up next  |  " + when; title.textContent = next.item.title;
    } else { label.textContent = TRIP.name || "Trip"; title.textContent = "That's the plan done. Chat or send a request."; }
    $("bar").classList.add("show");
    title.title = title.textContent;
  }
  function scheduleReminders() {
    reminderTimers.forEach(clearTimeout); reminderTimers = [];
    if (store(NOTIFY_KEY) !== "1" || !("Notification" in window) || Notification.permission !== "granted") return;
    var now = Date.now();
    events.forEach(function (ev) {
      var delay = ev.t - 10 * 60000 - now; // 10 min before, while the app is open
      if (delay < 0 || delay > 6 * 3600000) return;
      reminderTimers.push(setTimeout(function () { notify("Coming up: " + ev.item.title, "In about 10 minutes"); }, delay));
    });
  }
  function notify(title, body) {
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.ready.then(function (reg) { reg.showNotification(title, { body: body, icon: "/icon.svg", tag: "upnext" }); });
      else new Notification(title, { body: body });
    } catch (e) {}
  }
  function setupBar() {
    events = timeline();
    tickNow();
    setInterval(function () { if (!document.hidden) tickNow(); }, 30000); // local only, no network
    document.addEventListener("visibilitychange", function () { if (!document.hidden) tickNow(); });
    var btn = $("bar-notify");
    function paint() { var on = store(NOTIFY_KEY) === "1"; btn.classList.toggle("on", on); btn.setAttribute("aria-checked", on ? "true" : "false"); }
    if (MODE !== "live") btn.hidden = true;
    paint();
    btn.addEventListener("click", function () {
      if (store(NOTIFY_KEY) === "1") { store(NOTIFY_KEY, "0"); paint(); scheduleReminders(); return; }
      if (!("Notification" in window)) { alert("This browser cannot show notifications. Keep an eye on the group chat."); return; }
      Notification.requestPermission().then(function (p) { if (p === "granted") { store(NOTIFY_KEY, "1"); paint(); scheduleReminders(); } });
    });
    scheduleReminders();
    var chat = $("bar-chat"), url = ((CFG.links || {}).groupChat || "").trim();
    if (url) chat.href = url;
    else { chat.removeAttribute("href"); chat.classList.add("disabled"); chat.title = "Group chat link coming"; chat.setAttribute("aria-disabled", "true"); }
    if (MODE !== "live") $("bar-req").hidden = true;
  }

  // ---------- check-ins ----------
  var checkinVersion = "", pendingPlace = null, pickedName = "";
  function placeIds() { return Array.prototype.map.call(document.querySelectorAll("[data-checkin]"), function (b) { return b.getAttribute("data-checkin"); }); }
  function renderStrips(places) {
    Object.keys(places || {}).forEach(function (p) {
      var el = document.querySelector('[data-strip="' + p + '"]');
      if (!el) return;
      var seen = {}, out = [];
      (places[p] || []).slice().reverse().forEach(function (c) { var k = String(c.name).toLowerCase(); if (!seen[k]) { seen[k] = 1; out.push('<span class="who">' + esc(c.name) + "</span>"); } });
      el.innerHTML = out.join("");
    });
  }
  function loadCheckins() {
    var ids = placeIds();
    if (!ids.length || previewMode) return Promise.resolve(true);
    return api("/api/checkins?places=" + encodeURIComponent(ids.join(",")) + (checkinVersion ? "&since=" + encodeURIComponent(checkinVersion) : "")).then(function (r) {
      if (!r.ok) return false;
      if (!r.data.unchanged) { checkinVersion = r.data.version || ""; renderStrips(r.data.places); }
      return true;
    });
  }
  function setupCheckins() {
    if (MODE === "archive" || !placeIds().length) return;
    var sheet = $("checkin-sheet");
    pickedName = store(NAME_KEY) || "";
    var mark = chips($("checkin-chips"), pickedName, function (n) { pickedName = n; });
    function close() { sheet.classList.remove("show"); sheet.setAttribute("aria-hidden", "true"); }
    $("agenda-list").addEventListener("click", function (e) {
      var b = e.target.closest("[data-checkin]");
      if (!b) return;
      pendingPlace = b.getAttribute("data-checkin");
      $("checkin-title").textContent = "I'm here: " + b.getAttribute("data-label");
      mark(pickedName);
      sheet.classList.add("show"); sheet.setAttribute("aria-hidden", "false");
    });
    $("checkin-cancel").addEventListener("click", close);
    sheet.addEventListener("click", function (e) { if (e.target === sheet) close(); });
    $("checkin-go").addEventListener("click", function () {
      if (!pickedName) { $("checkin-title").textContent = "Tap your name first"; return; }
      store(NAME_KEY, pickedName);
      var place = pendingPlace; close();
      if (previewMode) { var o = {}; o[place] = [{ name: pickedName, at: Date.now() }]; renderStrips(o); return; }
      api("/api/checkin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ placeId: place, name: pickedName }) }).then(function (r) {
        if (r.ok) { var o = {}; o[place] = r.data.checkins; renderStrips(o); checkinVersion = ""; }
      });
    });
    if (MODE === "live") poller(loadCheckins, POLL.checkins); else loadCheckins();
  }

  // ---------- feature requests ----------
  var featVersion = "", showEarlier = false, featPoll = null;
  var LABELS = { open: "Open", building: "Building", done: "Done", blocked: "Blocked" };
  function setWrapped(on) {
    $("feat-open").hidden = on;
    $("feat-wrapped").hidden = !on;
  }
  function renderFeatures(data) {
    var items = (data && data.items) || [];
    var list = $("feat-list");
    var counts = ["open", "building", "done", "blocked"].map(function (s) {
      var n = items.filter(function (i) { return (i.status || "open") === s; }).length;
      return n ? '<span class="fstatus ' + s + '">' + n + " " + LABELS[s] + "</span>" : "";
    }).join("");
    $("feat-counts").innerHTML = counts;
    if (!items.length) { list.innerHTML = '<p class="muted">No requests yet. Be the first.</p>'; return; }
    var shownFinished = 0, limit = (CFG.features && CFG.features.finishedShown) || 3, earlier = 0;
    var html = items.map(function (it) {
      var st = LABELS[it.status] ? it.status : "open";
      var finished = st === "done" || st === "blocked";
      var extra = "";
      if (finished) { if (shownFinished < limit) shownFinished++; else { extra = " feat-earlier"; earlier++; } }
      var when = it.createdAt ? new Date(it.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
      return '<div class="feat-item' + extra + '"><div class="ftitle"><span>' + esc(it.title || "Request") + '</span><span class="fstatus ' + st + '">' + LABELS[st] + "</span></div>" +
        '<div class="fmeta">' + esc([it.name, when].filter(Boolean).join("  |  ")) + "</div>" +
        (it.text ? '<p class="ftext">' + esc(it.text) + "</p>" : "") +
        (it.transcript ? '<p class="ftext"><i>"' + esc(String(it.transcript).slice(0, 280)) + '"</i></p>' : "") +
        (it.statusNote ? '<p class="fnote">' + esc(it.statusNote) + "</p>" : "") +
        (it.audioKey && MODE !== "archive" ? '<button type="button" class="btn btn-sm btn-ghost" style="margin-top:.35rem" data-audio="' + esc(it.audioKey) + '">Play voice</button>' : "") +
        "</div>";
    }).join("");
    if (earlier) html += '<button type="button" class="btn btn-sm btn-ghost earlier-toggle" id="earlier-toggle" aria-expanded="' + showEarlier + '">' + (showEarlier ? "Hide earlier finished" : "Show earlier finished (" + earlier + ")") + "</button>";
    list.innerHTML = html;
    list.classList.toggle("show-earlier", showEarlier);
    var t = $("earlier-toggle");
    if (t) t.addEventListener("click", function () { showEarlier = !showEarlier; renderFeatures(data); });
  }
  function loadFeatures() {
    if (MODE === "archive" || previewMode) {
      return fetch("/archive/features.json", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : { items: [] }; })
        .then(function (d) { renderFeatures(d); return true; }, function () { renderFeatures({ items: [] }); return true; });
    }
    return api("/api/feature-requests" + (featVersion ? "?since=" + encodeURIComponent(featVersion) : "")).then(function (r) {
      if (!r.ok) { $("feat-list").innerHTML = '<p class="muted">Requests are not available right now.</p>'; return false; }
      if (r.data.requestsClosed) setWrapped(true);
      if (r.data.unchanged) return true;
      featVersion = r.data.version || "";
      renderFeatures(r.data);
      return true;
    });
  }
  function refreshFeatures() { featVersion = ""; if (featPoll) featPoll.now(); else loadFeatures(); }
  function setFeatStatus(msg, ok) { var s = $("feat-status"); s.textContent = msg; s.style.opacity = ok === false ? 1 : .85; }

  function setupFeatures() {
    var nameInput = $("feat-name");
    nameInput.value = store(NAME_KEY) || "";
    var mark = chips($("feat-chips"), nameInput.value, function (n) { nameInput.value = n; });
    nameInput.addEventListener("input", function () { mark(nameInput.value.trim()); });
    $("feat-list").addEventListener("click", playAudio);
    if (MODE !== "live") setWrapped(true);

    $("feat-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var title = $("feat-title").value.trim(), details = $("feat-details").value.trim(), name = nameInput.value.trim();
      if (title.length < 2 && details.length >= 2) title = details.split(/\s+/).slice(0, 6).join(" ").slice(0, 60);
      if (title.length < 2) { setFeatStatus("Add a few words about what you want.", false); $("feat-title").focus(); return; }
      if (name) store(NAME_KEY, name);
      setFeatStatus("Sending...");
      if (previewMode) { setFeatStatus("Preview mode: run wrangler pages dev to send for real."); return; }
      api("/api/feature-request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: title, details: details, name: name }) }).then(function (r) {
        if (!r.ok) { setFeatStatus((r.data && r.data.error) || "Failed to send", false); if (r.status === 403) setWrapped(true); return; }
        setFeatStatus("Request sent. Watch for it to move to Building.");
        $("feat-title").value = ""; $("feat-details").value = "";
        refreshFeatures();
      }, function () { setFeatStatus("Failed (offline?)", false); });
    });

    if (CFG.features && CFG.features.voice === false) $("feat-rec").hidden = true; else setupVoice();
    if (MODE === "live") featPoll = poller(loadFeatures, POLL.features); else loadFeatures();
  }
  function playAudio(e) {
    var btn = e.target.closest("[data-audio]");
    if (!btn || btn.dataset.loaded) return;
    btn.dataset.loaded = "1"; btn.textContent = "Loading...";
    fetch("/api/feature-audio/" + encodeURIComponent(btn.getAttribute("data-audio")), { headers: authHeaders() })
      .then(function (r) { if (!r.ok) throw new Error("load"); return r.blob(); })
      .then(function (blob) {
        var a = document.createElement("audio"); a.controls = true; a.src = URL.createObjectURL(blob); a.style.width = "100%";
        btn.replaceWith(a); var p = a.play(); if (p && p.catch) p.catch(function () {});
      }).catch(function () { btn.textContent = "Could not load voice"; });
  }

  // Voice memos: MediaRecorder upload, plus a live transcript on desktop browsers only
  // (on phones, speech recognition grabs the mic and leaves the recording silent).
  function setupVoice() {
    var btn = $("feat-rec"), rec = null, stream = null, chunks = [], startedAt = 0, timer = null, blob = null, speech = null, transcript = "";
    var canRecord = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
    function mime() {
      var opts = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
      for (var i = 0; i < opts.length; i++) { try { if (MediaRecorder.isTypeSupported(opts[i])) return opts[i]; } catch (e) {} }
      return "";
    }
    function desktop() { var ua = navigator.userAgent; return !/iPhone|iPad|iPod|Android|Mobile/i.test(ua) && !(/Safari/i.test(ua) && !/Chrome|Chromium|Edg/i.test(ua)); }
    function reset() { clearInterval(timer); btn.classList.remove("recording"); btn.setAttribute("aria-pressed", "false"); btn.textContent = "Record voice"; if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
    function finish() {
      var dur = Date.now() - startedAt, type = ((rec && rec.mimeType) || "audio/webm").split(";")[0];
      reset(); rec = null;
      if (speech) { try { speech.stop(); } catch (e) {} speech = null; }
      blob = new Blob(chunks, { type: type }); chunks = [];
      if (blob.size < 1500 || dur < 700) { blob = null; setFeatStatus("No sound captured. Tap Record, talk, then tap Stop.", false); return; }
      var sec = Math.round(dur / 1000);
      $("voice-label").textContent = "Voice memo  |  " + Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0");
      $("voice-audio").src = URL.createObjectURL(blob);
      $("voice-ready").hidden = false;
      setFeatStatus("Got it. Add a title above if you like, then tap Send.");
    }
    btn.addEventListener("click", function () {
      if (!canRecord) { setFeatStatus(window.isSecureContext ? "This browser cannot record audio. Type it instead, or use your keyboard's mic." : "Voice needs the https link.", false); return; }
      if (rec && rec.state === "recording") { try { rec.requestData(); rec.stop(); } catch (e) { finish(); } return; }
      setFeatStatus("Asking for the mic...");
      navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then(function (s) {
        stream = s; chunks = []; transcript = "";
        var m = mime();
        rec = m ? new MediaRecorder(s, { mimeType: m }) : new MediaRecorder(s);
        rec.ondataavailable = function (ev) { if (ev.data && ev.data.size) chunks.push(ev.data); };
        rec.onstop = function () { setTimeout(finish, 50); };
        rec.start(1000);
        startedAt = Date.now();
        btn.classList.add("recording"); btn.setAttribute("aria-pressed", "true");
        setFeatStatus("Recording. Just talk, then tap Stop.");
        timer = setInterval(function () {
          var sec = Math.floor((Date.now() - startedAt) / 1000);
          btn.textContent = "Stop  " + Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0");
          if (sec >= 180) { try { rec.stop(); } catch (e) {} }
        }, 500);
        var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SR && desktop()) {
          try {
            speech = new SR(); speech.lang = "en-GB"; speech.continuous = true;
            speech.onresult = function (ev) { var t = ""; for (var i = 0; i < ev.results.length; i++) if (ev.results[i].isFinal) t += " " + ev.results[i][0].transcript; transcript = t.trim().slice(0, 2000); };
            speech.start();
          } catch (e) { speech = null; }
        }
      }).catch(function (err) { reset(); setFeatStatus(err && err.name === "NotAllowedError" ? "Mic is blocked. Allow the microphone for this site, then try again." : "Could not start the mic.", false); });
    });
    $("voice-del").addEventListener("click", function () { blob = null; $("voice-ready").hidden = true; setFeatStatus("Recording deleted."); });
    $("voice-send").addEventListener("click", function () {
      if (!blob) return;
      if (previewMode) { setFeatStatus("Preview mode: run wrangler pages dev to send for real."); return; }
      var fd = new FormData(), ext = /mp4/.test(blob.type) ? "m4a" : /ogg/.test(blob.type) ? "ogg" : "webm";
      fd.append("audio", blob, "memo." + ext);
      fd.append("title", $("feat-title").value.trim() || "Voice memo");
      fd.append("details", $("feat-details").value.trim());
      fd.append("name", $("feat-name").value.trim());
      if (transcript) fd.append("transcript", transcript);
      $("voice-send").disabled = true;
      setFeatStatus("Uploading voice memo...");
      api("/api/feature-voice", { method: "POST", body: fd }).then(function (r) {
        $("voice-send").disabled = false;
        if (!r.ok) { setFeatStatus((r.data && r.data.error) || "Upload failed", false); return; }
        blob = null; $("voice-ready").hidden = true; $("feat-title").value = ""; $("feat-details").value = "";
        setFeatStatus("Voice memo sent.");
        refreshFeatures();
      }, function () { $("voice-send").disabled = false; setFeatStatus("Upload failed (offline?)", false); });
    });
  }

  // ---------- themes ----------
  function setupThemes() {
    var themes = (CFG.themes && CFG.themes.length) ? CFG.themes : [{ id: "mono", name: "Mono", note: "Black and white base", swatches: ["#fff", "#000", "#777"], themeColor: "#000000" }];
    var byId = {}; themes.forEach(function (t) { byId[t.id] = t; });
    var root = document.documentElement, sheet = $("theme-sheet");
    function current() { var t = store(THEME_KEY) || "mono"; return byId[t] ? t : "mono"; }
    function apply(id) {
      if (id === "mono") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", id);
      var meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.setAttribute("content", (byId[id] && byId[id].themeColor) || "#000000");
      document.querySelectorAll("[data-theme-opt]").forEach(function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-theme-opt") === id ? "true" : "false"); });
    }
    var slots = MODE === "live" ? Math.max(0, CFG.themeSlots == null ? 3 : CFG.themeSlots) : 0;
    var html = themes.map(function (t) {
      return '<button type="button" class="theme-opt" data-theme-opt="' + esc(t.id) + '" aria-pressed="false"><span class="theme-sw">' + (t.swatches || []).map(function (c) { return '<i style="background:' + esc(c) + '"></i>'; }).join("") + '</span><span class="tname">' + esc(t.name) + "</span><small>" + esc(t.note || "") + "</small></button>";
    }).join("");
    for (var i = 0; i < slots; i++) html += '<button type="button" class="theme-opt slot" data-theme-slot><span class="plus">+</span><span>Your theme here</span><small>Tap to request one</small></button>';
    $("theme-grid").innerHTML = html;
    function open() { sheet.classList.add("show"); sheet.setAttribute("aria-hidden", "false"); }
    function close() { sheet.classList.remove("show"); sheet.setAttribute("aria-hidden", "true"); }
    $("btn-theme").addEventListener("click", open);
    $("theme-close").addEventListener("click", close);
    sheet.addEventListener("click", function (e) { if (e.target === sheet) close(); });
    $("theme-grid").addEventListener("click", function (e) {
      var opt = e.target.closest("[data-theme-opt]");
      if (opt) { store(THEME_KEY, opt.getAttribute("data-theme-opt")); apply(opt.getAttribute("data-theme-opt")); return; }
      if (e.target.closest("[data-theme-slot]")) {
        close();
        $("feat-title").value = "New theme: ";
        $("feat-details").value = "Add a theme called ... Colours: ... Vibe: ...";
        location.hash = "#requests";
        setTimeout(function () { var t = $("feat-title"); t.focus(); t.setSelectionRange(t.value.length, t.value.length); }, 300);
      }
    });
    apply(current());
  }

  // ---------- nav highlight ----------
  function setupNav() {
    var links = Array.prototype.slice.call(document.querySelectorAll(".nav a"));
    var ticking = false;
    function update() {
      ticking = false;
      var cur = links[0];
      links.forEach(function (a) { var s = document.querySelector(a.getAttribute("href")); if (s && s.getBoundingClientRect().top <= 120) cur = a; });
      links.forEach(function (a) { a.classList.toggle("active", a === cur); });
    }
    window.addEventListener("scroll", function () { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    update();
  }

  // ---------- install (PWA) ----------
  function setupInstall() {
    var btn = $("btn-install"), sheet = $("install-sheet"), deferred = null;
    var standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
    if (standalone) { btn.hidden = true; return; }
    window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); deferred = e; });
    btn.addEventListener("click", function () {
      if (deferred) { deferred.prompt(); deferred = null; return; }
      sheet.classList.add("show"); sheet.setAttribute("aria-hidden", "false");
    });
    $("install-close").addEventListener("click", function () { sheet.classList.remove("show"); sheet.setAttribute("aria-hidden", "true"); });
  }

  // ---------- new version available ----------
  function setupUpdates() {
    var overlay = $("update"), waiting = null, dismissed = "";
    function show(remote) { if (remote && remote === dismissed) return; overlay.classList.add("show"); overlay.setAttribute("aria-hidden", "false"); overlay.dataset.remote = remote || ""; }
    function hide() { overlay.classList.remove("show"); overlay.setAttribute("aria-hidden", "true"); }
    function reload() { var u = new URL(location.href); u.searchParams.set("_v", Date.now()); location.replace(u.toString()); }
    $("update-reload").addEventListener("click", function () { hide(); if (waiting) { waiting.postMessage({ type: "SKIP_WAITING" }); setTimeout(reload, 900); } else reload(); });
    $("update-later").addEventListener("click", function () { dismissed = overlay.dataset.remote || BUILD_ID; hide(); });
    var stamped = BUILD_ID && BUILD_ID.indexOf("__") !== 0;
    if (stamped) {
      // Cheap check: fetch the HTML (no KV) and compare build stamps. Visible tabs only.
      poller(function () {
        return fetch("/?_check=" + Date.now(), { cache: "no-store" }).then(function (r) { return r.ok ? r.text() : ""; }).then(function (html) {
          var m = html.match(/name="app-build" content="([^"]+)"/);
          if (m && m[1] !== BUILD_ID && m[1].indexOf("__") !== 0) show(m[1]);
          return true;
        });
      }, POLL.build);
    }
    if (!("serviceWorker" in navigator) || !stamped) return;
    var refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", function () { if (!refreshing) { refreshing = true; reload(); } });
    navigator.serviceWorker.register("/sw.js").then(function (reg) {
      function track(w) { if (!w) return; w.addEventListener("statechange", function () { if (w.state === "installed" && navigator.serviceWorker.controller) { waiting = w; show(); } }); }
      if (reg.waiting && navigator.serviceWorker.controller) { waiting = reg.waiting; show(); }
      reg.addEventListener("updatefound", function () { track(reg.installing); });
      document.addEventListener("visibilitychange", function () { if (!document.hidden) try { reg.update(); } catch (e) {} });
    }).catch(function () {});
  }

  // ---------- start your own (About card) ----------
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy") ? resolve() : reject(new Error("copy failed")); } catch (e) { reject(e); }
      document.body.removeChild(ta);
    });
  }
  function setupStarter() {
    var cfg = CFG.starter || {}, box = $("starter");
    if (!box) return;
    if (!cfg.repo) { box.style.display = "none"; return; }
    var prompt = cfg.prompt || ("Set up my own trip app from " + cfg.repo + ". Follow AGENTS.md.");
    $("starter-prompt").textContent = prompt;
    $("starter-repo").href = cfg.repo;
    var btn = $("starter-copy"), status = $("starter-status"), note = status.textContent, label = btn.textContent, t;
    btn.addEventListener("click", function () {
      copyText(prompt).then(function () {
        btn.textContent = "Copied \u2713"; status.textContent = "Copied. Paste it into your AI agent to get started.";
      }, function () {
        btn.textContent = "Copy failed"; status.textContent = "Could not copy. Press and hold the prompt above to copy it.";
      }).then(function () {
        clearTimeout(t);
        t = setTimeout(function () { btn.textContent = label; status.textContent = note; }, 2500);
      });
    });
  }

  // ---------- boot ----------
  function start() {
    renderAgenda();
    setupBar();
    setupCheckins();
    setupFeatures();
    setupNav();
  }
  renderStatic();
  renderTicker();
  renderCrew();
  setupStarter();
  setupThemes();
  setupInstall();
  setupUpdates();
  setupGate();
})();
