export interface Slide {
  id: string;
  index: number;
  markdown: string;
}

export interface Presentation {
  sourceName: string;
  slides: Slide[];
}
