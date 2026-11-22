import { useMemo, useRef, useState } from 'react';
import { DemoTag, EmptyState, Landing, NotFound, Notice, PageHead, readFileText, Shell, useFlash, usePersistentState, useRoute } from './shared/ui';
import { demoLog } from './lib/demo';
import { countLevels, errorGroups, filterEntries, LEVELS, parseLog, timeline, type Entry, type Level } from './lib/logs';

const NAV = [
  { to: '/', label: 'Overview' },
  { to: '/analyze', label: 'Analyze' },
  { to: '/formats', label: 'Supported formats' },
];
const MAX_BYTES = 5 * 1024 * 1024;
const PAGE = 100;
const DEMO = demoLog();

export default function App() {
  const [route] = useRoute();
  let page;
  if (route === '/') page = <Home />;
  else if (route === '/analyze') page = <Analyze />;
  else if (route === '/formats') page = <Formats />;
  else page = <NotFound />;
  return (
    <Shell name="LogLens" wordmark={['Log', 'Lens']} nav={NAV} route={route} cta={{ to: '/analyze', label: 'Analyze a log' }} footerNote="Logs are processed in your browser and never uploaded.">
      {page}
    </Shell>
  );
}

const fmtTime = (t: number, step = 60_000) => new Date(t).toLocaleString([], step >= 86_400_000 ? { month: 'short', day: 'numeric' } : { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' });

function Timeline({ entries, onPick, range }: { entries: Entry[]; onPick?: (from: number, to: number) => void; range?: [number, number] | null }) {
  const t = useMemo(() => timeline(entries), [entries]);
  const [tip, setTip] = useState<{ x: number; text: string } | null>(null);
  if (!t) return <p className="muted small">No timestamps found, so there is no timeline.</p>;
  const max = Math.max(1, ...t.buckets.map((b) => b.total));
  const stack: Level[] = ['FATAL', 'ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE', 'UNKNOWN'];
  return (
    <div className="tl" onMouseLeave={() => setTip(null)}>
      <div className="tl-axis-y" aria-hidden="true"><span>{max}</span><span>{Math.round(max / 2)}</span><span>0</span></div>
      <div className="tl-bars" role="img" aria-label={`Log volume over time in ${t.step / 60_000}-minute buckets. Peak ${max} lines.`}>
        {t.buckets.map((b, i) => (
          <button
            key={b.from}
            type="button"
            className={`tl-col ${range && range[0] === b.from ? 'is-picked' : ''}`}
            onClick={() => onPick?.(b.from, b.to)}
            onMouseEnter={(e) => setTip({ x: (e.currentTarget as HTMLElement).offsetLeft, text: `${fmtTime(b.from, t.step)}–${fmtTime(b.to, t.step)} UTC · ${b.total} lines · ${b.counts.ERROR + b.counts.FATAL} errors` })}
            aria-label={`${fmtTime(b.from, t.step)} to ${fmtTime(b.to, t.step)}: ${b.total} lines, ${b.counts.ERROR + b.counts.FATAL} errors`}
            style={{ ['--i' as string]: i }}
          >
            <span className="tl-stack grow-in" style={{ height: `${(b.total / max) * 100}%` }}>
              {stack.map((l) => (b.counts[l] ? <i key={l} className={`lv-${l}`} style={{ flexGrow: b.counts[l] }} /> : null))}
            </span>
          </button>
        ))}
        {tip && <span className="chart-tip" style={{ left: tip.x, top: 0 }}>{tip.text}</span>}
      </div>
      <div />
      <div className="tl-axis-x" aria-hidden="true">
        <span>{fmtTime(t.buckets[0].from, t.step)}</span>
        <span>{t.step / 60_000 >= 60 ? `${t.step / 3_600_000} h` : `${t.step / 60_000} min`} buckets · UTC</span>
        <span>{fmtTime(t.buckets[t.buckets.length - 1].to, t.step)}</span>
      </div>
    </div>
  );
}

function Home() {
  const entries = useMemo(() => parseLog(DEMO), []);
  const c = countLevels(entries);
  return (
    <Landing
      compact
      eyebrow="Log analysis · in the browser"
      title={<>Find the incident <em>in thousands of lines.</em></>}
      lead="Paste or upload a log file. LogLens recognises common formats, counts lines by severity, groups repeated errors, and draws a timeline so spikes stand out — then lets you filter down to the exact lines that matter."
      primary={{ href: '#/analyze', label: 'Analyze a log' }}
      secondary={{ href: '#/formats', label: 'Supported formats' }}
      previewLabel="Demo service log · 3 hours"
      meta={['No upload', 'Text, JSON lines & syslog', 'Demo log included']}
      preview={
        <div className="hero-log">
          <div className="level-chips static">
            {(['ERROR', 'WARN', 'INFO', 'DEBUG'] as Level[]).map((l) => <span key={l} className={`lv-chip lv-${l}`}>{l} <strong>{c[l]}</strong></span>)}
            <span className="lv-chip lv-FATAL">FATAL <strong>{c.FATAL}</strong></span>
          </div>
          <Timeline entries={entries} />
          <ul className="hero-groups">
            {errorGroups(entries, 2).map((g) => <li key={g.pattern}><span className="badge badge-err">×{g.count}</span> <code>{g.pattern}</code></li>)}
          </ul>
        </div>
      }
      steps={[
        { title: 'Load a log', body: 'Paste text or choose a .log, .txt or .jsonl file up to 5 MB.' },
        { title: 'Spot the spike', body: 'The timeline stacks lines by severity. Click a bar to zoom into that window.' },
        { title: 'Filter to the cause', body: 'Combine severity, source, text or /regex/ search, and read repeated errors grouped.' },
      ]}
      features={[
        { title: 'Format detection', body: 'ISO-timestamped text, JSON lines and syslog are parsed; unknown lines are kept, not dropped.' },
        { title: 'Error grouping', body: 'Messages that differ only by numbers, ids or quoted values are counted together.' },
        { title: 'Stack traces', body: 'Indented “at …” lines are attached to the error they belong to.' },
        { title: 'Regex search', body: 'Wrap a search in slashes, like /timeout \\d+/, for pattern matching.' },
      ]}
      note="Large files are parsed on the main thread; 5 MB is the upload limit. Timestamps without a time zone are treated as UTC."
      closing={{ title: <>Open your <em>noisiest log.</em></>, action: { href: '#/analyze', label: 'Analyze a log' } }}
    />
  );
}

function Analyze() {
  const [text, setText] = usePersistentState('loglens:text', DEMO);
  const [name, setName] = usePersistentState('loglens:name', 'demo-service.log');
  const [draft, setDraft] = useState('');
  const [levels, setLevels] = useState<Level[]>([...LEVELS]);
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('');
  const [range, setRange] = useState<[number, number] | null>(null);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [flash, setFlash] = useFlash(6000);
  const [expanded, setExpanded] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const entries = useMemo(() => parseLog(text), [text]);
  const counts = useMemo(() => countLevels(entries), [entries]);
  const sources = useMemo(() => [...new Set(entries.map((e) => e.source).filter((s): s is string => !!s))].sort(), [entries]);
  const { list, error } = useMemo(() => filterEntries(entries, { levels, query, source, from: range?.[0] ?? null, to: range?.[1] ?? null }), [entries, levels, query, source, range]);
  const groups = useMemo(() => errorGroups(list), [list]);
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  const resetFilters = () => { setLevels([...LEVELS]); setQuery(''); setSource(''); setRange(null); setPage(0); };

  async function onFile(f: File | undefined) {
    if (!f) return;
    if (f.size > MAX_BYTES) return setFlash({ kind: 'error', text: `${f.name} is ${(f.size / 1024 / 1024).toFixed(1)} MB. The limit is 5 MB — split the file or filter it first.` });
    setLoading(true);
    try {
      const t = await readFileText(f);
      if (/\u0000/.test(t.slice(0, 2000))) throw new Error('binary');
      setText(t);
      setName(f.name);
      resetFilters();
      setFlash({ kind: 'success', text: `Loaded ${f.name} — ${t.split(/\r?\n/).filter(Boolean).length.toLocaleString()} lines.` });
    } catch {
      setFlash({ kind: 'error', text: `${f.name} doesn’t look like a text log file.` });
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }
  const usePasted = () => {
    if (!draft.trim()) return setFlash({ kind: 'error', text: 'Paste some log lines first.' });
    setText(draft);
    setName('pasted log');
    setDraft('');
    resetFilters();
    setFlash({ kind: 'success', text: `Analyzing ${draft.split(/\r?\n/).filter(Boolean).length} pasted lines.` });
  };
  const toggleLevel = (l: Level) => { setLevels(levels.includes(l) ? levels.filter((x) => x !== l) : [...levels, l]); setPage(0); };

  return (
    <div className="stack">
      <PageHead
        eyebrow={<>Workspace · Analyze {text === DEMO && <DemoTag />}</>}
        title={<><em>{name}</em></>}
        description={entries.length ? `${entries.length.toLocaleString()} entries · ${counts.ERROR + counts.FATAL} errors · ${counts.WARN} warnings · ${sources.length} sources` : 'No log loaded.'}
        actions={
          <>
            <input ref={fileRef} type="file" accept=".log,.txt,.jsonl,.json,text/plain" className="sr-only" id="file" onChange={(e) => onFile(e.target.files?.[0])} />
            <label htmlFor="file" className="btn">{loading ? <><span className="spinner" aria-hidden="true" /> Reading…</> : 'Upload file'}</label>
            {text !== DEMO && <button type="button" className="btn" onClick={() => { setText(DEMO); setName('demo-service.log'); resetFilters(); }}>Load demo log</button>}
            {text && <button type="button" className="btn btn-ghost" onClick={() => { setText(''); setName('No log'); resetFilters(); }}>Clear</button>}
          </>
        }
      />
      {flash && <Notice kind={flash.kind} onDismiss={() => setFlash(null)}>{flash.text}</Notice>}
      <details className="card paste" open={!text}>
        <summary>Paste log lines</summary>
        <textarea className="code" rows={6} aria-label="Paste log lines" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={'2026-03-04T10:12:01Z ERROR [api] Something failed\n{"time":"…","level":"warn","msg":"…"}'} />
        <button type="button" className="btn btn-primary" onClick={usePasted}>Analyze pasted lines</button>
      </details>
      {!text ? (
        <EmptyState title="No log loaded" actions={<button type="button" className="btn btn-primary" onClick={() => { setText(DEMO); setName('demo-service.log'); }}>Load the demo log</button>}>Upload a file, paste lines above, or explore the demo log.</EmptyState>
      ) : (
        <>
          <section className="card" aria-labelledby="tl-title">
            <div className="card-title-row">
              <h2 id="tl-title">Timeline</h2>
              <div className="row small">
                {range ? <><span className="badge badge-accent">{fmtTime(range[0])}–{fmtTime(range[1])} UTC</span><button type="button" className="btn btn-sm" onClick={() => setRange(null)}>Clear time filter</button></> : <span className="muted">Click a bar to filter to that time window.</span>}
              </div>
            </div>
            <Timeline entries={entries.filter((e) => levels.includes(e.level))} onPick={(a, b) => { setRange(range && range[0] === a ? null : [a, b]); setPage(0); }} range={range} />
            <div className="legend small" style={{ marginTop: 10 }}>
              {(['FATAL', 'ERROR', 'WARN', 'INFO', 'DEBUG'] as Level[]).map((l) => <span key={l}><i className={`lv-${l}`} />{l}</span>)}
            </div>
          </section>
          <div className="an-grid">
            <aside className="card filters" aria-label="Filters">
              <span className="label">Severity</span>
              <div className="level-chips">
                {LEVELS.filter((l) => counts[l] > 0).map((l) => (
                  <button key={l} type="button" className={`lv-chip lv-${l} ${levels.includes(l) ? 'on' : 'off'}`} aria-pressed={levels.includes(l)} onClick={() => toggleLevel(l)}>
                    {l} <strong>{counts[l]}</strong>
                  </button>
                ))}
              </div>
              <div className="row small">
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setLevels(['ERROR', 'FATAL'])}>Errors only</button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setLevels([...LEVELS])}>All</button>
              </div>
              <div className="field">
                <label htmlFor="q">Search</label>
                <input id="q" type="search" className="code" value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} placeholder="text or /regex/" aria-invalid={error ? true : undefined} aria-describedby={error ? 'q-err' : 'q-hint'} />
                {error ? <span className="error-text" id="q-err">{error}</span> : <span className="hint" id="q-hint">Case-insensitive. Wrap in /…/ for a regular expression.</span>}
              </div>
              <div className="field">
                <label htmlFor="src">Source</label>
                <select id="src" value={source} onChange={(e) => { setSource(e.target.value); setPage(0); }}>
                  <option value="">All sources</option>
                  {sources.map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
              <button type="button" className="btn btn-sm" onClick={resetFilters}>Reset filters</button>
              {groups.length > 0 && (
                <div className="groups">
                  <span className="label">Repeated errors</span>
                  <ul className="list small">
                    {groups.map((g) => (
                      <li key={g.pattern}>
                        <button type="button" className="group-btn" onClick={() => { setQuery(g.sample.message.split('\n')[0].slice(0, 40)); setPage(0); }}>
                          <span className="badge badge-err">×{g.count}</span> <code>{g.pattern}</code>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </aside>
            <section className="card entries" aria-labelledby="ent-title">
              <div className="card-title-row">
                <h2 id="ent-title">Entries</h2>
                <span className="small muted" data-testid="shown">{list.length.toLocaleString()} of {entries.length.toLocaleString()} shown</span>
              </div>
              {list.length === 0 ? (
                <EmptyState title="No entries match" actions={<button type="button" className="btn" onClick={resetFilters}>Reset filters</button>}>{error ? 'The search pattern is invalid.' : 'Try another severity, source or search.'}</EmptyState>
              ) : (
                <>
                  <ol className="log-lines">
                    {list.slice(page * PAGE, page * PAGE + PAGE).map((e) => (
                      <li key={e.line} className={`log-line lv-row-${e.level}`}>
                        <button type="button" onClick={() => setExpanded(expanded === e.line ? null : e.line)} aria-expanded={expanded === e.line}>
                          <span className="ln">{e.line}</span>
                          <span className="ts">{e.ts != null ? new Date(e.ts).toISOString().slice(11, 19) : '—'}</span>
                          <span className={`lv lv-${e.level}`}>{e.level}</span>
                          <span className="src">{e.source ?? ''}</span>
                          <span className="msg">{e.message.split('\n')[0]}{e.message.includes('\n') && <em> +{e.message.split('\n').length - 1} lines</em>}</span>
                        </button>
                        {expanded === e.line && <pre className="raw">{e.raw}</pre>}
                      </li>
                    ))}
                  </ol>
                  {pages > 1 && (
                    <nav className="row pager" aria-label="Entry pages">
                      <button type="button" className="btn btn-sm" disabled={page === 0} onClick={() => setPage(page - 1)}>← Previous</button>
                      <span className="small muted">Page {page + 1} of {pages}</span>
                      <button type="button" className="btn btn-sm" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next →</button>
                    </nav>
                  )}
                </>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function Formats() {
  return (
    <div className="stack narrow">
      <PageHead eyebrow="Reference" title={<>Supported <em>formats</em></>} description="Lines that match none of these are kept with severity UNKNOWN." />
      <div className="card prose">
        <h2>Timestamped text</h2>
        <pre className="output">{'2026-03-04T10:12:01Z ERROR [payments] Card declined\n2026-03-04 10:12:01,250 WARNING api: slow query took 812ms\n[2026-03-04T10:12:01+01:00] info worker: started'}</pre>
        <h2>JSON lines</h2>
        <p>One JSON object per line with any of <code>time / timestamp / ts / @timestamp</code>, <code>level / severity</code>, <code>msg / message</code>, and <code>service / logger / source</code>. Numeric timestamps in seconds or milliseconds are accepted.</p>
        <pre className="output">{'{"time":"2026-03-04T10:00:00Z","level":"info","service":"web","msg":"started"}'}</pre>
        <h2>Syslog</h2>
        <p>Severity is inferred from words like “error” or “warning” in the message; the year is assumed to be the current year.</p>
        <pre className="output">{'Mar  4 10:12:01 host1 sshd[812]: error: authentication failure'}</pre>
        <h2>Severity names</h2>
        <p>warning → WARN, err → ERROR, critical / crit / panic → FATAL, notice → INFO, dbg → DEBUG.</p>
        <h2>Stack traces</h2>
        <p>Indented lines starting with <code>at</code>, <code>...</code> or <code>Caused by</code> are attached to the previous entry.</p>
      </div>
    </div>
  );
}
