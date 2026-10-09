Archive snapshots live here. In archive mode (TRIP_CONFIG.mode = "archive") the app
reads archive/features.json instead of calling the API. Create it with:

    TRIP_URL=https://your-app.pages.dev TRIP_PASSCODE=... node scripts/archive-snapshot.mjs

The snapshot can contain first names and request text, so do not commit it to a
public repo. It is gitignored by default.
