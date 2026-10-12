import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";

import {
  attachCanvasScaling,
  mountPresentation,
  PresentationController,
} from "../src/features/presentation/presentation.js";

function mount(slideCount: number) {
  const slides = Array.from({ length: slideCount }, (_, index) => `
    <div class="slide-frame" data-presentation-slide>
      <section class="slide">Slide ${index + 1}</section>
    </div>`).join("");
  const { document } = parseHTML(
    `<div id="scope"><div id="stage" data-presentation-stage>${slides}</div><output id="counter" data-presentation-counter></output></div>`,
  );
  const scope = document.querySelector("#scope") as unknown as Element;
  const stage = document.querySelector("#stage") as unknown as Element;
  return { document, scope, stage };
}

test("client presentation controller starts, travels, and stops", () => {
  const { document, scope, stage } = mount(3);
  const controller = new PresentationController(scope, { document: document as unknown as Document, stage });

  assert.equal(controller.start(), true);
  const frames = [...scope.querySelectorAll(".slide-frame")] as unknown as HTMLElement[];
  assert.equal(frames[0]?.hidden, false);
  assert.equal(frames[1]?.hidden, true);
  assert.ok(frames[0]?.classList.contains("is-active-presentation-slide"));
  assert.equal(scope.querySelector("[data-presentation-counter]")?.textContent, "1 / 3");

  controller.next();
  assert.equal(frames[1]?.hidden, false);
  assert.equal(scope.querySelector("[data-presentation-counter]")?.textContent, "2 / 3");

  controller.last();
  controller.next();
  assert.equal(frames[2]?.hidden, false);

  controller.previous();
  assert.equal(frames[1]?.hidden, false);

  controller.first();
  assert.equal(frames[0]?.hidden, false);

  controller.stop();
  assert.ok(frames.every((frame) => frame.hidden === false));
  assert.ok(!frames[0]?.hasAttribute("aria-hidden"));
  controller.destroy();
});

test("client presentation controller refuses empty stages", () => {
  const { document, scope, stage } = mount(0);
  const controller = new PresentationController(scope, { document: document as unknown as Document, stage });

  assert.equal(controller.start(), false);
  controller.destroy();
});

test("client presentation controller ignores keys outside travel and in fields", () => {
  const { document, scope, stage } = mount(2);
  const controller = new PresentationController(scope, { document: document as unknown as Document, stage });
  controller.start();

  controller.handleKey({ key: "ArrowRight", target: document.createElement("input"), preventDefault: () => {} } as unknown as KeyboardEvent);
  assert.equal(scope.querySelector("[data-presentation-counter]")?.textContent, "1 / 2");

  let prevented = false;
  controller.handleKey({
    key: "ArrowRight",
    target: document.createElement("div"),
    preventDefault: () => {
      prevented = true;
    },
  } as unknown as KeyboardEvent);
  assert.equal(prevented, true);
  assert.equal(scope.querySelector("[data-presentation-counter]")?.textContent, "2 / 2");
  controller.destroy();
});

test("client presentation mount resyncs slides after host re-render", () => {
  const { document, scope, stage } = mount(2);
  const mountHandle = mountPresentation(scope, {
    document: document as unknown as Document,
    stage,
  });
  assert.equal(mountHandle.controller.start(), true);
  mountHandle.controller.next();
  assert.equal(scope.querySelector("[data-presentation-counter]")?.textContent, "2 / 2");

  (document.querySelector("#stage") as unknown as HTMLElement).innerHTML = Array.from(
    { length: 3 },
    (_, index) => `<div class="slide-frame"><section class="slide">New ${index + 1}</section></div>`,
  ).join("");
  mountHandle.resync();
  // Index preserved across the re-render (clamped), navigation rebuilt.
  assert.equal(scope.querySelector("[data-presentation-counter]")?.textContent, "2 / 3");
  const frames = [...scope.querySelectorAll(".slide-frame")] as unknown as HTMLElement[];
  assert.equal(frames[1]?.hidden, false);
  assert.ok(frames[1]?.classList.contains("is-active-presentation-slide"));
  mountHandle.destroy();
  assert.ok(frames.every((frame) => frame.hidden === false));
});

test("client presentation mount follows a replaced projection stage", () => {
  const { document, scope } = mount(2);
  const getStage = () => document.querySelector("#stage") as unknown as Element;
  const mountHandle = mountPresentation(scope, {
    document: document as unknown as Document,
    getStage,
  });
  assert.equal(mountHandle.controller.start(), true);
  mountHandle.controller.next();
  assert.equal(scope.querySelector("[data-presentation-counter]")?.textContent, "2 / 2");

  // Hosts replace the projection element (not just its children) on every
  // preview install: swap the whole stage node for a pristine one.
  const replacement = document.createElement("div");
  replacement.id = "stage";
  replacement.setAttribute("data-presentation-stage", "");
  replacement.innerHTML = Array.from(
    { length: 2 },
    (_, index) => `<div class="slide-frame"><section class="slide">Live ${index + 1}</section></div>`,
  ).join("");
  document.querySelector("#stage")?.replaceWith(replacement as unknown as Element);
  mountHandle.resync();
  // Repair must land on the live replacement, not the detached original.
  const frames = [...scope.querySelectorAll(".slide-frame")] as unknown as HTMLElement[];
  assert.equal(frames[1]?.hidden, false);
  assert.ok(frames[1]?.classList.contains("is-active-presentation-slide"));
  assert.equal(scope.querySelector("[data-presentation-counter]")?.textContent, "2 / 2");
  mountHandle.controller.next();
  assert.equal(frames[0]?.hidden, true);
  mountHandle.destroy();
});

interface RevealBlockSpec {
  event: number | null;
  text: string;
  link?: boolean;
  video?: boolean;
  controls?: boolean;
}

interface StubVideo {
  playCount: number;
  pauseCount: number;
}

function revealFrame(document: Document, count: number, blocks: RevealBlockSpec[]): Element {
  const frame = document.createElement("div");
  frame.className = "slide-frame";
  const canvas = document.createElement("section");
  canvas.className = "slide";
  if (count > 0) canvas.setAttribute("data-elef-reveal-event-count", String(count));
  for (const spec of blocks) {
    const block = document.createElement("div");
    block.className = "slide-block";
    if (spec.event !== null) block.setAttribute("data-elef-reveal-event", String(spec.event));
    block.textContent = spec.text;
    if (spec.link) {
      const anchor = document.createElement("a") as unknown as HTMLAnchorElement;
      anchor.href = "https://example.test";
      anchor.textContent = "Focusable link";
      block.append(anchor);
    }
    if (spec.video) {
      const media = document.createElement("video") as unknown as StubVideo & {
        play: () => Promise<void>;
        pause: () => void;
      };
      media.playCount = 0;
      media.pauseCount = 0;
      media.play = () => {
        media.playCount += 1;
        return Promise.resolve();
      };
      media.pause = () => {
        media.pauseCount += 1;
      };
      block.append(media as unknown as Element);
    }
    canvas.append(block);
    if (spec.controls) {
      const editorControls = document.createElement("div");
      editorControls.className = "presentation-editor-block-controls";
      canvas.append(editorControls);
    }
  }
  frame.append(canvas);
  return frame;
}

function mountRevealStage() {
  const { document } = parseHTML(
    '<div id="scope"><div id="stage"></div><output id="counter"></output></div>',
  );
  const typedDocument = document as unknown as Document;
  const scope = document.querySelector("#scope") as unknown as Element;
  const stage = document.querySelector("#stage") as unknown as Element;
  const counter = document.querySelector("#counter") as unknown as Element;
  const controller = new PresentationController(scope, {
    document: typedDocument,
    stage,
    counter,
  });
  return { document: typedDocument, scope, stage, counter, controller };
}

function previewUpdated(document: Document, scope: Element): void {
  const event = document.createEvent("CustomEvent") as unknown as {
    initCustomEvent: (type: string, bubbles: boolean, cancelable: boolean) => void;
  };
  event.initCustomEvent("elef:preview-updated", true, false);
  scope.dispatchEvent(event as unknown as Event);
}

function stubVideos(frame: Element): Array<StubVideo & Element> {
  return [...frame.querySelectorAll("video")] as unknown as Array<StubVideo & Element>;
}

test("reveals preserve geometry membership, accessibility, editor controls, and media timing", () => {
  const { document, stage, controller } = mountRevealStage();
  const mediaFrame = revealFrame(document, 2, [
    { event: 0, text: "First event", video: true },
    { event: 1, text: "Second event", link: true, controls: true },
    { event: null, text: "Unmarked content", video: true },
  ]);
  const emptyFrame = revealFrame(document, 0, [{ event: null, text: "Empty slide" }]);
  (stage as unknown as HTMLElement).replaceChildren(mediaFrame, emptyFrame);

  assert.equal(controller.start(), true);
  const found = [...mediaFrame.querySelectorAll(".slide-block")];
  assert.equal(found.length, 3);
  const firstBlock = found[0];
  const secondBlock = found[1];
  const unmarkedBlock = found[2];
  assert.ok(firstBlock && secondBlock && unmarkedBlock);
  const controls = secondBlock.nextElementSibling;
  assert.ok(controls);
  const videos = stubVideos(mediaFrame);
  assert.equal(videos.length, 2);
  const steppedVideo = videos[0];
  const unmarkedVideo = videos[1];
  assert.ok(steppedVideo && unmarkedVideo);

  assert.equal(firstBlock.classList.contains("is-presentation-reveal-hidden"), true);
  assert.equal(firstBlock.getAttribute("aria-hidden"), "true");
  assert.equal(firstBlock.hasAttribute("inert"), true);
  assert.equal(secondBlock.hasAttribute("inert"), true);
  assert.equal((controls as unknown as HTMLElement).hidden, true);
  assert.equal(unmarkedBlock.hasAttribute("inert"), false);
  assert.equal(steppedVideo.playCount, 0, "a video in a hidden event does not start early");
  assert.equal(unmarkedVideo.playCount, 1, "unmarked video keeps slide-entry playback");

  controller.next();
  assert.equal(firstBlock.classList.contains("is-presentation-reveal-hidden"), false);
  assert.equal(firstBlock.hasAttribute("inert"), false);
  assert.equal(steppedVideo.playCount, 1);
  assert.equal(secondBlock.hasAttribute("inert"), true);

  controller.next();
  assert.equal(secondBlock.hasAttribute("aria-hidden"), false);
  assert.equal(secondBlock.hasAttribute("inert"), false);
  assert.equal((controls as unknown as HTMLElement).hidden, false);
  assert.equal(secondBlock.querySelector("a")?.getAttribute("href"), "https://example.test");

  controller.next();
  assert.equal(controller.index, 1);
  assert.ok(steppedVideo.pauseCount > 0, "leaving the slide pauses its video");
  assert.ok(unmarkedVideo.pauseCount > 0, "leaving the slide pauses unmarked video");
  controller.destroy();
});

test("reversing, preview refresh, stop, and re-entry restore the current event state", () => {
  const { document, scope, stage, controller } = mountRevealStage();
  (stage as unknown as HTMLElement).replaceChildren(
    revealFrame(document, 2, [
      { event: 0, text: "One", link: true },
      { event: 1, text: "Two", controls: true },
    ]),
  );

  assert.equal(controller.start(), true);
  controller.next();
  controller.next();
  const initial = [...stage.querySelectorAll(".slide-block")];
  const first = initial[0];
  const second = initial[1];
  assert.ok(first && second);
  assert.equal(second.hasAttribute("inert"), false);

  controller.previous();
  assert.equal(second.hasAttribute("inert"), true);
  assert.equal((second.nextElementSibling as unknown as HTMLElement).hidden, true);
  controller.previous();
  assert.equal(first.hasAttribute("inert"), true);

  (stage as unknown as HTMLElement).replaceChildren(
    revealFrame(document, 1, [{ event: 0, text: "Updated one", controls: true }]),
  );
  previewUpdated(document, scope);
  const updated = stage.querySelector(".slide-block");
  assert.ok(updated);
  assert.equal(controller.index, 0);
  assert.equal(controller.navigation?.revealedEventCount, 0, "saved progress clamps to the refreshed count");
  assert.equal(updated.hasAttribute("inert"), true);

  controller.next();
  assert.equal(updated.hasAttribute("inert"), false);
  controller.stop();
  assert.equal(updated.hasAttribute("inert"), false);
  assert.equal(updated.hasAttribute("aria-hidden"), false);
  assert.equal(updated.classList.contains("is-presentation-reveal-hidden"), false);
  assert.equal((updated.nextElementSibling as unknown as HTMLElement).hidden, false);

  controller.start();
  assert.equal(controller.index, 0);
  assert.equal(controller.navigation?.revealedEventCount, 0, "re-entering starts at the first event");
  assert.equal(updated.hasAttribute("inert"), true);
  controller.destroy();
});

test("refresh clamps the index when the preview has fewer slides", () => {
  const { document, scope, stage, counter, controller } = mountRevealStage();
  const frames = ["First", "Second"].map((text) => {
    const frame = document.createElement("div");
    frame.className = "slide-frame";
    frame.textContent = text;
    return frame;
  });
  (stage as unknown as HTMLElement).replaceChildren(...frames);

  assert.equal(controller.start(), true);
  controller.next();
  const only = document.createElement("div");
  only.className = "slide-frame";
  only.textContent = "Only slide";
  (stage as unknown as HTMLElement).replaceChildren(only);
  previewUpdated(document, scope);

  assert.equal(controller.index, 0);
  assert.equal((only as unknown as HTMLElement).hidden, false);
  assert.equal(counter.textContent, "1 / 1");
  controller.destroy();
});

test("client canvas scaling tracks element width", () => {
  const { document } = parseHTML('<div id="canvas" style="width: 640px"></div>');
  const canvas = document.querySelector("#canvas") as unknown as HTMLElement;
  Object.defineProperty(canvas, "clientWidth", { value: 640 });
  const detach = attachCanvasScaling(canvas, { designWidth: 1280, ResizeObserver: undefined });

  assert.equal(canvas.style.getPropertyValue("--slide-scale"), "0.5");
  detach();

  const { document: fitDocument } = parseHTML('<div id="fitted"></div>');
  const fitted = fitDocument.querySelector("#fitted") as unknown as HTMLElement;
  Object.defineProperty(fitted, "clientWidth", { value: 800 });
  Object.defineProperty(fitted, "clientHeight", { value: 400 });
  const detachFit = attachCanvasScaling(fitted, {
    designWidth: 1280,
    designHeight: 720,
    ResizeObserver: undefined,
  });
  assert.equal(fitted.style.getPropertyValue("--slide-scale"), String(400 / 720));
  detachFit();
});
