# GomiMon website

Responsive static marketing site based on the approved ImageGen concepts. Uses the extension's local Fredoka / Silkscreen fonts, habitat, and pet sprites. No framework or third-party runtime is required.

## Run

```sh
npm run build:website
npm run preview:website
# In another terminal:
npm run test:website
```

Open http://127.0.0.1:4173. Build again after source edits. The build packages the current extension and puts the complete site, current privacy notice, and downloadable ZIP in `dist/website`. Upload the contents of that directory to a static host. Hash routes work without server rewrites.

## Configuration

Edit `website/config.js` before building:

- `chromeStoreUrl`: the published Chrome Web Store listing. Until supplied, install links open `#install`, with a real ZIP download and unpacked installation instructions. Buttons switch to “Add to Chrome” when a valid listing is configured.
- `apiBase`: the existing public detector API. The site reads `/v1/leaderboard?period=weekly` and `period=all_time` without credentials. If the API uses an origin allowlist, add the website origin to `ALLOWED_ORIGINS` before publishing.

The leaderboard handles loading, empty standings, errors with retry, and superseded requests. It never displays fictional entries. Weekly periods follow the API's Monday 00:00 UTC reset. The hero is a local demo and never submits meals.

Fonts retain their OFL license files in `assets`. The privacy page in the published build is copied from the repository root to keep policy updates in sync.

The pricing section shows Free (1,000 checks/day) and Plus ($9.99 USD/month,
10,000 checks/day). Plus remains Coming soon for this sandbox-only delivery.
Its CTA explains the extension Settings upgrade flow; the website collects no
credentials or payments. Update availability only as part of the live launch.
