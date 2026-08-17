import { useRef, useState } from 'react';
import { parseMarkdown } from './core/markdown';
import { readUtf8Markdown } from './core/file';
import { hasUnsavedChanges } from './core/document';
import type { Presentation } from './core/presentation';
import { PresentationPreview } from './components/PresentationPreview';
import { MarkdownEditor } from './components/MarkdownEditor';
import './app.css';
import { open as openNativeDialog } from '@tauri-apps/api/dialog';
import { readBinaryFile } from '@tauri-apps/api/fs';

type LoadResult = { name: string; text: string };

function App() {
  const [presentation, setPresentation] = useState<Presentation | null>(null);
  const [source, setSource] = useState('');
  const [sourceName, setSourceName] = useState<string | null>(null);
  const [baseline, setBaseline] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const openRequestRef = useRef(0);

  const load = ({ name, text }: LoadResult) => {
    try {
      setPresentation(parseMarkdown(text, name));
      setSource(text);
      setSourceName(name);
      setBaseline(text);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to read this Markdown file.');
    }
  };

  const canReplace = () => !hasUnsavedChanges(source, baseline, sourceName) || window.confirm('You have unsaved changes. Replace them with a new Markdown document?');

  const newMarkdown = () => {
    if (!canReplace()) return;
    openRequestRef.current += 1;
    const name = 'Untitled presentation';
    setSource('');
    setSourceName(name);
    setBaseline('');
    setPresentation(parseMarkdown('', name));
    setError(null);
  };

  const updateSource = (nextSource: string) => {
    setSource(nextSource);
    try {
      setPresentation(parseMarkdown(nextSource, sourceName || 'Untitled presentation'));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to parse this Markdown source.');
    }
  };

  const openBrowserFile = async (file: File) => {
    if (!canReplace()) return;
    const request = ++openRequestRef.current;
    try {
      const text = await readUtf8Markdown(() => file.arrayBuffer());
      if (request === openRequestRef.current) load({ name: file.name, text });
    } catch {
      if (request === openRequestRef.current) {
        setError(`Could not read “${file.name}”. Select a UTF-8 Markdown file and try again.`);
      }
    }
  };

  const openFile = async () => {
    if (!canReplace()) return;
    const request = ++openRequestRef.current;
    if (window.__TAURI__) {
      try {
        const selected = await openNativeDialog({ multiple: false, filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }] });
        if (typeof selected === 'string') {
          if (!canReplace()) return;
          const bytes = await readBinaryFile(selected);
          const buffer = Uint8Array.from(bytes).buffer;
          const text = await readUtf8Markdown(async () => buffer);
          if (request === openRequestRef.current) {
            load({ name: selected.split(/[\\/]/).pop() || selected, text });
          }
        }
      } catch {
        if (request === openRequestRef.current) {
          setError('Could not read the selected file. Select a UTF-8 Markdown file and try again.');
        }
      }
      return;
    }
    inputRef.current?.click();
  };

  return (
    <div className="app">
      <header className="toolbar">
        <div><strong>Elef</strong><span className="subtitle">Markdown presentation</span>{sourceName && <span className="document-name">{sourceName}{source !== baseline && ' *'}</span>}</div>
        <button type="button" onClick={newMarkdown}>New Markdown</button>
        <button type="button" onClick={() => void openFile()}>Open Markdown</button>
        <input ref={inputRef} hidden type="file" accept=".md,.markdown,text/markdown,text/plain" onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void openBrowserFile(file);
          event.target.value = '';
        }} />
      </header>
      {error && <div className="error" role="alert"><strong>Could not open file.</strong> {error}</div>}
      {presentation ? <div className="workspace">
        <MarkdownEditor source={source} onChange={updateSource} />
        <PresentationPreview presentation={presentation} />
      </div> : !error && (
        <section className="welcome"><h1>Open a Markdown file</h1><p>Use <code>---</code> on its own line to create a new slide.</p></section>
      )}
    </div>
  );
}

export default App;
