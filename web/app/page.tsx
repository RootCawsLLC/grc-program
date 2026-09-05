'use client';

import { useState } from 'react';

/* ---- light client-side mirrors of the tool's shapes (only fields we render) ---- */
interface Edge { framework: string; id: string; kind: string; }
interface Control {
  control_id: string;
  title: string;
  status: string;
  layer: string;
  owner: string;
  source_system: string | null;
  query_ref: string | null;
  population_definition: string;
  cadence: string | null;
  mechanism: string | null;
  faircam: { function: string; primary: boolean }[];
  scenarios: string[];
  crosswalk: Edge[];
  crosswalk_frameworks: number;
}
interface Segment { span: string; days: number | null; faircam_function: string; fix: string; }
interface Episode {
  control_id: string; subject_id: string; open: boolean; started_at_quality: string;
  variance_started_at: string; variance_detected_at: string;
  remediation_started_at: string | null; remediation_completed_at: string | null;
  total_duration_days: number | null; segments: Segment[]; impossible_start: boolean;
}
interface Cycle {
  as_of: string; total: number; passing_count: number; failing_count: number;
  failing: { subject_id: string; reason: string }[]; drifted: boolean; drift_reason: string | null;
}
interface Pipeline {
  control_id: string | null;
  landed: { as_of: string; rows: number }[];
  retainedRows: number | null; cycleCount: number;
  cycles: Cycle[]; episodes: Episode[];
}
interface Health {
  as_of: string; total_controls: number;
  by_band: Record<string, number>;
  band_descriptions: Record<string, string>;
  by_deficiency: Record<string, { count: number; fix: string }>;
  scoring_note: string;
  controls: { control_id: string; band: string; deficiencies: string[]; last_assertion: string | null; population_total: number | null }[];
}
interface Gap {
  total: number; by_direction: Record<string, number>; ordering_note: string;
  gaps: { gap_id: string; direction: string; subject: string; statement: string }[];
}
interface OscalFile { name: string; model: string; bytes: number; preview: string; }
interface Result {
  toolVersion: string; node: string; fixtureStamp: string; isFixture: boolean;
  controlCount: number; crosswalkEdges: number; controlsWithEvidence: number;
  inventory: Control[];
  pipeline?: Pipeline; health?: Health; gap?: Gap;
  oscal?: { files: OscalFile[]; count: number };
  durationMs: number;
}

export default function Page() {
  const [pipeline, setPipeline] = useState(true);
  const [health, setHealth] = useState(true);
  const [gap, setGap] = useState(true);
  const [oscal, setOscal] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sections: { pipeline, health, gap, oscal } }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Run failed.');
      setResult(data as Result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Run failed.');
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <h1>grc-program</h1>
      <p className="thesis">
        A GRC programme as a <b>git repository</b>. The <b>control inventory is the system of
        record</b>; frameworks, evidence, health, gaps and OSCAL are all <b>projections</b> of it.
        The same pipeline that lands time-indexed evidence derives per-control assertions, decomposes
        each variance into the FAIR-CAM functions, and emits the OSCAL package with deterministic UUIDs.
      </p>
      <p className="sub">
        <a href="https://github.com/RootCawsLLC/grc-program">Source</a> · This runs the{' '}
        <b>real tool</b> out-of-process — it opens a DuckDB warehouse over the bundled synthetic
        fixtures, contacts no real system and uses no credentials, by design.
      </p>

      <div className="callout">
        Click <b>Run</b> to drive the real pipeline (<code>runPipeline</code>) plus{' '}
        <code>grc health</code>, <code>grc gap</code> and <code>grc emit</code> against the{' '}
        <span className="stamp">NOT REAL EVIDENCE</span> fixtures. The pipeline&apos;s loader{' '}
        <i>refuses</i> any fixture cycle missing that stamp, so the door itself keeps this synthetic —
        and every assertion it produces carries <code>fixture:true</code>, which is what stamps the
        OSCAL package. Nothing below is a recording.
      </div>

      <div className="panel">
        <div className="sections">
          {[
            ['Evidence pipeline', pipeline, setPipeline, 'landing → assertions → variance'],
            ['Control health', health, setHealth, 'a classification, never a score'],
            ['Gap assessment', gap, setGap, 'four directions'],
            ['OSCAL package', oscal, setOscal, 'every projection, emitted'],
          ].map(([label, val, set, hint]) => (
            <label className="section-tog" key={label as string}>
              <input
                type="checkbox"
                checked={val as boolean}
                onChange={(e) => (set as (v: boolean) => void)(e.target.checked)}
              />
              <span>
                <span className="lt">{label as string}</span>{' '}
                <span className="notes">— {hint as string}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="run-row">
          <button className="run" onClick={run} disabled={running}>
            {running ? 'Running…' : 'Run the programme'}
          </button>
          {running && (
            <span className="notes">
              <span className="spinner" /> Spawning a clean Node process that opens DuckDB, runs the
              pipeline and emits OSCAL…
            </span>
          )}
        </div>
      </div>

      {error && <div className="err">{error}</div>}
      {result && <Results r={result} />}
    </>
  );
}

function Results({ r }: { r: Result }) {
  return (
    <>
      <h2>Result <span className="h2note">— tool v{r.toolVersion}, {r.node}, {(r.durationMs / 1000).toFixed(2)}s</span></h2>
      <div className="panel">
        <div className="summary">
          <span><b>{r.controlCount}</b><br />controls</span>
          <span><b>{r.crosswalkEdges}</b><br />crosswalk edges</span>
          <span><b>{r.controlsWithEvidence}</b><br />with evidence</span>
          {r.pipeline && <span><b>{r.pipeline.episodes.length}</b><br />variance episodes</span>}
          {r.health && <span><b>{r.health.by_band.instrumented}</b><br />instrumented</span>}
          {r.gap && <span><b>{r.gap.total}</b><br />gaps</span>}
          {r.oscal && <span><b>{r.oscal.count}</b><br />OSCAL docs</span>}
          <span style={{ alignSelf: 'center' }}><span className="stamp">{r.fixtureStamp}</span></span>
        </div>
      </div>

      <Inventory inventory={r.inventory} />
      {r.pipeline && <PipelineView p={r.pipeline} />}
      {r.health && <HealthView h={r.health} />}
      {r.gap && <GapView g={r.gap} />}
      {r.oscal && <OscalView files={r.oscal.files} />}
    </>
  );
}

const statusClass = (s: string) => `st-${s}`;

function Inventory({ inventory }: { inventory: Control[] }) {
  return (
    <>
      <h2>The control inventory <span className="h2note">— one YAML record per control; frameworks are crosswalk edges, not the substrate</span></h2>
      {inventory.map((c) => (
        <div className="control" key={c.control_id}>
          <div className="c-head">
            <span className="c-id">{c.control_id}</span>
            <span className={`badge ${statusClass(c.status)}`}>{c.status}</span>
            <span className="badge layer">{c.layer}</span>
          </div>
          <div className="c-title">{c.title}</div>
          <div className="c-meta">
            owner: {c.owner}
            {c.source_system && <> · source: {c.source_system}</>}
            {c.cadence && <> · cadence: {c.cadence}{c.mechanism ? `/${c.mechanism}` : ''}</>}
            {c.faircam.length > 0 && <> · FAIR-CAM: {c.faircam.map((f) => `${f.function}${f.primary ? '*' : ''}`).join(', ')}</>}
            {c.scenarios.length > 0 && <> · scenarios: {c.scenarios.length}</>}
          </div>
          <div className="c-xw">
            {c.crosswalk.map((e, i) => (
              <span className="edge" key={i}>
                {e.framework} <span className="cf">{e.id}</span>
              </span>
            ))}
          </div>
          <details className="detail">
            <summary>Population &amp; query</summary>
            <div className="body">
              <span className="lbl">Population definition</span>
              {c.population_definition}
              {c.query_ref && (
                <>
                  <span className="lbl">Query reference</span>
                  <code>{c.query_ref}</code>
                </>
              )}
              <span className="lbl">Framework crosswalk ({c.crosswalk.length} edges across {c.crosswalk_frameworks} frameworks)</span>
              {c.crosswalk.map((e) => `${e.framework}:${e.id}`).join('  ·  ')}
            </div>
          </details>
        </div>
      ))}
    </>
  );
}

const fmtTs = (v: string | null) => (v ? v.replace('T', ' ').replace('.000Z', '').replace('Z', '') : '—');
const segDays = (d: number | null) => (d === null || d === undefined ? '—' : `${d.toFixed(1)}d`);

function PipelineView({ p }: { p: Pipeline }) {
  return (
    <>
      <h2>The evidence pipeline <span className="h2note">— time-indexed landing → per-cycle assertion → variance; for {p.control_id}</span></h2>
      <div className="panel">
        <p className="notes" style={{ marginTop: 0 }}>
          <b>{p.retainedRows ?? '—'}</b> rows retained across <b>{p.cycleCount}</b> append-only
          cycles. The landing layer never overwrites — that is the whole reason the variance layer
          below is reachable at all. A pipeline that overwrites is a dashboard.
        </p>
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr><th>Cycle (as_of)</th><th>Landed</th><th>Total</th><th>Passing</th><th>Failing</th><th>Failing subjects</th></tr>
            </thead>
            <tbody>
              {p.cycles.map((c, i) => (
                <tr key={c.as_of}>
                  <td className="mono">{fmtTs(c.as_of)}</td>
                  <td>{p.landed[i]?.rows ?? '—'}</td>
                  <td>{c.total}</td>
                  <td className="ok">{c.passing_count}</td>
                  <td className={c.failing_count > 0 ? 'fail' : ''}>{c.failing_count}{c.drifted ? ' ⚠' : ''}</td>
                  <td className="mono" style={{ fontSize: '0.72rem' }}>
                    {c.failing.map((f) => `${f.subject_id} (${f.reason})`).join('; ') || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="notes" style={{ marginTop: '0.6rem' }}>
          The denominator held at {p.cycles[0]?.total} across every cycle. Population drift is itself
          a control metric — a pass rate that &ldquo;improves&rdquo; because the denominator shrank
          is a failure of the asset inventory, not a success of the control.
        </p>
      </div>

      <h3 style={{ fontSize: '0.85rem', margin: '1rem 0 0.5rem', color: 'var(--ink)' }}>
        Variance episodes — the four timestamps, decomposed into the FAIR-CAM functions
      </h3>
      {p.episodes.map((e) => (
        <div className={`episode ${e.open ? 'open' : ''}`} key={e.subject_id}>
          <div>
            <span className="sid">{e.subject_id}</span>
            {e.open && <span className="openpill">still open</span>}
          </div>
          <div className="timeline">
            started {fmtTs(e.variance_started_at)} <span className="arr">→</span>{' '}
            detected {fmtTs(e.variance_detected_at)} <span className="arr">→</span>{' '}
            touched {fmtTs(e.remediation_started_at)} <span className="arr">→</span>{' '}
            closed {fmtTs(e.remediation_completed_at)}
          </div>
          <div className="segs">
            {e.segments.map((s) => (
              <div className="seg" key={s.span}>
                <div className="sd">{segDays(s.days)}</div>
                <div className="sl">{s.faircam_function}</div>
                <div className="sf">fix: {s.fix}</div>
              </div>
            ))}
          </div>
          <div className="notes" style={{ marginTop: '0.4rem' }}>
            total {segDays(e.total_duration_days)} · started_at quality: {e.started_at_quality}
          </div>
          {e.impossible_start && (
            <div className="impossible">
              ⚠ started_at predates the last cycle in which this subject was observed passing — not a
              slow detection but an impossible timestamp, reported at the highest quality rung.
            </div>
          )}
        </div>
      ))}
      <p className="notes">
        Knowing remediation took 36 days is not actionable. Knowing which of those days were
        detection versus implementation tells you which function to fix. That decomposition is the
        part almost nobody emits.
      </p>
    </>
  );
}

function HealthView({ h }: { h: Health }) {
  return (
    <>
      <h2>Control health <span className="h2note">— a classification, never a score, as of {fmtTs(h.as_of)}</span></h2>
      <div className="bands">
        {Object.entries(h.by_band).map(([band, n]) => (
          <div className={`band ${band}`} key={band}>
            <div className="bn"><b>{n}</b> {band}</div>
            <div className="bd">{h.band_descriptions[band]}</div>
          </div>
        ))}
      </div>
      <div className="panel" style={{ marginTop: '0.75rem' }}>
        <div className="notes" style={{ marginBottom: '0.5rem', fontWeight: 600, color: 'var(--ink-2)' }}>
          Deficiencies (a control may carry several) — each with its fix:
        </div>
        <div className="tbl-wrap">
          <table>
            <thead><tr><th>Code</th><th>Count</th><th>Fix</th></tr></thead>
            <tbody>
              {Object.entries(h.by_deficiency).map(([code, d]) => (
                <tr key={code}>
                  <td className="mono">{code}</td>
                  <td>{d.count}</td>
                  <td className="notes">{d.fix}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="tbl-wrap" style={{ marginTop: '0.75rem' }}>
          <table>
            <thead><tr><th>Control</th><th>Band</th><th>Deficiencies</th><th>Last assertion</th></tr></thead>
            <tbody>
              {h.controls.map((c) => (
                <tr key={c.control_id}>
                  <td className="mono">{c.control_id}</td>
                  <td>{c.band}</td>
                  <td className="mono" style={{ fontSize: '0.72rem' }}>{c.deficiencies.join(', ') || '—'}</td>
                  <td className="mono">{fmtTs(c.last_assertion)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="notes" style={{ marginTop: '0.7rem' }}>{h.scoring_note}</p>
      </div>
    </>
  );
}

const DIRECTIONS: [string, string][] = [
  ['remediation', 'an open finding with no operating control — the only direction on someone else’s calendar'],
  ['risk', 'a scenario with nothing operating against it — unmitigated exposure, the board conversation'],
  ['assurance', 'a control with no executable evidence — an assertion, not a control'],
  ['coverage', 'an in-scope framework requirement with no control mapped to it'],
];

function GapView({ g }: { g: Gap }) {
  const [showAllCoverage, setShowAllCoverage] = useState(false);
  return (
    <>
      <h2>Gap assessment <span className="h2note">— {g.total} gaps across four directions, because &ldquo;gap&rdquo; means four different things</span></h2>
      <div className="panel">
        <div className="summary" style={{ marginBottom: '0.75rem' }}>
          {DIRECTIONS.map(([d]) => (
            <span key={d}><b>{g.by_direction[d] ?? 0}</b><br />{d}</span>
          ))}
        </div>
        {DIRECTIONS.map(([dir, blurb]) => {
          const set = g.gaps.filter((x) => x.direction === dir);
          if (!set.length) return null;
          const isCoverage = dir === 'coverage';
          const show = isCoverage && !showAllCoverage ? set.slice(0, 5) : set;
          return (
            <div className="gapdir" key={dir}>
              <h3>{dir} <span className="gc">— {blurb}</span></h3>
              {show.map((x) => (
                <div className={`gap ${dir}`} key={x.gap_id}>
                  <span className="gid">{x.gap_id}</span>{x.statement}
                </div>
              ))}
              {isCoverage && set.length > show.length && (
                <button className="run" style={{ padding: '0.3rem 0.8rem', fontSize: '0.8rem', marginTop: '0.3rem' }}
                  onClick={() => setShowAllCoverage(true)}>
                  Show all {set.length} coverage gaps
                </button>
              )}
            </div>
          );
        })}
        <p className="notes">{g.ordering_note}</p>
      </div>
    </>
  );
}

function OscalView({ files }: { files: OscalFile[] }) {
  return (
    <>
      <h2>OSCAL package <span className="h2note">— {files.length} documents, deterministic v5 UUIDs; re-exports byte-identically</span></h2>
      <div className="oscal">
        {files.map((f) => (
          <div className="ofile" key={f.name}>
            <div className="on">{f.name}</div>
            <div className="om">{f.model} · {f.bytes.toLocaleString()} bytes</div>
            <details className="oprev">
              <summary>Preview</summary>
              <pre>{f.preview}</pre>
            </details>
          </div>
        ))}
      </div>
      <p className="notes" style={{ marginTop: '0.5rem' }}>
        Every artifact carries the <span className="stamp">NOT REAL EVIDENCE</span> stamp in its
        metadata because it was generated from synthetic assertions. The catalog, profiles,
        component-definition, SSP, POA&amp;M and assessment-results all cross-reference each other —
        which is why the tool emits the whole package, not a subset. In the tool these also validate
        against NIST&apos;s <code>oscal-cli</code> as a blocking CI gate (that step needs Java and is
        not run in this browser demo).
      </p>
    </>
  );
}
