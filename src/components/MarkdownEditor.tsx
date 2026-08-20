import { useLayoutEffect, useRef } from 'react';

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
    <section className="markdown-editor flex min-w-0 flex-col gap-2.5 border-b border-border pb-6" aria-labelledby="markdown-editor-label">
      <label className="font-bold text-text-strong" id="markdown-editor-label" htmlFor="markdown-source">Markdown source</label>
      <textarea
        className="min-h-48 w-full resize-none overflow-hidden border-0 bg-transparent px-0 py-1 text-text outline-0 focus:outline-0 font-mono text-[.95rem] leading-[1.65] max-[800px]:min-h-64"
        id="markdown-source"
        ref={textareaRef}
        value={source}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        aria-describedby="markdown-editor-help"
      />
      <p className="m-0 text-[.85rem] text-text-muted" id="markdown-editor-help">Use <code>---</code> on its own line to create a new slide.</p>
    </section>
  );
}
