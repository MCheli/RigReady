// rigready.io: the working model of the Play screen in the hero, the before/after switch on the big
// screenshot, and the screenshot viewer. The model's setups and problems are taken from the
// app's recorded scenarios (fly-make-ready-all, racing-make-ready).
(() => {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, reduceMotion ? 0 : ms));
  const esc = (s) =>
    String(s).replace(
      /[&<>"]/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
    );

  const SETUPS = {
    flight: {
      label: 'Flying',
      setup: 'DCS F/A-18C',
      game: 'DCS World',
      mark: '<circle cx="12" cy="13" r="4.25"/><path d="M2.5 13h5.25M16.25 13h5.25M12 8.75V4"/>',
      problems: [
        {
          name: 'Monitor layout',
          problem: 'MFD 2 is rotated 0°, the setup expects 90°',
          fix: 'Apply the layout',
          done: 'Applied the layout to 4 monitors',
        },
        {
          name: 'DCS options',
          problem: 'options.lua changed since the rig last worked',
          fix: 'Restore',
          done: 'Restored options.lua from your saved copy',
        },
        {
          name: 'SimAppPro',
          problem: 'Not running',
          fix: 'Start SimAppPro.exe',
          done: 'Started SimAppPro.exe',
        },
        {
          name: 'TrackIR',
          problem: 'Not running',
          fix: 'Start TrackIR5.exe',
          done: 'Started TrackIR5.exe',
        },
      ],
      inPlace: { count: 4, text: 'Stick, throttle, pedals and MFDs connected' },
    },
    racing: {
      label: 'Racing',
      setup: 'iRacing',
      game: 'iRacing',
      mark: '<circle cx="12" cy="12" r="8.25"/><circle cx="12" cy="12" r="1.9"/><path d="M4 12h6.1M13.9 12H20M12 13.9V20"/>',
      problems: [
        {
          name: 'Monitor layout',
          problem: 'DELL G3223D is on, the setup expects it off',
          fix: 'Apply the layout',
          done: 'Applied the layout to 1 monitor',
        },
        {
          name: 'Fanatec Service',
          problem: 'Not running',
          fix: 'Start FanatecService.exe',
          done: 'Started FanatecService.exe',
        },
        {
          name: 'trophi.ai',
          optional: true,
          problem: 'Not running',
          fix: 'Start trophi.ai.exe',
          done: 'Started trophi.ai.exe',
        },
      ],
      inPlace: { count: 4, text: 'Wheel base connected in PC mode, iRacing knows the wheel' },
    },
  };

  const ICONS = {
    bad: '<svg class="check-icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="#ee635b"/><path d="m6.8 6.8 6.4 6.4m0-6.4-6.4 6.4" stroke="#1a0b0a" stroke-width="2" stroke-linecap="round"/></svg>',
    warn: '<svg class="check-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 1.8 19 17.6H1z" fill="#e2b23c" stroke="#e2b23c" stroke-width="1.5" stroke-linejoin="round"/><path d="M10 7.4v4.6" stroke="#1d1503" stroke-width="2" stroke-linecap="round"/><circle cx="10" cy="14.6" r="1.15" fill="#1d1503"/></svg>',
    ok: '<svg class="check-icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="#3fb97f"/><path d="m6 10.4 2.7 2.7L14.2 7.6" fill="none" stroke="#06140d" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    working:
      '<svg class="check-icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.5" fill="none" stroke="#36404c" stroke-width="2.5"/><path d="M10 2.5a7.5 7.5 0 0 1 7.5 7.5" fill="none" stroke="#5aa9e6" stroke-width="2.5" stroke-linecap="round"/></svg>',
  };

  /** One arc of the readiness dial: segment i of n, with a small gap either side. */
  function arc(i, n) {
    const c = 56;
    const r = 47;
    const gap = n > 1 ? 7 : 0;
    const a0 = ((360 / n) * i + gap / 2 - 90) * (Math.PI / 180);
    const a1 = ((360 / n) * (i + 1) - gap / 2 - 90) * (Math.PI / 180);
    const p = (a) => `${(c + r * Math.cos(a)).toFixed(2)} ${(c + r * Math.sin(a)).toFixed(2)}`;
    return `M${p(a0)} A${r} ${r} 0 0 1 ${p(a1)}`;
  }

  function setupInstrument(root) {
    const state = { kind: 'flight', phase: 'idle', items: [] };

    const reset = () => {
      state.phase = 'idle';
      state.items = SETUPS[state.kind].problems.map((p) => ({
        ...p,
        state: p.optional ? 'warn' : 'bad',
      }));
    };

    function render() {
      const s = SETUPS[state.kind];
      const total = s.problems.length + s.inPlace.count;
      const fixed = state.items.filter((i) => i.state === 'fixed').length;
      const okCount = s.inPlace.count + fixed;
      const required = state.items.filter(
        (i) => i.state === 'bad' || (i.state === 'working' && !i.optional)
      ).length;
      const optional = state.items.filter((i) => i.state === 'warn').length;
      const busy = state.phase === 'running';
      const ready = state.phase === 'ready' || state.phase === 'launched';

      // Segments: the problems first, from the top, then everything already in place.
      const segs = [
        ...state.items.map((i) =>
          i.state === 'fixed'
            ? 'ok'
            : i.state === 'warn'
              ? 'warn'
              : i.state === 'working'
                ? 'bad'
                : i.state
        ),
        ...Array(s.inPlace.count).fill('ok'),
      ];

      let status;
      let statusClass;
      let detail;
      if (busy) {
        status = 'Making ready';
        statusClass = 'busy';
        detail = `${fixed} of ${state.items.length} fixes done`;
      } else if (ready || required === 0) {
        status = 'Ready';
        statusClass = 'ok';
        detail =
          state.phase === 'launched'
            ? `${s.game} is running`
            : 'Everything this setup needs is in place';
      } else {
        status = `Not ready (${required})`;
        statusClass = 'bad';
        detail = `${required} required ${required === 1 ? 'item is' : 'items are'} not met${optional ? `, ${optional} optional` : ''}`;
      }

      const rows = state.items
        .map((i) => {
          const cls = i.state === 'fixed' ? 'ok' : i.state;
          const icon = ICONS[i.state === 'fixed' ? 'ok' : i.state];
          const text = i.state === 'fixed' ? i.done : i.problem;
          const fix = i.state === 'fixed' ? '' : `<span class="check-fix">${esc(i.fix)}</span>`;
          const tag = i.optional ? '<span class="tag">optional</span>' : '';
          return `<li class="check ${cls}">${icon}<div><p class="check-name">${esc(i.name)}${tag}</p><p class="check-detail">${esc(text)}</p></div>${fix}</li>`;
        })
        .join('');

      let action;
      if (state.phase === 'launched') {
        action =
          '<button type="button" class="button" data-action="stand-down">Stand down</button>';
      } else if (ready) {
        action = `<button type="button" class="button go" data-action="launch" disabled>Launching ${esc(s.game)}</button>`;
      } else {
        action = `<button type="button" class="button primary" data-action="run"${busy ? ' disabled' : ''}>Make ready and launch</button>`;
      }

      const note =
        state.phase === 'launched'
          ? 'Afterwards, Stand down closes the helper apps and puts the monitors back for the desk.'
          : state.phase === 'idle'
            ? 'A working model of the Play screen. Press the button.'
            : '';

      const focused = root.contains(document.activeElement)
        ? document.activeElement.dataset.action || document.activeElement.dataset.kind
        : null;

      root.innerHTML = `
        <div class="inst-top">
          <p class="inst-caption">Setup</p>
          <div class="kind-switch" role="group" aria-label="Kind of rig">
            ${Object.entries(SETUPS)
              .map(
                ([k, v]) =>
                  `<button type="button" data-kind="${k}" aria-pressed="${k === state.kind}"${busy ? ' disabled' : ''}>${v.label}</button>`
              )
              .join('')}
          </div>
        </div>
        <div class="inst-head">
          <svg class="dial${ready ? ' ready' : ''}" viewBox="0 0 112 112" role="img" aria-label="${okCount} of ${total} items in place">
            ${segs.map((c, i) => `<path class="seg ${c}" d="${arc(i, total)}"/>`).join('')}
            <text class="dial-count" x="56" y="60" text-anchor="middle">${okCount}</text>
            <text class="dial-of" x="56" y="76" text-anchor="middle">of ${total}</text>
          </svg>
          <div aria-live="polite">
            <p class="setup-name"><svg viewBox="0 0 24 24" aria-hidden="true">${s.mark}</svg>${esc(s.setup)}</p>
            <p class="setup-game">${esc(s.game)}</p>
            <p class="status ${statusClass}">${status}</p>
            <p class="status-detail">${esc(detail)}</p>
          </div>
        </div>
        <ul class="checks">
          ${rows}
          <li class="check summary">${ICONS.ok}<div><p class="check-name">${s.inPlace.count} more in place</p><p class="check-detail">${esc(s.inPlace.text)}</p></div></li>
        </ul>
        <div class="inst-actions">${action}</div>
        <p class="inst-note">${esc(note)}</p>`;

      root.dataset.kind = state.kind;
      if (focused) {
        const again = root.querySelector(`[data-action="${focused}"], [data-kind="${focused}"]`);
        if (again && !again.disabled) again.focus();
        else root.querySelector('[data-action]')?.focus();
      }
    }

    async function run() {
      state.phase = 'running';
      for (const item of state.items) {
        item.state = 'working';
        render();
        await wait(650);
        item.state = 'fixed';
        render();
        await wait(150);
      }
      state.phase = 'ready';
      render();
      await wait(1100);
      state.phase = 'launched';
      render();
    }

    root.addEventListener('click', (e) => {
      const target = e.target.closest('button');
      if (!target || target.disabled) return;
      if (target.dataset.kind && target.dataset.kind !== state.kind) {
        state.kind = target.dataset.kind;
        reset();
        render();
      } else if (target.dataset.action === 'run') {
        run();
      } else if (target.dataset.action === 'stand-down') {
        reset();
        render();
      }
    });

    reset();
    render();
  }

  function setupLightbox() {
    const dialog = document.getElementById('lightbox');
    const big = dialog.querySelector('img');
    document.addEventListener('click', (e) => {
      const shot = e.target.closest('[data-lightbox], .shot');
      if (shot) {
        const img = shot.querySelector('img');
        big.src = img.currentSrc || img.src;
        big.alt = img.alt;
        dialog.showModal();
      } else if (e.target === dialog) {
        dialog.close();
      }
    });
  }

  // The docs contents are a fold-out list on a phone and always open beside the page otherwise.
  // On a phone every section is unfolded inside it, so any page is two taps away: Contents, then
  // the page. Beside the page only the current section is, and the others fold out.
  function setupDocsNav() {
    const toc = document.querySelector('.docs-toc');
    if (!toc) return;
    const sections = [...toc.querySelectorAll('.docs-tree details')];
    const wide = window.matchMedia('(min-width: 901px)');
    const sync = () => {
      toc.open = wide.matches;
      for (const d of sections) d.open = !wide.matches || d.parentElement.matches('.open');
    };
    sync();
    wide.addEventListener('change', sync);
    toc.addEventListener('toggle', () => {
      if (wide.matches || !toc.open) return;
      const here = toc.querySelector('[aria-current="page"]');
      const list = toc.querySelector('.docs-toc-body');
      if (here && list) list.scrollTop = here.offsetTop - list.clientHeight / 3;
    });
  }

  // The docs search: the pages' titles, sections, descriptions and headings, from
  // /docs/search.json, loaded the first time the box is used. Arrow keys move through the
  // results, Enter opens one, Escape clears, and "/" anywhere else on the page goes to the box.
  function setupDocsSearch() {
    const box = document.querySelector('.docs-search');
    if (!box || !window.fetch) return;
    const input = box.querySelector('input');
    const out = box.querySelector('.docs-results');
    const status = box.querySelector('#docs-search-status');
    const ALL = '#docs-contents';
    const MAX = 12;
    let index = null;
    let loading = null;
    box.hidden = false;

    const fold = (s) => String(s).toLowerCase();
    const load = () =>
      (loading ??= fetch(box.dataset.index)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((pages) => {
          index = pages.map((p, order) => ({
            ...p,
            order,
            t: fold(p.title),
            s: fold(p.section),
            d: fold(p.description),
            h: p.headings.map(([text, id]) => ({ text, id, f: fold(text) })),
          }));
        }));

    const startsWord = (hay, w) => hay.startsWith(w) || hay.includes(` ${w}`);

    function find(query) {
      const words = fold(query).split(/\s+/).filter(Boolean);
      const hits = [];
      for (const p of index) {
        let score = 0;
        let ok = true;
        for (const w of words) {
          const inHeads = p.h.some((h) => h.f.includes(w));
          let s = 0;
          if (startsWord(p.t, w)) s += 12;
          else if (p.t.includes(w)) s += 8;
          if (startsWord(p.s, w)) s += 4;
          if (inHeads) s += 3;
          if (p.d.includes(w)) s += 2;
          if (!s) {
            ok = false;
            break;
          }
          score += s;
        }
        if (!ok) continue;
        // A heading that matches what the title does not: link straight to it.
        const missing = words.filter((w) => !p.t.includes(w));
        const head = missing.length
          ? p.h
              .map((h) => ({ h, n: missing.filter((w) => h.f.includes(w)).length }))
              .filter((x) => x.n)
              .sort((a, b) => b.n - a.n)[0]?.h
          : null;
        hits.push({ p, score, head });
      }
      hits.sort((a, b) => b.score - a.score || a.p.order - b.p.order);
      return { words, hits };
    }

    const mark = (text, words) => {
      let html = esc(text);
      for (const w of words) {
        const re = new RegExp(`(${esc(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
        html = html.replace(/(<[^>]*>)|([^<]+)/g, (m, tag, txt) =>
          tag ? tag : txt.replace(re, '<mark>$1</mark>')
        );
      }
      return html;
    };

    function show() {
      const query = input.value.trim();
      if (!query) {
        out.hidden = true;
        out.innerHTML = '';
        status.textContent = '';
        return;
      }
      if (!index) {
        load().then(show, () => {
          out.hidden = false;
          out.innerHTML = `<p class="docs-noresults">The search did not load. <a href="${ALL}">See all pages</a>.</p>`;
        });
        return;
      }
      const { words, hits } = find(query);
      out.hidden = false;
      if (!hits.length) {
        out.innerHTML = `<p class="docs-noresults">No pages match <strong>${esc(query)}</strong>. <a href="${ALL}">See all pages</a>.</p>`;
        status.textContent = 'No pages match.';
        return;
      }
      const items = hits
        .slice(0, MAX)
        .map(({ p, head }) => {
          const where = head ? `${esc(p.section)}: ${mark(head.text, words)}` : esc(p.section);
          return `<li><a href="${p.url}${head ? `#${head.id}` : ''}"><span class="r-title">${mark(p.title, words)}</span><span class="r-meta">${where}</span></a></li>`;
        })
        .join('');
      const more =
        hits.length > MAX
          ? `<p class="docs-more">${hits.length - MAX} more. Add a word to narrow it, or <a href="${ALL}">see all pages</a>.</p>`
          : `<p class="docs-more"><a href="${ALL}">See all pages</a></p>`;
      out.innerHTML = `<ul>${items}</ul>${more}`;
      status.textContent = `${hits.length} ${hits.length === 1 ? 'page' : 'pages'} found.`;
    }

    const links = () => [...out.querySelectorAll('a')];
    // "See all pages": the contents below the box, every section unfolded.
    out.addEventListener('click', (e) => {
      if (!e.target.closest(`a[href="${ALL}"]`)) return;
      e.preventDefault();
      const toc = document.getElementById('docs-contents');
      if (!toc) return;
      toc.open = true;
      for (const d of toc.querySelectorAll('.docs-tree details')) d.open = true;
      input.value = '';
      show();
      const summary = toc.querySelector('summary');
      const target = summary.offsetParent ? summary : toc.querySelector('.docs-tree a');
      target.focus();
      target.scrollIntoView({ block: 'nearest' });
    });
    input.addEventListener('focus', () => load().catch(() => {}), { once: true });
    input.addEventListener('input', show);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' && !out.hidden) {
        e.preventDefault();
        links()[0]?.focus();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const first = out.hidden ? null : out.querySelector('li a');
        if (first) first.click();
      } else if (e.key === 'Escape' && input.value) {
        e.preventDefault();
        input.value = '';
        show();
      }
    });
    out.addEventListener('keydown', (e) => {
      const all = links();
      const i = all.indexOf(document.activeElement);
      if (i < 0) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const next = i + (e.key === 'ArrowDown' ? 1 : -1);
        if (next < 0) input.focus();
        else all[Math.min(next, all.length - 1)].focus();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        input.focus();
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t.closest?.('input, textarea, select, [contenteditable]')) return;
      e.preventDefault();
      input.focus();
      input.select();
    });
  }

  // The download and the changelog were sections of the home page before they had a page.
  if (
    location.pathname === '/' &&
    (location.hash === '#download' || location.hash === '#changelog')
  ) {
    location.replace(`/download/${location.hash === '#changelog' ? '#changelog' : ''}`);
  }

  const instrument = document.getElementById('instrument');
  if (instrument) setupInstrument(instrument);
  setupLightbox();
  setupDocsNav();
  setupDocsSearch();
})();
