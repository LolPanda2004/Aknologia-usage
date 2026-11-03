// In-page layout measurements. Runs inside the browser via page.evaluate(measure, { touch }).
export type Measure = ReturnType<typeof measure>;

export function measure({ touch }: { touch: boolean }) {
  const vw = document.documentElement.clientWidth;
  const iw = window.innerWidth;
  const ih = window.innerHeight;
  const sel = (el: Element | null): string => {
    const parts: string[] = [];
    let e: Element | null = el;
    for (let d = 0; e && e !== document.body && d < 5; d++, e = e.parentElement) {
      if (e.id) { parts.unshift('#' + e.id); break; }
      let s = e.tagName.toLowerCase();
      const cls = (typeof (e as HTMLElement).className === 'string' ? (e as HTMLElement).className : '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
      if (cls.length) s += '.' + cls.join('.');
      const dt = e.getAttribute('data-tour'); if (dt) s += `[data-tour=${dt}]`;
      const role = e.getAttribute('role'); if (role && !cls.length) s += `[role=${role}]`;
      const p = e.parentElement;
      if (p) { const same = Array.from(p.children).filter((c) => c.tagName === e!.tagName); if (same.length > 1) s += `:nth-of-type(${same.indexOf(e) + 1})`; }
      parts.unshift(s);
    }
    return parts.join(' > ');
  };
  const txt = (el: Element) => ((el as HTMLElement).innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').replace(/\s+/g, ' ').trim().slice(0, 50);
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.01;
  };
  const vhidden = (el: Element) => { for (let e: Element | null = el, d = 0; e && d < 6; e = e.parentElement, d++) { const c = getComputedStyle(e); if (c.position === 'absolute' && c.clip.startsWith('rect(0')) return true; } return false; };
  const skip = (el: Element) => !!el.closest('.sr-only, .auth-rings, .chip, [aria-hidden="true"], .ghost') || (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') || vhidden(el);
  const clipsX = (el: Element) => { const o = getComputedStyle(el).overflowX; return o !== 'visible'; };

  const all = Array.from(document.querySelectorAll('body *'));
  // 1. elements overflowing their parent's right edge (outermost offender only), and elements past the viewport
  const over = new Set<Element>();
  const overInfo = new Map<Element, { by: number; parent: string }>();
  const offscreen: { sel: string; text: string; left: number; right: number; clippedBy: string | null }[] = [];
  for (const el of all) {
    if (skip(el) || !visible(el)) continue;
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed') continue;
    const r = el.getBoundingClientRect();
    const p = el.parentElement;
    if (p && p !== document.body && !clipsX(p)) {
      const pr = p.getBoundingClientRect();
      if (r.right > pr.right + 1.5 && pr.width > 0) { over.add(el); overInfo.set(el, { by: Math.round(r.right - pr.right), parent: sel(p) }); }
    }
    if (r.right > vw + 1 || r.left < -1) {
      // inside a horizontal scroll container is intentional (tables); report what clips it otherwise
      let a = el.parentElement, scroller: Element | null = null;
      while (a && a !== document.documentElement) { const o = getComputedStyle(a).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') { scroller = a; break; } a = a.parentElement; }
      if (scroller && ['auto', 'scroll'].includes(getComputedStyle(scroller).overflowX) && scroller !== document.body) continue;
      if (scroller && scroller.closest('.table-wrap, [style*="overflow-x: auto"], [style*="overflow: auto"]')) continue; // clipped inside a scrolling table
      offscreen.push({ sel: sel(el), text: txt(el), left: Math.round(r.left), right: Math.round(r.right), clippedBy: scroller ? sel(scroller) : null });
    }
  }
  const overflow = Array.from(over).filter((el) => !(el.parentElement && over.has(el.parentElement))).map((el) => ({ sel: sel(el), text: txt(el), by: overInfo.get(el)!.by, parent: overInfo.get(el)!.parent }));
  // drop offscreen entries that are descendants of another offscreen entry
  const offscreenTop = offscreen.filter((o, i) => !offscreen.some((x, j) => j !== i && o.sel.startsWith(x.sel + ' >')));

  // 2. horizontal scroll containers (tables etc.)
  const scrollers: { sel: string; scrollW: number; clientW: number; visiblePct: number }[] = [];
  for (const el of all) {
    if (!visible(el)) continue;
    const o = getComputedStyle(el).overflowX;
    if ((o === 'auto' || o === 'scroll') && el.scrollWidth > el.clientWidth + 1) scrollers.push({ sel: sel(el), scrollW: el.scrollWidth, clientW: el.clientWidth, visiblePct: Math.round((el.clientWidth / el.scrollWidth) * 100) });
  }

  // 3. clipped text (ellipsis / overflow hidden)
  const clipped: { sel: string; text: string }[] = [];
  for (const el of all) {
    if (skip(el) || !visible(el)) continue;
    const cs = getComputedStyle(el);
    if ((cs.textOverflow === 'ellipsis' || cs.overflowX === 'hidden') && el.scrollWidth > el.clientWidth + 1 && (el as HTMLElement).innerText?.trim() && !el.matches('.auth')) clipped.push({ sel: sel(el), text: txt(el) });
  }

  // 4. tap targets < 44x44 (touch widths only)
  const small: { sel: string; text: string; w: number; h: number; inline: boolean }[] = [];
  if (touch) {
    const q = 'a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=switch], [role=radio], summary, [tabindex]:not([tabindex="-1"])';
    const scope = document.querySelector('.overlay .modal, .tour-card') ?? document;
    for (const el of Array.from(scope.querySelectorAll(q))) {
      if (!visible(el) || el.closest('.sr-only')) continue;
      let target: Element = el;
      if (el.matches('input[type=checkbox], input[type=radio]')) { const l = el.closest('label') ?? (el.id ? document.querySelector(`label[for="${el.id}"]`) : null); if (l) target = l; }
      const r = target.getBoundingClientRect();
      if (r.width >= 43.5 && r.height >= 43.5) continue;
      if (el.matches('.bars .b, .heat .c')) continue; // chart marks: documented exception (one Tab stop per chart; data also in readout + sr-only table)
      const inline = el.tagName === 'A' && getComputedStyle(el).display === 'inline' && !!el.parentElement && Array.from(el.parentElement.childNodes).some((n) => n.nodeType === 3 && n.textContent!.trim().length > 0);
      small.push({ sel: sel(el), text: txt(el), w: Math.round(r.width), h: Math.round(r.height), inline });
    }
  }

  // 5. dialogs, tour card, toast vs the viewport
  const dialogs: { sel: string; top: number; bottom: number; left: number; right: number; h: number; problems: string[] }[] = [];
  for (const el of Array.from(document.querySelectorAll('.modal, .tour-card, [role=dialog], [role=alertdialog], .toast'))) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    const p: string[] = [];
    if (r.top < 0) p.push('top above viewport');
    if (r.left < 0) p.push('left of viewport');
    if (r.right > vw + 0.5) p.push('right past viewport');
    if (r.bottom > ih + 0.5) p.push('bottom below viewport');
    if (r.height > ih) p.push('taller than viewport');
    // can the primary action be clicked? (tour: ADM-02)
    const btn = el.querySelector('.btn-primary, .btn-danger');
    if (btn) { const b = btn.getBoundingClientRect(); const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); if (b.bottom > ih || b.top < 0) p.push('primary action off-screen'); else if (hit && !btn.contains(hit)) p.push('primary action covered by ' + sel(hit)); }
    dialogs.push({ sel: sel(el), top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), h: Math.round(r.height), problems: p });
  }

  // 6. inputs with font-size < 16px (iOS zooms on focus)
  const smallFont: { sel: string; px: number }[] = [];
  if (touch) for (const el of Array.from((document.querySelector('.overlay .modal') ?? document).querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=hidden]), select, textarea'))) {
    if (!visible(el)) continue;
    const px = parseFloat(getComputedStyle(el).fontSize);
    if (px < 16) smallFont.push({ sel: sel(el), px });
  }

  // 7. charts
  const charts: { sel: string; problem: string }[] = [];
  for (const b of Array.from(document.querySelectorAll('.bar-labels'))) {
    const spans = (Array.from(b.children) as HTMLElement[]).filter((s) => getComputedStyle(s).visibility !== 'hidden');
    const bad = spans.filter((s) => s.scrollWidth > s.clientWidth + 1).length;
    if (bad) charts.push({ sel: sel(b), problem: `${bad}/${spans.length} x-axis labels wider than their slot (${Math.round(spans[0]?.clientWidth ?? 0)} px)` });
  }
  for (const b of Array.from(document.querySelectorAll('.bars'))) {
    const vs = (Array.from(b.querySelectorAll('.v')) as HTMLElement[]).filter((v) => getComputedStyle(v).visibility !== 'hidden' && v.textContent!.trim());
    const bad = vs.filter((v) => v.getBoundingClientRect().width > (v.parentElement!.getBoundingClientRect().width + 1)).length;
    if (bad) charts.push({ sel: sel(b), problem: `${bad}/${vs.length} bar value labels wider than their bar (overlap)` });
    const col = b.querySelector('.b'); if (col && col.getBoundingClientRect().width < 10) charts.push({ sel: sel(b), problem: `bars only ${Math.round(col.getBoundingClientRect().width)} px wide` });
  }
  for (const c of Array.from(document.querySelectorAll('.heat .c')).slice(0, 1)) { const w = c.getBoundingClientRect().width; if (w < 12) charts.push({ sel: sel(c.closest('.heat')), problem: `heatmap cells ${w.toFixed(1)} px wide` }); }
  for (const s of Array.from(document.querySelectorAll('svg[role=img]'))) { const r = s.getBoundingClientRect(); const p = s.parentElement!.getBoundingClientRect(); if (r.right > p.right + 1) charts.push({ sel: sel(s), problem: 'svg wider than its card' }); }

  // 7b. what makes the page wider than the viewport (when hScroll and nothing else explains it)
  const widest: { sel: string; text: string; right: number; w: number }[] = [];
  if (document.documentElement.scrollWidth > vw + 1) {
    for (const el of all) {
      const r = el.getBoundingClientRect();
      if (r.right <= vw + 1 || r.width < 1) continue;
      let a = el.parentElement, inScroller = false;
      while (a && a !== document.body) { const o = getComputedStyle(a).overflowX; if (o !== 'visible') { inScroller = true; break; } a = a.parentElement; }
      if (!inScroller) widest.push({ sel: sel(el), text: txt(el), right: Math.round(r.right), w: Math.round(r.width) });
    }
    // text that spills out of its own box (e.g. a long email in a grid cell) doesn't widen the element's rect
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      if (!n.textContent!.trim() || n.parentElement!.closest('.table-wrap, svg')) continue;
      const rg = document.createRange(); rg.selectNodeContents(n);
      const r = rg.getBoundingClientRect();
      if (r.right > vw + 1) widest.push({ sel: sel(n.parentElement) + ' (text)', text: n.textContent!.trim().slice(0, 50), right: Math.round(r.right), w: Math.round(r.width) });
    }
    widest.sort((a, b) => b.right - a.right || a.w - b.w);
  }

  // 8. nav reachability (sidebar hidden with no replacement)
  const side = document.querySelector('nav.side');
  const navHidden = !!side && !visible(side) && !document.querySelector('[aria-controls][aria-expanded], .menu-btn');

  return {
    vw, iw, ih, scrollW: document.documentElement.scrollWidth, docH: document.documentElement.scrollHeight,
    hScroll: document.documentElement.scrollWidth > vw + 1,
    overflow: overflow.slice(0, 40), offscreen: offscreenTop.slice(0, 40), scrollers, clipped: clipped.slice(0, 40), small: small.slice(0, 80),
    smallCount: small.length, dialogs, smallFont: smallFont.slice(0, 40), charts, navHidden, widest: widest.filter((x, i, arr) => !arr.some((y, j) => j !== i && x.sel.startsWith(y.sel + ' >'))).slice(0, 8),
  };
}
