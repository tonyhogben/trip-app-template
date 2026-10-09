/*
 * TRIP CONFIG: the one file you edit to make this app yours.
 * Everything the crew sees (trip name, agenda, people, links, themes, wrap mode)
 * comes from here. No secrets in this file: it is shipped to every browser.
 */
window.TRIP_CONFIG = {
  // ---- The trip ----
  trip: {
    name: "Your trip name",
    tagline: "A private web app for your group trip",
    place: "Somewhere great",
    // "auto" makes Day 1 = today, so the placeholder agenda and the Now / Up next bar
    // work straight away. Set a real date when you seed your trip, e.g. "2027-05-14".
    startDate: "auto",
    // UTC offset of the trip location, used to work out Now / Up next. e.g. "+02:00".
    utcOffset: "+01:00",
    timeLabel: "local time",
    slug: "trip-app", // short id, also used for localStorage keys
  },

  // ---- The crew: every name picker in the app uses this list ----
  // First names or nicknames only. No surnames, emails or phone numbers.
  crew: [
    { name: "Person A", emoji: "🧭", role: "Organiser" },
    { name: "Person B", emoji: "📸", role: "Photos" },
    { name: "Person C", emoji: "🍜", role: "Food finder" },
    { name: "Person D", emoji: "🎧", role: "Music" },
    { name: "Person E", emoji: "🗺️", role: "Navigator" },
    { name: "Person F", emoji: "🌍", role: "Joining remotely" },
  ],

  // ---- Links ----
  links: {
    groupChat: "", // e.g. your WhatsApp group invite link. Empty = button shows "link coming".
  },

  // ---- Agenda ----
  // Each day: day (1 = startDate), title, items. Each item:
  //   time "HH:MM" (24h, trip local time) or a word like "Evening" (words skip Now / Up next)
  //   end "HH:MM" optional, title, where, notes, mapQuery (opens Google Maps search),
  //   badge optional ("Booked", "Pending"), checkin true to show an "I'm here" button,
  //   details: optional list of { time, title, notes } shown in an expandable panel.
  agenda: [
    {
      day: 1,
      title: "Arrival day",
      items: [
        { id: "d1-arrive", time: "15:00", title: "Add your agenda here", where: "Where you are staying", notes: "Replace these placeholder items with your real plans in src/config.js.", mapQuery: "", checkin: true },
        { id: "d1-dinner", time: "19:00", end: "21:30", title: "First night dinner (placeholder)", where: "Restaurant name", notes: "Tip: add a badge like Booked or Pending.", badge: "Booked", checkin: true },
      ],
    },
    {
      day: 2,
      title: "The big day",
      items: [
        { id: "d2-breakfast", time: "09:00", title: "Breakfast (placeholder)", where: "Cafe name", checkin: true },
        {
          id: "d2-main", time: "10:30", end: "17:00", title: "Main event (placeholder)", where: "Venue name",
          notes: "Items can carry a detailed schedule that expands.",
          details: [
            { time: "10:30", title: "Session or activity one" },
            { time: "12:30", title: "Lunch" },
            { time: "14:00", title: "Session or activity two" },
            { time: "16:30", title: "Wrap up" },
          ],
        },
        { id: "d2-evening", time: "19:30", title: "Evening plan (placeholder)", where: "Somewhere fun", checkin: true },
      ],
    },
    {
      day: 3,
      title: "Last day",
      items: [
        { id: "d3-brunch", time: "10:00", title: "Farewell brunch (placeholder)", where: "Brunch spot", checkin: true },
        { id: "d3-home", time: "13:00", title: "Head home", notes: "Travel safe." },
      ],
    },
  ],

  // ---- Notice ticker (top strip). Rotates through these. Keep them short. ----
  notices: [
    "Welcome to the trip app. Got an idea? Send a feature request and watch it get built.",
    "Tap Theme to change the look. Every theme was built by someone in the crew.",
    "Save this app to your Home Screen for one-tap access.",
  ],

  // ---- Themes ----
  // Each theme needs a matching [data-theme="id"] block in src/styles.css.
  // "mono" is the base theme and must stay. Add yours below it.
  themes: [
    { id: "mono", name: "Mono", note: "Black and white base", swatches: ["#ffffff", "#000000", "#777777"], themeColor: "#000000" },
  ],
  themeSlots: 3, // empty "add your theme" cards shown in the picker

  // ---- Feature requests ----
  features: {
    agentName: "the AI agent", // shown in copy, e.g. "Grok Bot"
    voice: true, // allow voice memos (needs https and a mic)
    finishedShown: 3, // newest done/blocked items shown before "Show earlier finished"
  },

  // ---- Polling (seconds). Polls pause whenever the tab is hidden. ----
  // An unchanged poll costs one KV read. Even 6 phones left open all day polling
  // features every 2 minutes is about 4,300 reads a day (free plan: 100,000).
  // Do not go below 60 seconds.
  pollSeconds: { features: 120, checkins: 180, build: 600 },

  // ---- Lifecycle ----
  // "live":    everything on.
  // "wrap":    trip over. Form hidden, wrap message in the bottom bar, no polling.
  //            Also set FEATURE_REQUESTS_CLOSED=1 and remove FEATURE_WEBHOOK_URL in Cloudflare.
  // "archive": no KV reads at all. Request list comes from /archive/features.json
  //            (see scripts/archive-snapshot.mjs). Check-ins are hidden.
  mode: "live",
  wrapMessage: "That's a wrap. Great few days, everyone. Thanks for building this with us.",
};
