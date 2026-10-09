import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";

import {
  attachCanvasScaling,
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

test("client canvas scaling tracks element width", () => {
  const { document } = parseHTML('<div id="canvas" style="width: 640px"></div>');
  const canvas = document.querySelector("#canvas") as unknown as HTMLElement;
  Object.defineProperty(canvas, "clientWidth", { value: 640 });
  const detach = attachCanvasScaling(canvas, { designWidth: 1280, ResizeObserver: undefined });

  assert.equal(canvas.style.getPropertyValue("--slide-scale"), "0.5");
  detach();
});
