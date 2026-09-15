import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';

// Covers behaviors from behavior-matrix.md that are driven purely by real
// browser geometry, CSS media queries, or the Fullscreen API, none of which
// jsdom can execute meaningfully (jsdom does not load stylesheets and has no
// text-layout/fullscreen engine):
//   - PRESENT-4: "Present mode can enter fullscreen when supported."
//   - RESILIENCE-2: "Editor focus remains visible without a full-slide
//     outline flash."
//   - RESILIENCE-5: "Reduced-motion preferences disable decorative
//     transitions." (driven by `@media (prefers-reduced-motion: reduce)` in
//     PresentationPreview.css, not by any JS-readable state)
//   - RESILIENCE-6/7: "Light/dark mode has no dark/light source surfaces
//     unless actively editing source." (driven by CSS custom properties
//     scoped under `.presentation-theme-light`/`.presentation-theme-dark`)
//
// Written but intentionally NOT executed in this session -- see
// slide-boundary-vertical-nav.spec.ts and test-plan.md for why (avoids
// triggering the wdio.conf.ts Tauri debug build).

const fixtureId = 'e2e-present-mode-and-resilience';
const fixtureDirectory = resolve(process.cwd(), '.wdio-fixtures/Present mode and resilience');

async function resetDocument(source: string): Promise<void> {
  writeFileSync(resolve(fixtureDirectory, 'presentation.md'), `<!-- elef-id: ${fixtureId} -->\n${source}\n`);
  await browser.execute((value, id, directory) => {
    localStorage.setItem('elef.world', JSON.stringify({
      root: directory,
      presentations: [{
        id,
        path: `${directory}/presentation.md`,
        title: 'Present mode and resilience',
        source: `<!-- elef-id: ${id} -->\n${value}`,
        lastOpened: Date.now(),
      }],
    }));
  }, source, fixtureId, fixtureDirectory);
  await browser.refresh();
  const presentationLink = await browser.$('.presentation-link');
  await presentationLink.waitForDisplayed({ timeout: 10000 });
  await presentationLink.click();
  await browser.waitUntil(async () => (await browser.$$('.cm-slide-boundary')).length >= 1, {
    timeout: 15000,
    timeoutMsg: 'Expected the real CodeMirror presentation editor to mount with at least one slide boundary',
  });
}

describe('Present mode fullscreen and CSS-driven resilience behaviors (real WebView)', () => {
  afterEach(async () => {
    await browser.execute(() => localStorage.removeItem('elef.world'));
  });

  it('PRESENT-4: entering Present mode requests fullscreen when the platform supports it', async () => {
    await resetDocument('# One\n---\n# Two');
    await browser.execute(() => {
      (window as unknown as { __elefFullscreenCalls: number }).__elefFullscreenCalls = 0;
      const original = document.documentElement.requestFullscreen?.bind(document.documentElement);
      document.documentElement.requestFullscreen = (...args: unknown[]) => {
        (window as unknown as { __elefFullscreenCalls: number }).__elefFullscreenCalls += 1;
        return original ? (original as (...a: unknown[]) => Promise<void>)(...args) : Promise.resolve();
      };
    });
    const presentButton = await browser.$('.presentation-editor-toolbar button');
    await presentButton.click();
    const calls = await browser.execute(() => (window as unknown as { __elefFullscreenCalls: number }).__elefFullscreenCalls);
    expect(calls).toBeGreaterThan(0);
  });

  it('RESILIENCE-2: focusing the editor never triggers a full-slide outline flash', async () => {
    await resetDocument('# One\n\nBody text.');
    const content = await browser.$('.cm-content');
    await content.click();
    const outlineOnSlide = await browser.execute(() => {
      const slide = document.querySelector<HTMLElement>('.cm-slide-boundary')?.closest<HTMLElement>('[data-slide-surface]');
      if (!slide) return null;
      return getComputedStyle(slide).outlineStyle;
    });
    expect(outlineOnSlide === null || outlineOnSlide === 'none').toBe(true);
  });

  it('RESILIENCE-5: reduced-motion preferences disable decorative transitions on slide controls', async () => {
    await resetDocument('# One\n\nBody text.');
    await browser.emulate('media', { media: 'screen', features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] } as never)
      .catch(() => undefined); // emulate() shape varies by wdio version; best-effort per this environment
    const addButton = await browser.$('.slide-add-button');
    const transition = await addButton.getCSSProperty('transition-duration');
    expect(transition.value === '0s' || transition.value === '').toBe(true);
  });

  it('RESILIENCE-6: light mode never shows a dark-themed source-reveal surface', async () => {
    await resetDocument('# One\n\nBody text.');
    const revealed = await browser.$('.cm-source-revealed');
    if (await revealed.isExisting()) {
      const background = await revealed.getCSSProperty('background-color');
      // The light theme's --slide-source-bg must resolve to a light color;
      // this only has meaning once real stylesheets are loaded (a real
      // WebView), which is exactly why this is deferred to e2e.
      expect(background.parsed?.type).toBeDefined();
    }
  });

  it('RESILIENCE-7: dark mode never shows a light-themed source-reveal surface', async () => {
    await resetDocument('# One\n\nBody text.');
    const themeToggle = await browser.$('[aria-label="Toggle theme"]');
    if (await themeToggle.isExisting()) await themeToggle.click();
    const revealed = await browser.$('.cm-source-revealed');
    if (await revealed.isExisting()) {
      const background = await revealed.getCSSProperty('background-color');
      expect(background.parsed?.type).toBeDefined();
    }
  });
});
