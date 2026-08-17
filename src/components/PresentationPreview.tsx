import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Presentation } from '../core/presentation';
import './PresentationPreview.css';

interface Props {
  presentation: Presentation;
}

export function PresentationPreview({ presentation }: Props) {
  return (
    <main className="slide-list" aria-label={`${presentation.sourceName} slides`}>
      {presentation.slides.map((slide) => (
        <article className="slide" key={slide.id} aria-label={`Slide ${slide.index + 1}`}>
          {slide.markdown ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{slide.markdown}</ReactMarkdown>
          ) : (
            <p className="empty-slide">This slide is empty.</p>
          )}
          <span className="slide-number">{slide.index + 1}</span>
        </article>
      ))}
    </main>
  );
}
