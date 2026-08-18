// stage_test.playwright.js — the Mirror 3-D stage regression protocol, executable.
//
// Run via the Playwright MCP bridge:
//   browser_run_code_unsafe({ filename: '<abs path to this file>' })
// or paste the function into any Playwright session. It opens its OWN isolated
// browser context (fresh localStorage — never touches an installer's seat map),
// exercises the touch/seat/select surface against the dev server, and returns
// a {pass, results[]} table. Blink emission is INTERCEPTED (page.route) so the
// regression never fires a real radio command — the wire shape is still
// asserted. Real-tag confirmation is a deliberate manual step (TESTING.md).
//
// Assumes: dev server on :4180, live or stub feed connected, slot PL-11-B
// visible at the default camera (it is, at 390x844).
async (page) => {
  const URL = 'http://localhost:4180';
  const results = [];
  const check = (name, ok, info = '') => results.push({ name, ok: !!ok, info: String(info) });

  const ctx = await page.context().browser().newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const p = await ctx.newPage();

  // Intercept command emissions — assert shape, never reach the radio.
  const cmdPosts = [];
  await p.route('**/api/cmd', async (route) => {
    cmdPosts.push(JSON.parse(route.request().postData() || '{}'));
    await route.fulfill({ json: { ok: true, cmd: 'intercepted' } });
  });

  try {
    await p.goto(URL, { timeout: 15000 });
    await p.waitForTimeout(3000);

    const census = () => p.evaluate(() => document.querySelector('.stage-status')?.textContent ?? '');
    const cardHead = () => p.evaluate(() => document.querySelector('.light-card')?.innerText?.split('\n')[0] ?? 'NO CARD');

    // 1 · feed + census shape
    const chip = await p.evaluate(() => document.querySelector('.source-chip')?.textContent?.trim());
    check('feed chip present', chip && chip.length > 0, chip);
    const c0 = await census();
    const m = c0.match(/(\d+) heard · (\d+) not yet located · (\d+) self-located · (\d+) seated/);
    check('census parses', !!m, c0);

    // 1b · seat layer: 130 tap targets in the scene graph (24 worksite PL +
    // 106 fixture seats; F-perimeter hidden behind the ruling flag)
    const sockets = await p.evaluate(() => {
      let tori = 0;
      window.__mirrorScene?.traverse((o) => { if (o.isMesh && o.geometry?.type === 'TorusGeometry') tori++; });
      return tori;
    });
    check('130 seat sockets render', sockets === 130, String(sockets));

    // 2 · tap slot → card opens
    await p.touchscreen.tap(181, 453);
    await p.waitForTimeout(500);
    const slotCard = await cardHead();
    check('tap slot opens card', slotCard.startsWith('PL-'), slotCard);

    // 3 · orbit-drag preserves the open card; empty tap dismisses; ⌂ resets
    // the camera so later steps can use fixed screen coordinates again.
    await p.mouse.move(100, 200); await p.mouse.down();
    for (let i = 1; i <= 8; i++) await p.mouse.move(100 + i * 15, 200 + i * 5);
    await p.mouse.up();
    await p.waitForTimeout(400);
    check('orbit keeps card', (await cardHead()) !== 'NO CARD', await cardHead());
    await p.touchscreen.tap(300, 680);
    await p.waitForTimeout(400);
    check('empty tap dismisses', (await cardHead()) === 'NO CARD');
    await p.click('.nav-cluster button');
    await p.waitForTimeout(600);

    // 4 · seat the strongest unseated heard light (isolated context — safe)
    await p.touchscreen.tap(181, 453);
    await p.waitForTimeout(500);
    const canSeat = await p.$('.light-card select');
    let seatedMac = null;
    if (canSeat) {
      seatedMac = await p.evaluate(() => document.querySelector('.light-card select option:nth-child(2)')?.value ?? null);
      if (seatedMac) {
        await p.selectOption('.light-card select', seatedMac);
        // 4a · Tag is intercepted, wire shape asserted (T<MAC>:1, design 28 C0)
        const blinkBtns = await p.$$('.light-card button');
        for (const b of blinkBtns) if ((await b.innerText()) === 'Tag') { await b.click(); break; }
        await p.waitForTimeout(400);
        check('tag emits T<MAC>:1', cmdPosts.some((c) => c.cmd === 'T' + seatedMac.toUpperCase() + ':1'), JSON.stringify(cmdPosts));
        await p.click('.light-card .btn-accent');
        await p.waitForTimeout(600);
        const c1 = await census();
        check('seat increments census', c1.includes(`${(m ? +m[4] : 0) + 1} seated`), c1);
        const seats = await p.evaluate(() => localStorage.getItem('mirror-seats-v3'));
        check('seat persisted with slot', seats && seats.includes(seatedMac) && seats.includes('PL-'), seats);
      } else {
        check('seat flow', false, 'no unseated heard lights offered');
      }
    } else {
      check('seat flow', false, 'slot card had no picker (slot occupied in fresh context?)');
    }

    // 5 · unseat round-trip — camera untouched since ⌂, coordinates valid
    if (seatedMac) {
      await p.touchscreen.tap(181, 453);
      await p.waitForTimeout(400);
      const btns = await p.$$('.light-card button');
      for (const b of btns) if ((await b.innerText()) === 'Unseat') { await b.click(); break; }
      await p.waitForTimeout(500);
      const seats2 = await p.evaluate(() => localStorage.getItem('mirror-seats-v3'));
      check('unseat clears seat', !seats2 || !seats2.includes(seatedMac), seats2);
    }
  } finally {
    await ctx.close();
  }

  return { pass: results.every((r) => r.ok), results };
}
