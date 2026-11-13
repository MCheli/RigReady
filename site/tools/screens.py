"""Make the website's screenshots from the scenario screenshots.

    python site/tools/screens.py            (from the repository root; needs Pillow)

Writes two sets:
- site/img/screens/<name>.webp for the pages, from site/screens.json (output name -> screenshot).
- site/img/guide/<folder>--<file>.webp for every screenshot the manual (docs/manual/**/*.md)
  shows, with site/img/guide/index.json (the picture's repository path -> file, width, height)
  for the build. A tidied copy the manual no longer shows is removed.

Run it when those scenario screenshots or the manual's pictures change, look at the results, and
commit them. A picture without a tidied copy still appears on the site, as the raw capture.

App window captures are tidied: the usual 1264 x 821 window, and any other capture of the app
with its header (a test that opens a larger window, such as the cheat sheets at 1500 x 1250):
- the test-only parts of the header are painted over: the amber "Scenario: ..." banner and the
  dev version to the right of it. The logo, Play/Configure and the search field stay.
- the page scrollbar strip on the right edge is cut off.
Anything else (the shared rig picture, a kneeboard page) is only resized to at most 1600 px wide.
A copy that site/screens.json no longer names is removed, as is a manual copy no page shows.
"""

import json
import re
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SCREENS = ROOT / "site" / "img" / "screens"
GUIDE = ROOT / "site" / "img" / "guide"
MANUAL = ROOT / "docs" / "manual"

WINDOW = (1264, 821)
HEADER_ROWS = 45  # the header's content; the ruler below it stays
SCROLLBAR = 14


def is_amber(px):
    # Also when a dialog's scrim darkens the header (the command palette), or two of them do
    # (the keep prompt over the apply dialog on the Monitors page).
    r, g, b = px[:3]
    return r > 30 and r - b >= 0.35 * r and r >= g > b


def is_faint_amber(px):
    r, g, b = px[:3]
    return r > 14 and r - b >= 0.25 * r and r >= g >= b and r > b


def banner_left(im):
    """The scenario banner's left border: the first column of the header that is amber from top
    to bottom. (ClearType leaves amber-ish fringes on text too, but only a few pixels high.)
    Amber that does not reach the top of the banner's box is something else (the quick look
    covers the header): then there is no banner to paint over."""
    for x in range(330, im.width - SCROLLBAR):
        rows = [y for y in range(12, 44) if is_amber(im.getpixel((x, y)))]
        if len(rows) >= 14:
            if rows[0] > 19 or rows[-1] < 30:
                return None
            return walk_left(im, x)
    return None


def walk_left(im, x):
    """Under a dialog's scrim the banner's left border can be too faint to find, and the column
    found is at its right end instead. Go left over every column with a trace of amber until a
    gap of 8 columns without any: the gap before the banner."""
    left, gap = x, 0
    while x > 330 and gap < 8:
        x -= 1
        if any(is_faint_amber(im.getpixel((x, y))) for y in range(12, 44)):
            left, gap = x, 0
        else:
            gap += 1
    return left


def is_app_capture(im):
    """The usual window, or a larger capture of the app: as wide as a window at least, with the
    app's dark header in the top left and the scenario banner in it."""
    if im.size == WINDOW:
        return True
    dark = max(im.getpixel((4, 4))[:3]) < 60
    return im.width >= WINDOW[0] and im.height >= 600 and dark and banner_left(im) is not None


def tidy_window(im, name):
    header_bg = im.getpixel((4, 4))  # --rr-surface, or darker under a dialog's scrim
    left = banner_left(im)
    if left is None:
        print(f"  {name}: no scenario banner found; header left as it is")
    else:
        im.paste(header_bg, (left - 6, 0, im.width, HEADER_ROWS))
    return im.crop((0, 0, im.width - SCROLLBAR, im.height))


def make(source, target):
    im = Image.open(source).convert("RGB")
    if is_app_capture(im):
        im = tidy_window(im, source.name)
    elif im.width > 1600:
        im = im.resize((1600, round(im.height * 1600 / im.width)), Image.LANCZOS)
    target.parent.mkdir(parents=True, exist_ok=True)
    im.save(target, "WEBP", quality=92, method=6)
    print(f"{target.relative_to(ROOT)}  {im.width}x{im.height}  {target.stat().st_size // 1024} KB")
    return im.size


def main():
    screens = json.loads((ROOT / "site" / "screens.json").read_text())
    for name, source in screens.items():
        make(ROOT / source, SCREENS / f"{name}.webp")
    for stale in SCREENS.glob("*.webp"):
        if stale.stem not in screens:
            stale.unlink()
            print(f"removed {stale.relative_to(ROOT)}: site/screens.json no longer names it")

    index = {}
    for page in sorted(MANUAL.rglob("*.md")):
        for ref in re.findall(r"!\[[^\]]*\]\(([^)\s]+)\)", page.read_text(encoding="utf-8")):
            source = (page.parent / ref).resolve()
            key = source.relative_to(ROOT).as_posix()
            if key in index:
                continue
            rel = source.relative_to(ROOT / "artifacts" / "screens")
            file = f"{'--'.join(rel.with_suffix('').parts)}.webp"
            width, height = make(source, GUIDE / file)
            index[key] = {"file": file, "width": width, "height": height}
    for stale in GUIDE.glob("*.webp"):
        if stale.name not in {entry["file"] for entry in index.values()}:
            stale.unlink()
            print(f"removed {stale.relative_to(ROOT)}: the manual no longer shows it")
    (GUIDE / "index.json").write_text(json.dumps(index, indent=2) + "\n")


if __name__ == "__main__":
    sys.exit(main())
