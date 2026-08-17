import { useRef, useState } from 'react';
import { parseMarkdown } from './core/markdown';
import { readUtf8Markdown } from './core/file';
import type { Presentation } from './core/presentation';
import { PresentationPreview } from './components/PresentationPreview';
import './app.css';
import { open as openNativeDialog } from '@tauri-apps/api/dialog';
import { readBinaryFile } from '@tauri-apps/api/fs';

type LoadResult = { name: string; text: string };

function App() {
  const [presentation, setPresentation] = useState<Presentation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = ({ name, text }: LoadResult) => {
    try {
      setPresentation(parseMarkdown(text, name));
      setError(null);
    } catch (reason) {
      setPresentation(null);
      setError(reason instanceof Error ? reason.message : 'Unable to read this Markdown file.');
    }
  };

  const openBrowserFile = async (file: File) => {
    try {
      load({ name: file.name, text: await readUtf8Markdown(() => file.arrayBuffer()) });
    } catch {
      setPresentation(null);
      setError(`Could not read “${file.name}”. Select a UTF-8 Markdown file and try again.`);
    }
  };

  const openFile = async () => {
    if (window.__TAURI__) {
      try {
        const selected = await openNativeDialog({ multiple: false, filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }] });
        if (typeof selected === 'string') {
          const bytes = await readBinaryFile(selected);
          const buffer = Uint8Array.from(bytes).buffer;
          load({
            name: selected.split(/[\\/]/).pop() || selected,
            text: await readUtf8Markdown(async () => buffer),
          });
        }
      } catch {
        setPresentation(null);
        setError('Could not read the selected file. Select a UTF-8 Markdown file and try again.');
      }
      return;
    }
    inputRef.current?.click();
  };

  return (
    <div className="app">
      <header className="toolbar">
        <div><strong>Elef</strong><span className="subtitle">Markdown presentation</span></div>
        <button type="button" onClick={() => void openFile()}>Open Markdown</button>
        <input ref={inputRef} hidden type="file" accept=".md,.markdown,text/markdown,text/plain" onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void openBrowserFile(file);
          event.target.value = '';
        }} />
      </header>
      {error && <div className="error" role="alert"><strong>Could not open file.</strong> {error}</div>}
      {presentation ? <PresentationPreview presentation={presentation} /> : !error && (
        <section className="welcome"><h1>Open a Markdown file</h1><p>Use <code>---</code> on its own line to create a new slide.</p></section>
      )}
    </div>
  );
}

export default App;
