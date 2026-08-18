import { useLayoutEffect, useRef } from 'react';
import './MarkdownEditor.css';

interface Props {
  source: string;
  onChange: (source: string) => void;
}

export function MarkdownEditor({ source, onChange }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [source]);

  return (
    <section className="markdown-editor" aria-labelledby="markdown-editor-label">
      <label id="markdown-editor-label" htmlFor="markdown-source">Markdown source</label>
      <textarea
        id="markdown-source"
        ref={textareaRef}
        value={source}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        aria-describedby="markdown-editor-help"
      />
      <p id="markdown-editor-help">Use <code>---</code> on its own line to create a new slide.</p>
    </section>
  );
}
