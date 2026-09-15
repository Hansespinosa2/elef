import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';

const fixtureId = 'e2e-arrow-navigation';
const fixtureDirectory = resolve(process.cwd(), '.wdio-fixtures/Arrow navigation');

const longParagraph = [
  'This deliberately overflowing paragraph gives the real WebView enough content to wrap across many lines.',
  'Arrow navigation must keep moving the native caret through those lines before applying Elef block navigation.',
  'The text is repeated to exceed the slide viewport without relying on mocked geometry or fixed pixel coordinates.',
].join(' ');

const sourceFor = (paragraph: string) => `# First slide\n\n${paragraph}\n\n---\n\n# Second slide\n\nThe destination paragraph.`;

interface Diagnostics {
  slides: Array<{ className: string; text: string }>;
  activeElement: string;
  selection: { anchor: string; anchorOffset: number; before: string; after: string } | null;
  scroll: { top: number; height: number; clientHeight: number; rect: DOMRect | null } | null;
  blockRect: DOMRect | null;
  caretRect: { top: number; bottom: number; left: number; width: number; height: number } | null;
  caretRangeFromPoint: boolean;
}

interface KeyOutcome {
  key: string;
  defaultPrevented: boolean;
  target: string;
}

async function diagnostics(): Promise<Diagnostics> {
  return browser.execute(() => {
    const selection = window.getSelection();
    const anchor = selection?.anchorNode;
    const anchorElement = anchor instanceof Element ? anchor : anchor?.parentElement;
    const block = anchorElement?.closest<HTMLElement>('[data-block-index], h1, h2, h3, p, blockquote, pre, li');
    let offset: { before: string; after: string } | null = null;
    if (selection?.rangeCount && anchor && block) {
      const before = document.createRange();
      before.selectNodeContents(block);
      before.setEnd(anchor, selection.anchorOffset);
      const after = document.createRange();
      after.selectNodeContents(block);
      after.setStart(anchor, selection.anchorOffset);
      offset = { before: before.toString(), after: after.toString() };
    }
    const slide = anchorElement?.closest<HTMLElement>('.slide')
      || document.querySelector<HTMLElement>('.slide.editing');
    const caretRange = selection?.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : null;
    return {
      slides: [...document.querySelectorAll<HTMLElement>('.slide')].map((item) => ({
        className: item.className,
        text: item.textContent || '',
      })),
      activeElement: `${document.activeElement?.tagName || 'unknown'}${document.activeElement instanceof HTMLElement && document.activeElement.className ? `.${String(document.activeElement.className).replace(/\s+/g, '.')}` : ''}`,
      selection: selection && anchor ? {
        anchor: anchorElement?.tagName.toLowerCase() || anchor.nodeName,
        anchorOffset: selection.anchorOffset,
        before: offset?.before || '',
        after: offset?.after || '',
      } : null,
      scroll: slide ? {
        top: slide.scrollTop,
        height: slide.scrollHeight,
        clientHeight: slide.clientHeight,
        rect: slide.getBoundingClientRect(),
      } : null,
      blockRect: block?.getBoundingClientRect() || null,
      caretRect: caretRange && {
        top: caretRange.top,
        bottom: caretRange.bottom,
        left: caretRange.left,
        width: caretRange.width,
        height: caretRange.height,
      },
      caretRangeFromPoint: typeof document.caretRangeFromPoint === 'function',
    };
  }) as unknown as Diagnostics;
}

async function resetDocument(source: string): Promise<void> {
  writeFileSync(resolve(fixtureDirectory, 'presentation.md'), `<!-- elef-id: ${fixtureId} -->\n${source}\n`);
  await browser.execute((value, id, directory) => {
    localStorage.setItem('elef.world', JSON.stringify({
      root: directory,
      presentations: [{
        id,
        path: `${directory}/presentation.md`,
        title: 'Arrow navigation',
        source: `<!-- elef-id: ${id} -->\n${value}`,
        lastOpened: Date.now(),
      }],
    }));
  }, source, fixtureId, fixtureDirectory);
  await browser.refresh();
  const presentationLink = await browser.$('.presentation-link');
  await presentationLink.waitForDisplayed({ timeout: 10000 });
  await presentationLink.click();
  await browser.waitUntil(async () => (await browser.$$('.slide')).length === 2, {
    timeout: 15000,
    timeoutMsg: `Expected two real Tauri slides after loading the fixture; ${JSON.stringify(await browser.execute(() => ({
      body: document.body.innerText,
      world: localStorage.getItem('elef.world'),
    })))}`
  });
}

async function placeCaret(selector: string, offset: number): Promise<void> {
  await (await browser.$(selector)).click();
  await browser.execute((target, position) => {
    const element = document.querySelector<HTMLElement>(target);
    if (!element) throw new Error(`Missing caret target ${target}`);
    const text = element.firstChild;
    if (!text) throw new Error(`Caret target has no text: ${target}`);
    const range = document.createRange();
    range.setStart(text, Math.min(position, text.textContent?.length || 0));
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, selector, offset);
}

async function pressDown(): Promise<KeyOutcome> {
  await browser.execute(() => {
    const state = window as Window & {
      __elefArrowOutcome?: KeyOutcome;
      __elefArrowListener?: (event: KeyboardEvent) => void;
    };
    state.__elefArrowOutcome = undefined;
    state.__elefArrowListener = (event) => {
      if (event.key !== 'ArrowDown') return;
      queueMicrotask(() => {
        state.__elefArrowOutcome = {
          key: event.key,
          defaultPrevented: event.defaultPrevented,
          target: event.target instanceof Element ? event.target.tagName.toLowerCase() : 'unknown',
        };
      });
    };
    document.addEventListener('keydown', state.__elefArrowListener, true);
  });
  await browser.action('key').down('\uE015').up('\uE015').perform();
  await browser.pause(50);
  return browser.execute(() => {
    const state = window as Window & {
      __elefArrowOutcome?: KeyOutcome;
      __elefArrowListener?: (event: KeyboardEvent) => void;
    };
    if (state.__elefArrowListener) document.removeEventListener('keydown', state.__elefArrowListener, true);
    return state.__elefArrowOutcome || { key: 'ArrowDown', defaultPrevented: false, target: 'unknown' };
  }) as unknown as KeyOutcome;
}

describe('Arrow navigation in the real Tauri WebView', () => {
  afterEach(async () => {
    await browser.execute(() => localStorage.removeItem('elef.world'));
  });

  it('moves through an overflowing paragraph without hiding a stationary caret', async () => {
    await resetDocument(sourceFor(`${longParagraph} `.repeat(12)));
     const overflowingSource = `${longParagraph} `.repeat(12);
     await placeCaret('article[aria-label="Slide 1"] p', overflowingSource.length - 1);
     const before = await diagnostics();
     await pressDown();
     const after = await diagnostics();
     if (!after.selection || !after.scroll) {
       throw new Error(`Missing WebView state: ${JSON.stringify({ before, after })}`);
     }
    if (!before.scroll || before.scroll.height <= before.scroll.clientHeight) {
      throw new Error(`Fixture did not overflow the real slide viewport: ${JSON.stringify({ before, after })}`);
    }
    if (after.selection.after !== '' || after.selection.before === before.selection.before) {
      throw new Error(`Down did not snap the caret to the overflowing block end: ${JSON.stringify({ before, after })}`);
    }
    if (after.scroll.top > (before.scroll?.top || 0) + 1) {
      throw new Error(`The editor scrolled while the caret was snapped to the block end: ${JSON.stringify({ before, after })}`);
    }
  });

  it('keeps ordinary wrapped-line movement native', async () => {
    await resetDocument(sourceFor(`${longParagraph} ${longParagraph}`));
    await placeCaret('article[aria-label="Slide 1"] p', 35);
    const before = await diagnostics();
    await pressDown();
    const after = await diagnostics();
    if (after.slides.some((slide) => slide.className.includes('editing') && slide.text.includes('Second slide'))) {
      throw new Error(`Wrapped-line Down jumped slides: ${JSON.stringify({ before, after })}`);
    }
    if (
      after.selection?.anchor !== 'p'
      || after.selection?.after === ''
      || (
        after.selection.before === before.selection?.before
        && after.selection.after === before.selection?.after
      )
    ) {
      throw new Error(`Wrapped-line Down reached a block boundary prematurely: ${JSON.stringify({ before, after })}`);
    }
  });

  it('focuses the next slide and places the caret at its start at a slide boundary', async () => {
    await resetDocument(sourceFor('Short paragraph.'));
    await placeCaret('article[aria-label="Slide 1"] p', 'Short paragraph.'.length);
    await pressDown();
    const result = await diagnostics();
    const destination = result.slides[1];
    if (
      !destination?.className.includes('editing')
      || !result.activeElement.includes('ARTICLE.slide.editing')
      || result.selection?.before !== ''
      || result.selection?.after !== ''
    ) {
      throw new Error(`Slide boundary navigation failed: ${JSON.stringify(result)}`);
    }
  });

  it('moves to the end of the last visual paragraph line without scrolling', async () => {
    const overflowingSource = `${longParagraph} `.repeat(12);
    await resetDocument(sourceFor(overflowingSource));
    const viewport = await browser.$('.slide-viewport');
    const clickPoint = await browser.execute(() => {
      const slide = document.querySelector<HTMLElement>('article[aria-label="Slide 1"]');
      const paragraph = slide?.querySelector<HTMLElement>('p');
      if (!slide || !paragraph) throw new Error('Missing real slide paragraph for visual-line click');
      const slideRect = slide.getBoundingClientRect();
      const paragraphRect = paragraph.getBoundingClientRect();
      const lineHeight = Number.parseFloat(getComputedStyle(paragraph).lineHeight);
      const visibleBottom = Math.min(slideRect.bottom, paragraphRect.bottom);
      const viewportRect = slide.parentElement?.getBoundingClientRect();
      if (!viewportRect) throw new Error('Missing slide viewport for visual-line click');
      const scale = window.devicePixelRatio || 1;
      return {
        x: Math.round((paragraphRect.left - viewportRect.left + Math.max(1, Math.min(paragraphRect.width - 1, 12))) / scale),
        y: Math.round((paragraphRect.top - viewportRect.top + Math.max(1, Math.min(paragraphRect.height - 1, visibleBottom - paragraphRect.top - lineHeight / 2))) / scale),
        paragraph: {
          left: paragraphRect.left,
          top: paragraphRect.top,
          right: paragraphRect.right,
          bottom: paragraphRect.bottom,
        },
        slide: {
          top: slideRect.top,
          bottom: slideRect.bottom,
          scrollTop: slide.scrollTop,
          scrollHeight: slide.scrollHeight,
          clientHeight: slide.clientHeight,
        },
        viewport: { left: viewportRect.left, top: viewportRect.top },
        window: {
          innerWidth,
          innerHeight,
          outerWidth,
          outerHeight,
          devicePixelRatio: window.devicePixelRatio,
        },
        lineHeight,
      };
    }) as unknown as {
      x: number;
      y: number;
      paragraph: { left: number; top: number; right: number; bottom: number };
      slide: { top: number; bottom: number; scrollTop: number; scrollHeight: number; clientHeight: number };
      lineHeight: number;
    };
    await viewport.click({ x: clickPoint.x, y: clickPoint.y });
    const before = await diagnostics();
    if (
      !before.selection
      || !before.caretRect
      || !before.scroll
      || before.selection.after === ''
      || before.caretRect.bottom > clickPoint.slide.bottom + 1
      || before.scroll.height <= before.scroll.clientHeight
    ) {
      throw new Error(`Click did not place the caret on the final visible line before its end: ${JSON.stringify({ clickPoint, before })}`);
    }
    const outcome = await pressDown();
    const after = await diagnostics();
    if (
      !after.selection
      || !after.caretRect
      || !after.scroll
      || after.selection.before === before.selection.before
      || after.selection.after === ''
      || after.caretRect.top < before.caretRect.top - 1
      || after.caretRect.bottom > clickPoint.slide.bottom + 1
      || after.scroll.top > before.scroll.top + 1
    ) {
      throw new Error(`Down failed to reach the end of the last visible line without scrolling: ${JSON.stringify({
        click: clickPoint,
        before,
        after,
        outcome,
      })}`);
    }
  });
});
