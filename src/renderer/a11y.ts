/**
 * Names for what Vuetify leaves nameless, applied to every screen from one place (NFR-011):
 *
 * - a dialog is announced by its title: `aria-labelledby` points at its card title;
 * - a spinner without a name (the one inside a loading button, say) is called "Working".
 *
 * A feature that gives its own `aria-label` keeps it. The axe scan in tests/e2e/a11y.e2e.ts
 * fails when a dialog or a spinner on a scanned screen has no name.
 */

let nextId = 0;

/** Names the dialogs and spinners under `root` that have no name yet. Returns how many it named. */
export function nameUnnamed(root: ParentNode): number {
  let named = 0;
  for (const dialog of root.querySelectorAll(
    '[role="dialog"]:not([aria-label]):not([aria-labelledby])'
  )) {
    const title = dialog.querySelector('.v-card-title, h1, h2, h3');
    if (!title || !(title.textContent ?? '').trim()) continue;
    if (!title.id) title.id = `rr-dialog-title-${++nextId}`;
    dialog.setAttribute('aria-labelledby', title.id);
    named++;
  }
  for (const spinner of root.querySelectorAll(
    '[role="progressbar"]:not([aria-label]):not([aria-labelledby])'
  )) {
    spinner.setAttribute('aria-label', 'Working');
    named++;
  }
  return named;
}

/** Keeps naming them as screens and dialogs come and go. Returns the function that stops it. */
export function keepNaming(doc: Document): () => void {
  nameUnnamed(doc);
  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    // Once per burst of changes: a dialog's title is rendered right after its container.
    queueMicrotask(() => {
      queued = false;
      nameUnnamed(doc);
    });
  });
  observer.observe(doc.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}
