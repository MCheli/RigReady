# rigready.io

The website: a few static pages built from this repository by `build.mjs` and published to GitHub Pages by `.github/workflows/site.yml`.

| Page | From |
|---|---|
| `/` | `pages/home.html` |
| `/download/` | `pages/download.html`, the published GitHub releases and `CHANGELOG.md` |
| `/download/latest/` | a redirect to the newest installer, or to `/download/` before there is one |
| `/docs/` | `docs/manual/index.md` and a card per section |
| `/docs/<section>/` | `docs/manual/<section>/index.md` and a card per page of the section |
| `/docs/<section>/<page>/` | `docs/manual/<section>/<page>.md` |
| `/docs/contributing/` | `CONTRIBUTING.md` |

Every page uses `layout.html` (head, header, footer). Every page has a title, a description, a canonical URL and Open Graph tags; the manual's pages also carry their breadcrumbs as schema.org data. `sitemap.xml` and `robots.txt` cover the whole site.

## What updates by itself

Nothing on the site needs editing for a release or a change to the documents.

- **Downloads.** The newest release of the major version in `package.json` gets the download buttons, with its version and installer size; a newer beta gets a line of its own. Drafts are ignored. Until a 2.x release is published, the pages say 2.0 is coming and show how to run from source. Link to `https://rigready.io/download/latest/` wherever a link should always fetch the current installer.
- **Changelog.** `/download/#changelog` is `CHANGELOG.md`. A version heading links to its GitHub release when there is one.
- **Manual.** Edit `docs/manual/` and the docs pages follow. A section is a folder with an `index.md` (its landing page) and a `.md` file per page; the file name is the page's slug. Every file starts with front matter: `title` (the page's h1; the body has no `#` heading and starts at `##`), `description` (one sentence of 90 to 160 characters, no markdown: the meta description and the text of the page's card) and `order` (sorts a page within its section, and on an `index.md`, the section among the sections). Links between pages are relative links to the `.md` files (`[checks](../setups/checks.md)`, `[Make ready](make-ready.md)`, `../setups/index.md` or `../setups/` for a section); links to `CONTRIBUTING.md` and `CHANGELOG.md` become their pages, and a link to any other file of the repository goes to GitHub. Pictures are relative paths to the scenario screenshots (`../../../artifacts/screens/<scenario>/<file>.png`). The sidebar, the cards, the breadcrumbs and the previous and next links are made from this.

The workflow runs on every push to `main` that touches `site/`, `CHANGELOG.md`, `CONTRIBUTING.md`, `docs/manual/` or `package.json`, and whenever a release is published, edited or withdrawn. It can also be run by hand from the Actions tab.

The build fails on a page of the manual without front matter, a title or a description; a section folder without `index.md`; a `#` heading in a page's body; a link to a page of the manual that does not exist; a picture that does not exist; and a link to a page or file of the site that it did not build. It warns about a description outside 90 to 160 characters and about a picture without a tidied copy.

## Working on it

```
node site/build.mjs                     # builds _site/ (reads releases from the GitHub API)
npx serve _site                         # or any static server
RELEASES_JSON=file.json node site/build.mjs   # offline, with a saved copy of the releases list
```

`{{SLOTS}}` in the HTML files are filled by `build.mjs`. `lib/markdown.mjs` renders the markdown the project's documents use (no dependencies, so the build needs no `npm install`); `lib/manual.mjs` reads the front matter, puts the manual in order and rewrites its links (`tests/unit/siteManual.test.ts` covers it); `lib/releases.mjs` picks the releases. `main.js` is the working model of the Play screen on the home page, the before/after switch, the screenshot viewer and the docs contents on a phone. `style.css` uses the app's own colours.

## Screenshots

`img/screens/` (the home page, listed in `screens.json`) and `img/guide/` (every picture in `docs/manual/`) are tidied copies of scenario screenshots from `artifacts/screens/`. To refresh them after the scenarios or the manual's pictures change:

```
python site/tools/screens.py            # needs Pillow
```

It paints over the test-only parts of the app's header (the scenario banner and the dev version) and cuts off the scrollbar. Look at the results before committing them. A picture added to the manual without a tidied copy still appears on the site, as the raw capture, and the build says so.

## Hosting

GitHub Pages, source "GitHub Actions", custom domain `rigready.io` (verified on the account) with HTTPS enforced. DNS is at Cloudflare: `A`/`AAAA` records for `rigready.io` pointing at GitHub Pages, `www` as a `CNAME` to `mcheli.github.io`, and the `_github-pages-challenge-MCheli` TXT record, all DNS-only (not proxied) so GitHub can issue the certificate.

Fonts: B612 and Atkinson Hyperlegible Next, both SIL Open Font License (`fonts/`).
