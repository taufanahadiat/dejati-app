# Report synchronization validation — 2026-09-05

Device: Samsung SM-X236B, ADB RRGL102M78P.

Before: installed WebView showed Rp 0; local order queue was empty. The authenticated live daily-report endpoint returned total_sales=286000, cash=286000.

Cause: dashboard, chart, Daily Report, and report detail read only dejati-orders. The daily report saved into SQLite was never used by these views.

Change: authenticated report-history endpoint downloads server orders, item totals, upload identities, and daily expenses. Client combines that snapshot with local orders, deduplicates uploads, and caches history in localStorage and SQLite. Refresh runs at startup, reconnect, foreground, and every minute while dashboard/report is visible. Local open bills remain in the device queue because the existing server POST endpoint does not support them.

Verified after replacement install:
- App package exists and MainActivity is focused on the same device.
- Dashboard: Rp 286.000, 5 transactions, average Rp 57.200.
- Daily Report 2026-09-05: sales and cash Rp 286.000.
- Detail: Rp 62.000 + Rp 20.000 + Rp 86.000 + Rp 71.000 + Rp 47.000.
- 131 server orders cached; device upload queue remains empty.
- Network disabled through WebView debugging, page reloaded: Rp 286.000 and 131 cached orders remain. Network restored and app reloaded.
- Three merge regression tests passed, Vite build and Gradle assembleDebug passed, live PHP syntax check passed.
- npm run lint could not start: existing missing @oxlint/binding-win32-x64-msvc native dependency.

Live API file backed up as index.php.before-report-sync-20260905 before atomic replacement. Existing local dashboard/daily-reports routes were preserved in work/mobile-api-index.php; these older routes were absent from the live server before this change.

Screenshot: dejati-report-verified.png.
