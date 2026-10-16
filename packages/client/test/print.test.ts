import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DOCUMENT_PRINT_GEOMETRY,
  PRESENTATION_PRINT_GEOMETRY,
  pausePrintVideos,
  printMarkerClasses,
  printWorkKindForSourceFile,
} from "../src/features/export/print.js";

test("print kinds resolve from the work source file like the desktop preview context", () => {
  assert.equal(printWorkKindForSourceFile("document.md"), "document");
  assert.equal(printWorkKindForSourceFile("presentation.md"), "presentation");
  assert.equal(printWorkKindForSourceFile(null), "presentation");
  assert.equal(printWorkKindForSourceFile(undefined), "presentation");
});

test("print markers isolate the work payload from the app shell per kind", () => {
  assert.deepEqual(printMarkerClasses("document"), ["printing-work", "printing-document"]);
  assert.deepEqual(printMarkerClasses("presentation"), ["printing-work", "printing-presentation"]);
});

test("pre-print pauses videos and rewinds to the poster frame", () => {
  const paused: Array<string> = [];
  const videos = [
    {
      id: "playing",
      paused: false,
      currentTime: 12.5,
      pause() {
        this.paused = true;
        paused.push(this.id);
      },
    },
    {
      id: "refuses-rewind",
      paused: false,
      pause() {
        this.paused = true;
        paused.push(this.id);
      },
      set currentTime(_value: number) {
        throw new Error("read-only");
      },
    },
  ];
  const root = {
    querySelectorAll(selector: string) {
      assert.equal(selector, "video");
      return videos;
    },
  };
  pausePrintVideos(root as never);
  assert.deepEqual(paused, ["playing", "refuses-rewind"]);
  const rewound = videos[0];
  assert.ok(rewound);
  assert.equal(rewound.currentTime, 0);
});

test("pre-print tolerates a missing root and an unpausable video", () => {
  pausePrintVideos(null);
  pausePrintVideos(undefined);
  pausePrintVideos({
    querySelectorAll() {
      return [
        {
          pause() {
            throw new Error("nope");
          },
          set currentTime(_value: number) {
            throw new Error("nope");
          },
        },
      ];
    },
  } as never);
});

test("shared print geometry pins the web print views", () => {
  assert.deepEqual(
    { ...PRESENTATION_PRINT_GEOMETRY },
    { widthIn: 13.333, heightIn: 7.5, paddingRem: 5 },
  );
  assert.deepEqual(
    { ...DOCUMENT_PRINT_GEOMETRY },
    { widthMm: 210, heightMm: 297, paddingMm: 16 },
  );
});
