import './SourceModeMockups.css';

const mockups = [
  { name: 'Quiet pill', className: 'mockup-quiet', note: 'Low contrast, stays out of the way.' },
  { name: 'Segmented control', className: 'mockup-segmented', note: 'Makes the two editing states explicit.' },
  { name: 'Code lens', className: 'mockup-code-lens', note: 'Pairs the toggle with a source-first cue.' },
  { name: 'Compact switch', className: 'mockup-compact', note: 'Smallest footprint for narrow toolbars.' },
  { name: 'Mode chip', className: 'mockup-chip', note: 'Clear active state with a friendly label.' },
];

export function SourceModeMockups() {
  return (
    <main className="source-mode-mockups">
      <header className="mockups-header">
        <div>
          <span className="mockups-kicker">Elef / source mode</span>
          <h1>Five top-bar directions</h1>
          <p>Normal mode keeps the intelligent inline preview. Full source mode shows only the Markdown.</p>
        </div>
        <button type="button" onClick={() => { window.location.search = ''; }}>Back to app</button>
      </header>
      <div className="mockup-grid">
        {mockups.map((mockup, index) => (
          <article className={`mockup-card ${mockup.className}`} key={mockup.name}>
            <div className="mockup-meta"><span>0{index + 1}</span><strong>{mockup.name}</strong></div>
            <div className="mockup-window">
              <div className="mockup-topbar">
                <div><b>Elef</b><span>roadmap.md</span></div>
                <div className="mockup-controls">
                  <span className="mockup-toggle-label">{index === 2 ? 'Source' : index === 1 ? 'Inline' : ''}</span>
                  <span className="mockup-toggle" aria-hidden="true"><i /></span>
                  <button type="button">Present</button>
                </div>
              </div>
              <div className="mockup-body">
                <span className="mockup-slide-label">SLIDE 01</span>
                <h2>Build a calmer editor</h2>
                <p>Write in Markdown. See the story take shape.</p>
                <div className="mockup-source"># Build a calmer editor<br /><br />Write in Markdown.<br /><br />---</div>
              </div>
            </div>
            <p className="mockup-note">{mockup.note}</p>
          </article>
        ))}
      </div>
    </main>
  );
}
