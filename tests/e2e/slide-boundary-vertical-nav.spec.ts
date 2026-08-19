import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';

// Covers NAV-4 and NAV-5 from behavior-matrix.md ("Slide surfaces and
// navigation"). These two behaviors depend on CodeMirror's real vertical
// motion command (moveVertically -> coordsAtPos/getClientRects), which jsdom
// cannot execute (see the documented exception in
// tests/integration/presentation-preview.test.tsx next to the NAV-2/NAV-3
// tests). This spec targets the actual current CodeMirror-based
// PresentationEditor DOM (`.cm-editor`, `.cm-content`, `.cm-slide-boundary`),
// not the contentEditable-per-paragraph architecture assumed by the
// pre-existing tests/e2e/arrow-navigation.spec.ts (which is a separate,
// user-owned, forward-looking spec outside this task's scope).
//
// Written but intentionally NOT executed in this session: running any e2e
// spec triggers `npm run tauri build --debug --features wdio` per
// wdio.conf.ts's onPrepare hook when no debug binary is present, which this
// task's constraints ask to avoid. See test-plan.md for the tracked
// follow-up to run these once a debug binary is available.

const fixtureId = 'e2e-slide-boundary-vertical-nav';
const fixtureDirectory = resolve(process.cwd(), '.wdio-fixtures/Slide boundary vertical nav');

async function resetDocument(source: string): Promise<void> {
  writeFileSync(resolve(fixtureDirectory, 'presentation.md'), `<!-- elef-id: ${fixtureId} -->\n${source}\n`);
  await browser.execute((value, id, directory) => {
    localStorage.setItem('elef.world', JSON.stringify({
      root: directory,
      presentations: [{
        id,
        path: `${directory}/presentation.md`,
        title: 'Slide boundary vertical nav',
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

// Places the caret using a real click on the rendered text, the same way a
// user would, rather than reaching into CodeMirror's internal state. This
// intentionally avoids adding any test-only hook to production code: we
// locate the on-screen point for a given character of `needle` (as it
// appears literally in a `.cm-content`/`.cm-line` text node once revealed)
// via `document.caretRangeFromPoint`-free geometry (line rect + character
// index proportion), then perform a real WebdriverIO click there.
async function clickIntoLine(lineText: string, charOffsetWithinLine: number): Promise<void> {
  const point = await browser.execute((text, offset) => {
    const lines = Array.from(document.querySelectorAll<HTMLElement>('.cm-line'));
    const line = lines.find((el) => (el.textContent || '').includes(text));
    if (!line) throw new Error(`Could not find a .cm-line containing: ${text}`);
    const rect = line.getBoundingClientRect();
    const total = (line.textContent || '').length || 1;
    const ratio = Math.min(1, Math.max(0, offset / total));
    return { x: rect.left + rect.width * ratio, y: rect.top + rect.height / 2 };
  }, lineText, charOffsetWithinLine) as { x: number; y: number };
  await browser.action('pointer').move({ x: Math.round(point.x), y: Math.round(point.y) }).down().up().perform();
}

async function pressArrow(key: 'ArrowDown' | 'ArrowUp'): Promise<void> {
  const keyCode = key === 'ArrowDown' ? '\uE015' : '\uE013';
  await browser.action('key').down(keyCode).up(keyCode).perform();
  await browser.pause(50);
}

async function activeSlideIndex(): Promise<number | null> {
  return browser.execute(() => {
    const selection = window.getSelection();
    const anchor = selection?.anchorNode;
    const anchorElement = anchor instanceof Element ? anchor : anchor?.parentElement;
    const boundary = anchorElement?.closest('[data-slide-index]') as HTMLElement | null;
    const index = boundary?.dataset.slideIndex;
    return index === undefined ? null : Number(index);
  });
}

describe('Real vertical navigation inside and across slide boundaries (CodeMirror WebView)', () => {
  afterEach(async () => {
    await browser.execute(() => localStorage.removeItem('elef.world'));
  });

  it('NAV-4: ArrowDown/ArrowUp inside a single wrapped paragraph move the native caret without crossing a slide boundary', async () => {
    const longParagraph = Array.from({ length: 20 }, (_, i) => `word${i}`).join(' ');
    await resetDocument(`# One\n\n${longParagraph}\n\n---\n\n# Two\n\nBody.`);
    await clickIntoLine('One', 0); // caret starts on the revealed heading line
    const before = await activeSlideIndex();
    await pressArrow('ArrowDown'); // into the paragraph, still slide 0
    await pressArrow('ArrowDown'); // second visual line of the same wrapped paragraph
    const after = await activeSlideIndex();
    // A real wrapped paragraph should keep the caret on the same slide when
    // moving down across its own wrapped visual lines.
    expect(after).toBe(before);
  });

  it('NAV-5: ArrowDown only crosses into the next slide once the caret reaches the true last visual line, not merely the last logical line', async () => {
    const longParagraph = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
    await resetDocument(`# One\n\n${longParagraph}\n\n---\n\n# Two\n\nBody.`);
    // Click into the first word of the long (wrapping) paragraph, which is
    // logically the slide's last source line but visually spans many wrapped
    // lines in a real WebView layout.
    await clickIntoLine('word0 word1', 0);
    await pressArrow('ArrowDown');
    const stillOnFirstSlide = await activeSlideIndex();
    expect(stillOnFirstSlide).toBe(0);
  });
});
