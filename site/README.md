# rigready.io

The website: a few static pages built from this repository by `build.mjs` and published to GitHub Pages by `.github/workflows/site.yml`.

| Page | From |
|---|---|
| `/` | `pages/home.html` |
| `/download/` | `pages/download.html`, the published GitHub releases and `CHANGELOG.md` |
| `/download/latest/` | a redirect to the newest installer, or to `/download/` before there is one |
| `/docs/` | the introduction of `docs/USER-GUIDE.md` and a card per chapter |
| `/docs/<chapter>/` | one page per `##` chapter of `docs/USER-GUIDE.md`, named after its heading |
| `/docs/contributing/` | `CONTRIBUTING.md` |

Every page uses `layout.html` (head, header, footer).

## What updates by itself

Nothing on the site needs editing for a release or a change to the documents.

- **Downloads.** The newest release of the major version in `package.json` gets the download buttons, with its version and installer size; a newer beta gets a line of its own. Drafts are ignored. Until a 2.x release is published, the pages say 2.0 is coming and show how to run from source. Link to `https://rigready.io/download/latest/` wherever a link should always fetch the current installer.
- **Changelog.** `/download/#changelog` is `CHANGELOG.md`. A version heading links to its GitHub release when there is one.
- **Guide.** Edit `docs/USER-GUIDE.md` and the docs pages follow: a new `##` chapter gets a page, the sidebar, the card on `/docs/` (its summary is the chapter's opening) and the previous and next links. Links between the repository's documents become links between pages; links to other files go to GitHub.

The workflow runs on every push to `main` that touches `site/`, `CHANGELOG.md`, `CONTRIBUTING.md`, `docs/USER-GUIDE.md` or `package.json`, and whenever a release is published, edited or withdrawn. It can also be run by hand from the Actions tab.

The build fails on a link to a page or file of the site that it did not build.

## Working on it

```
node site/build.mjs                     # builds _site/ (reads releases from the GitHub API)
npx serve _site                         # or any static server
RELEASES_JSON=file.json node site/build.mjs   # offline, with a saved copy of the releases list
```

`{{SLOTS}}` in the HTML files are filled by `build.mjs`. `lib/markdown.mjs` renders the markdown the project's documents use (no dependencies, so the build needs no `npm install`); `lib/releases.mjs` picks the releases. `main.js` is the working model of the Play screen on the home page, the before/after switch, the screenshot viewer and the docs contents on a phone. `style.css` uses the app's own colours.

## Screenshots

`img/screens/` (the home page, listed in `screens.json`) and `img/guide/` (every picture in `docs/USER-GUIDE.md`) are tidied copies of scenario screenshots from `artifacts/screens/`. To refresh them after the scenarios or the guide's pictures change:

```
python site/tools/screens.py            # needs Pillow
```

It paints over the test-only parts of the app's header (the scenario banner and the dev version) and cuts off the scrollbar. Look at the results before committing them. A picture added to the guide without a tidied copy still appears on the site, as the raw capture, and the build says so.

## Hosting

GitHub Pages, source "GitHub Actions", custom domain `rigready.io` (verified on the account) with HTTPS enforced. DNS is at Cloudflare: `A`/`AAAA` records for `rigready.io` pointing at GitHub Pages, `www` as a `CNAME` to `mcheli.github.io`, and the `_github-pages-challenge-MCheli` TXT record, all DNS-only (not proxied) so GitHub can issue the certificate.

Fonts: B612 and Atkinson Hyperlegible Next, both SIL Open Font License (`fonts/`).
