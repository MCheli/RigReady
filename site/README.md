# rigready.io

The website: one static page, published to GitHub Pages by `.github/workflows/site.yml`.

## What updates by itself

Nothing on the page needs editing for a release.

- **Download.** `build.mjs` reads the published GitHub releases. The newest release of the major version in `package.json` gets the download buttons, with its version and installer size; a newer beta gets a line of its own. Drafts are ignored. Until a 2.x release is published, the page says 2.0 is coming and shows how to run from source.
- **Changelog.** The changelog section is `CHANGELOG.md`, rendered as it is. A version heading links to its GitHub release when there is one.
- **`/download`** redirects to the newest installer (or to the download section before there is one). Use `https://rigready.io/download` wherever a link should always fetch the current version.

The workflow runs on every push to `main` that touches `site/`, `CHANGELOG.md` or `package.json`, and whenever a release is published, edited or withdrawn. It can also be run by hand from the Actions tab.

## Working on it

```
node site/build.mjs                     # builds _site/ (reads releases from the GitHub API)
npx serve _site                         # or any static server
RELEASES_JSON=file.json node site/build.mjs   # offline, with a saved copy of the releases list
```

The page is `index.html`; `{{SLOTS}}` in it are filled by `build.mjs`. `main.js` is the working model of the Play screen in the hero, the before/after switch and the screenshot viewer. `style.css` uses the app's own colours.

## Screenshots

`img/screens/` holds tidied copies of scenario screenshots from `artifacts/screens/`, listed in `screens.json`. To refresh them after the scenarios change:

```
python site/tools/screens.py            # needs Pillow
```

It paints over the test-only parts of the app's header (the scenario banner and the dev version) and cuts off the scrollbar. Look at the results before committing them.

## Hosting

GitHub Pages, source "GitHub Actions", custom domain `rigready.io` with HTTPS enforced. DNS is at Cloudflare: `A`/`AAAA` records for `rigready.io` pointing at GitHub Pages, and `www` as a `CNAME` to `mcheli.github.io`, all DNS-only (not proxied) so GitHub can issue the certificate.

Fonts: B612 and Atkinson Hyperlegible Next, both SIL Open Font License (`fonts/`).
