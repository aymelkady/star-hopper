/*
 * The single quest card in #quest-card (top centre).  Three looks, never two cards at once:
 *   objective : big icon + short text, then [progress bar] [where/distance chip] [Skip ›]
 *   celebrate : "⭐ Star 3 / 15! Nice!" for a moment after a star
 *   intro     : "Today's quest" with 3 rows (current one marked); tap to close
 * Only textContent / style changes per frame; DOM is built once.
 */
export function createQuestCard({ onSkip, onIntroTap, confirmSkip = false }) {
  const root = document.getElementById('quest-card');
  root.innerHTML = `
    <div class="qc-obj">
      <div class="qc-main"><span class="qc-ico" aria-hidden="true"></span><span class="qc-text"></span></div>
      <div class="qc-sub">
        <div class="qc-bar" hidden><i></i></div>
        <span class="qc-dist"></span>
        <span class="qc-dots" aria-hidden="true"></span>
        <button class="qc-skip" id="btn-skip" aria-label="Skip this goal">Skip ›</button>
      </div>
    </div>
    <div class="qc-cele" hidden><div class="qc-cele-big"></div><div class="qc-cele-sub"></div></div>
    <div class="qc-intro" hidden role="button" tabindex="-1" aria-label="Close today's quest"><div class="qc-intro-h">Today's quest</div><ol class="qc-rows"></ol><div class="qc-intro-tap">Tap to go!</div></div>`;
  root.setAttribute('role', 'status'); root.setAttribute('aria-live', 'polite');
  const q = s => root.querySelector(s);
  const el = { obj: q('.qc-obj'), ico: q('.qc-ico'), text: q('.qc-text'), bar: q('.qc-bar'), fill: q('.qc-bar i'), dist: q('.qc-dist'),
    dots: q('.qc-dots'), skip: q('.qc-skip'), cele: q('.qc-cele'), celeBig: q('.qc-cele-big'), celeSub: q('.qc-cele-sub'), intro: q('.qc-intro'), rows: q('.qc-rows') };
  // touch (confirmSkip): a stray tap only arms it ("Skip? ✓"); a 2nd tap within 2 s skips
  const SKIP_LABEL = 'Skip ›', SKIP_SURE = 'Skip? ✓', ARM_MS = 2000;
  let armT = 0, armTimer = 0;
  const disarm = () => { armT = 0; clearTimeout(armTimer); el.skip.textContent = SKIP_LABEL; el.skip.classList.remove('armed'); };
  el.skip.addEventListener('click', e => {
    e.stopPropagation(); el.skip.blur();
    if (confirmSkip && !(armT && performance.now() - armT <= ARM_MS)) {
      armT = performance.now(); el.skip.textContent = SKIP_SURE; el.skip.classList.add('armed');
      clearTimeout(armTimer); armTimer = setTimeout(disarm, ARM_MS);
      return;
    }
    disarm(); onSkip();
  });
  el.skip.addEventListener('pointerdown', e => e.stopPropagation());
  el.intro.addEventListener('pointerdown', e => { e.stopPropagation(); onIntroTap(); });
  let mode = 'objective', last = {};
  const set = (k, node, prop, v) => { if (last[k] !== v) { last[k] = v; node[prop] = v; } };

  function look(m) {
    mode = m;
    el.obj.hidden = m !== 'objective'; el.cele.hidden = m !== 'celebrate'; el.intro.hidden = m !== 'intro';
    root.className = `qc-${m}`;
  }
  look('objective');

  return {
    root, get mode() { return mode; },
    show(v) { root.hidden = !v; },
    setObjective({ icon, text, progress = null, skippable = true }) {
      set('ico', el.ico, 'textContent', icon);
      set('text', el.text, 'textContent', text);
      const hasBar = progress !== null && progress !== undefined;
      el.bar.hidden = !hasBar;
      if (hasBar) set('fill', el.fill.style, 'width', `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`);
      el.skip.hidden = !skippable;
    },
    setDistance(text) { set('dist', el.dist, 'textContent', text); el.dist.hidden = !text; },
    setQuestDots(done, total, curIndex) {
      const key = `${done}|${total}|${curIndex}`;
      if (last.dots === key) return; last.dots = key;
      el.dots.innerHTML = total ? Array.from({ length: total }, (_, i) => `<i class="${i < done ? 'on' : ''} ${i === curIndex ? 'cur' : ''}"></i>`).join('') : '';
      el.dots.hidden = !total;
      el.dots.title = total ? `Today's quest ${done} / ${total}` : '';
    },
    celebrate(big, sub) { el.celeBig.textContent = big; el.celeSub.textContent = sub || ''; look('celebrate'); },
    intro(rows) {
      el.rows.innerHTML = rows.map(r => `<li class="${r.done ? 'done' : ''} ${r.current ? 'cur' : ''}"><span class="qr-ico">${r.done ? '✅' : '⭐'}</span><span>${r.text}</span>${r.current ? '<span class="qr-now">◀ now</span>' : ''}</li>`).join('');
      look('intro');
    },
    objective() { look('objective'); },
  };
}
