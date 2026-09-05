#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { validateAll, loadYamlDir } from './validate.mjs';
import { emitAssessmentResults, stableStringify } from './oscal/assessment-results.mjs';
import { emitAll } from './oscal/emit.mjs';
import { push } from './push/scytale.mjs';
import { assessAll, DEFICIENCIES, BANDS } from './health.mjs';
import { assessGaps } from './gap.mjs';
import { loadFindings, loadRequirementIndex, reconcile } from './intake.mjs';
import { loadAssertions, isFixtureSet, FIXTURE_STAMP } from './lib/load.mjs';

const [, , cmd, ...args] = process.argv;
const flag = (n) => args.includes(`--${n}`);
const opt  = (n, d = null) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };

const load = async () => ({
  controls:   await loadYamlDir('controls'),
  scenarios:  await loadYamlDir('scenarios'),
  exceptions: await loadYamlDir('exceptions'),
  findings:   await loadFindings(),
  assertions: await loadAssertions(opt('assertions') ?? 'fixtures/assertions.json'),
});
const write = async (p, o) => { await mkdir('out', { recursive: true }); await writeFile(p, stableStringify(o)); };

const commands = {
  async validate() {
    // --root lets the hook validate a directory other than the CWD, which is what makes
    // tests/hook.test.mjs able to run against a throwaway fixture instead of mutating the real
    // inventory. Test files run in parallel; a test that writes to controls/ races every other
    // test that reads it.
    const { problems, counts } = await validateAll({ root: opt('root') ?? '.' });
    const errors = problems.filter((p) => p.severity === 'error');
    console.log(`controls=${counts.controls} exceptions=${counts.exceptions} scenarios=${counts.scenarios}`);
    for (const p of problems) console.log(`  ${p.severity.toUpperCase().padEnd(7)} ${p.rule.padEnd(28)} ${p.file ?? ''}\n          ${p.message}`);
    console.log(`\n${errors.length} error(s), ${problems.length - errors.length} warning(s)`);
    return errors.length ? 1 : 0;
  },

  async intake() {
    const { controls, findings } = await load();
    const { problems, summary } = reconcile({ findings, controls });

    console.log(`\nAUDIT INTAKE — ${summary.total} finding(s) across ${Object.keys(summary.by_document).length} document(s)\n`);
    if (!summary.total) {
      console.log('  Nothing extracted yet. Start with the SOC 2 Type 2 report:');
      console.log('    1. put the PDF in intake/source/  (gitignored)');
      console.log('    2. run /intake-soc2 in Claude Code');
      console.log('    3. re-run `npm run intake`\n');
      return;
    }
    for (const [k, v] of Object.entries(summary.by_kind))        console.log(`  ${String(v).padStart(4)}  ${k}`);
    console.log('');
    for (const [k, v] of Object.entries(summary.by_disposition)) console.log(`  ${String(v).padStart(4)}  ${k}`);
    console.log(`\n  ${summary.open} open, of which ${summary.unmapped_open} map to NO control in the inventory.`);
    if (summary.unmapped_open) {
      console.log('  An unmapped open finding is the sharpest signal that the control model has a hole.');
      console.log('  Run `npm run gap -- --direction remediation` for the list.');
    }
    if (summary.unverified_mapping_open) {
      console.log(`\n  ${summary.unverified_mapping_open} open finding(s) carry an UNVERIFIED mapping — confidence below "high", or none recorded.`);
      console.log('  Mapping is a judgment, not a lookup. An unverified one misdirects the remediation');
      console.log('  and leaves the control that should have been named reading clean.');
    }
    if (problems.length) {
      console.log('');
      for (const p of problems) console.log(`  ${p.severity.toUpperCase().padEnd(7)} ${p.rule.padEnd(26)} ${p.finding_id}\n          ${p.message}`);
    }
    console.log('');
    return problems.some((p) => p.severity === 'error') ? 1 : 0;
  },

  async health() {
    const { controls, findings, assertions } = await load();
    const r = assessAll({ controls, assertions, findings, asOf: opt('as-of') ?? undefined });

    console.log(`\nCONTROL HEALTH — ${r.total_controls} controls, as of ${r.as_of}\n`);
    for (const [band, n] of Object.entries(r.by_band)) {
      console.log(`  ${String(n).padStart(4)}  ${band.padEnd(14)} ${BANDS[band]}`);
    }
    console.log('\n  Deficiencies (a control may carry several):\n');
    for (const [code, n] of Object.entries(r.by_deficiency)) {
      console.log(`  ${String(n).padStart(4)}  ${code.padEnd(24)} ${DEFICIENCIES[code].fix}`);
    }
    if (flag('detail')) {
      console.log('');
      for (const c of r.controls) {
        console.log(`  ${c.band.padEnd(13)} ${c.control_id}`);
        if (c.deficiencies.length) console.log(`                ${c.deficiencies.join(', ')}`);
      }
    }
    console.log(`\n  ${r.scoring_note}\n`);
    if (flag('json')) await write('out/control-health.json', r);
  },

  async gap() {
    const { controls, scenarios, findings } = await load();
    const requirementIndex = flag('no-coverage') ? null : await loadRequirementIndex();
    const r = assessGaps({ controls, scenarios, findings, requirementIndex });
    const only = opt('direction');

    console.log(`\nGAP ASSESSMENT — ${r.total} gap(s)\n`);
    for (const [d, n] of Object.entries(r.by_direction)) console.log(`  ${String(n).padStart(4)}  ${d}`);
    console.log(`\n  ${r.ordering_note}\n`);

    for (const dir of ['remediation', 'risk', 'assurance', 'coverage']) {
      const set = r.gaps.filter((g) => g.direction === dir);
      if (!set.length || (only && only !== dir)) continue;
      console.log(`\n── ${dir.toUpperCase()} ──`);
      // Coverage is noisy by nature; summarize unless asked for it specifically.
      const show = dir === 'coverage' && !only ? set.slice(0, 5) : set;
      for (const g of show) console.log(`  ${g.gap_id}  ${g.statement}`);
      if (show.length < set.length) console.log(`  … and ${set.length - show.length} more. Run \`npm run gap -- --direction coverage\`.`);
    }
    console.log('');
    if (flag('json')) await write('out/gap-assessment.json', r);
  },

  // The whole package, not one document. The artifacts cross-reference each other, and emitting a
  // subset leaves references dangling — which oscal-cli rejects with FODC0002 and a Java stack
  // trace rather than anything resembling a schema message.
  async oscal() {
    const { controls, assertions } = await load();
    const out = opt('out') ?? 'out';
    const written = await emitAll({ controls, assertions, out });
    console.log(`\nOSCAL package — ${written.length} document(s) in ${out}/\n`);
    for (const f of written) console.log(`  ${f}`);
    console.log('\n  Re-run on unchanged input and every one re-exports byte-identically.');
    console.log('  Schema conformance is proven by oscal-cli, not asserted here.\n');
  },

  async push() {
    const { controls, assertions } = await load();
    const res = await push({ assertions, controls, dryRun: !flag('live') });
    if (res.dryRun) {
      console.log('DRY RUN — nothing sent.');
      console.log('Reconcile against the JSON contract shown in the Scytale Custom Integration UI,');
      console.log('then update toScytalePayload() and set CONTRACT_CONFIRMED = true.\n');
      console.log(JSON.stringify(res.payloads, null, 2));
    } else console.log(`pushed ${res.pushed}`);
  },

  // Active testing, not attestation. Runs the AI agent probes against proofplane's reference
  // target — never a real system; src/probes/target.mjs refuses a non-loopback address — and turns
  // the paired guarded/unguarded results into assertion records.
  async probe() {
    const { runPaired, verifyChain } = await import('./probes/runner.mjs');
    const { assertionsFrom, gapsFrom } = await import('./probes/assertion.mjs');
    const { serialize } = await import('./oscal/common.mjs');

    const guardedUrl = opt('guarded') ?? 'http://127.0.0.1:8091';
    const unguardedUrl = opt('unguarded') ?? 'http://127.0.0.1:8092';
    const trials = Number(opt('trials') ?? 3);
    const out = opt('out') ?? 'out-probe';
    const asOf = opt('as-of') ?? new Date().toISOString().replace(/\.\d+Z$/, 'Z');

    const { controls } = await load();
    const evidence = await runPaired({ guardedUrl, unguardedUrl, trials, asOf });
    const chain = verifyChain(evidence);
    const { assertions, skipped } = assertionsFrom(evidence, controls);
    const gaps = gapsFrom(evidence);

    console.log(`\nAI AGENT CONTROL PROBES — ${evidence.records.length} probe(s), ${trials} trial(s) each\n`);
    console.log(`  guarded   ${evidence.targets.guarded.base_url}   model ${evidence.targets.guarded.model.name}@${evidence.targets.guarded.model.version}`);
    console.log(`  unguarded ${evidence.targets.unguarded.base_url}   audit chain intact: ${evidence.targets.guarded.audit_chain.intact}\n`);

    for (const r of evidence.records) {
      const flag = r.outcome === 'HELD' ? 'HELD  ' : r.outcome === 'VOID' ? 'VOID  ' : `${r.outcome}`;
      console.log(`  ${flag} ${r.probe_id}  ${r.title}`);
      console.log(`         guarded=${r.guarded.outcome} unguarded=${r.unguarded.outcome} discriminating=${r.discriminating}`);
      if (r.void_reason) console.log(`         ⚠ ${r.void_reason}`);
      if (r.qualification) console.log(`         ⚠ ${r.qualification}`);
      if (!r.control_id) console.log(`         no control in the inventory — needs ${r.missing_control}`);
    }

    console.log(`\n  hash chain: ${chain.intact ? 'intact' : `BROKEN at record ${chain.brokenAt} — ${chain.reason}`}`);
    console.log(`  assertions emitted: ${assertions.length}   skipped: ${skipped.length}   gaps: ${gaps.length}`);
    for (const s of skipped) console.log(`    skipped ${s.probe_id} (${s.reason})`);

    await mkdir(out, { recursive: true });
    await writeFile(`${out}/evidence.json`, serialize(evidence));
    await writeFile(`${out}/assertions.json`, serialize(assertions));
    await writeFile(`${out}/gaps.json`, serialize(gaps));
    console.log(`\n  wrote ${out}/{evidence,assertions,gaps}.json`);
    console.log('  Every assertion is marked fixture:true — a reference target is not a production runtime.\n');

    return chain.intact ? 0 : 1;
  },

  // FAIR Monte Carlo. Runs against fixtures/scenarios/ by default and REFUSES scenarios/, which
  // is the point of the unit rather than a limitation of it.
  async simulate() {
    const { simulate, rankByRosi, DEFAULT_TRIALS, DEFAULT_SEED } = await import('./simulate.mjs');
    const dir = opt('scenarios') ?? 'fixtures/scenarios';
    const trials = Number(opt('trials') ?? DEFAULT_TRIALS);
    const seed = Number(opt('seed') ?? DEFAULT_SEED);

    const scenarios = await loadYamlDir(dir);
    if (!scenarios.length) { console.log(`no scenarios in ${dir}`); return 1; }
    const controls = await loadYamlDir('controls');

    let result;
    try {
      result = simulate({ scenarios, trials, seed });
    } catch (err) {
      // The refusal IS the deliverable when pointed at scenarios/. Print it and exit non-zero.
      console.log(`\n${err.message}\n`);
      return 1;
    }

    const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
    console.log(`\nFAIR SIMULATION — ${scenarios.length} scenario(s), ${trials.toLocaleString('en-US')} trials, seed ${seed}\n`);
    console.log(`  source: ${dir}${dir.startsWith('fixtures') ? '   ** NOT REAL EVIDENCE — synthetic fixtures **' : ''}\n`);

    for (const s of result.scenarios) {
      console.log(`  ${s.scenario_id}   confidence tier ${s.confidence_tier}`);
      const y = s.summary;
      console.log(`    mean ${money(y.mean).padStart(12)}   p50 ${money(y.p50).padStart(12)}   p90 ${money(y.p90).padStart(12)}   p99 ${money(y.p99).padStart(13)}`);
      console.log(`    ${(y.quiet_years * 100).toFixed(1)}% of simulated years had no loss at all\n`);
    }

    const a = result.aggregate.summary;
    console.log('  AGGREGATE');
    console.log(`    mean ${money(a.mean).padStart(12)}   p50 ${money(a.p50).padStart(12)}   p90 ${money(a.p90).padStart(12)}   p99 ${money(a.p99).padStart(13)}`);
    console.log(`    worst simulated year ${money(a.max)}   confidence tier ${result.aggregate.confidence_tier}`);
    console.log(`\n    ${result.aggregate.independence_assumption.replace(/\n/g, '\n    ')}\n`);

    console.log('  LOSS EXCEEDANCE (aggregate)');
    for (const p of result.aggregate.exceedance_curve.filter((_, i) => i % 4 === 0)) {
      console.log(`    P(annual loss > ${money(p.loss).padStart(12)}) = ${(p.probability_of_exceeding * 100).toFixed(1)}%`);
    }

    const ranking = rankByRosi({ result, controls });
    console.log(`\n  ROSI — ${ranking.ranked.length} rankable, ${ranking.unrankable.length} not`);
    for (const r of ranking.ranked) console.log(`    ${r.rosi.toFixed(2)}x  ${r.control_id}`);
    for (const r of ranking.unrankable.slice(0, 3)) console.log(`    —      ${r.control_id}: ${r.reason}`);
    if (ranking.unrankable.length > 3) console.log(`    …and ${ranking.unrankable.length - 3} more`);
    if (ranking.note) console.log(`\n    ${ranking.note}`);

    if (flag('json')) {
      const { serialize } = await import('./oscal/common.mjs');
      const out = opt('out') ?? 'out-simulation';
      await mkdir(out, { recursive: true });
      await writeFile(`${out}/simulation.json`, serialize({ ...result, rosi: ranking }));
      console.log(`\n  wrote ${out}/simulation.json`);
    }
    console.log('');
  },

  // Asks the whole question before anything tries to use any of it. Runs first in ccm.yml so a
  // dispatch answers "what is missing" in one run, instead of dying four steps later on a
  // credentials error that names a symptom and hides the cause.
  async preflight() {
    const { preflight, report, loadInputs } = await import('./preflight.mjs');
    const { workflowText, commandNames } = loadInputs(opt('root') ?? '.');
    const result = preflight({ workflowText, commandNames });
    console.log(`\n${report(result)}\n`);
    return result.ready ? 0 : 1;
  },

  // --- the CCM pipeline: collect -> assert -> drift -> route ---------------------------------

  async collect() {
    const { collect, writeManifest } = await import('./collect.mjs');
    let manifest;
    try {
      manifest = await collect({
        fixture: flag('fixture'),
        sandbox: flag('sandbox'),
        allowEmpty: flag('allow-empty'),
        warehousePath: opt('warehouse') ?? undefined,
        asOf: opt('as-of') ?? null,
        githubSource: opt('github-source') ?? 'auto',
      });
    } catch (err) {
      // A refusal is a decision, not a crash. Printed as prose so a CI log reads as an answer
      // rather than as a stack trace somebody has to interpret.
      console.log(`\n${err.message}\n`);
      return 1;
    }
    const path = await writeManifest(manifest);
    console.log(`\nCOLLECT — ${manifest.mode}  ${manifest.total_rows} row(s) across ${manifest.cycles.length} cycle(s)\n`);
    for (const c of manifest.cycles) console.log(`  ${c.as_of}   ${String(c.rows).padStart(3)} rows   ${c.source}`);
    if (manifest.collectors) {
      console.log('');
      for (const [name, slice] of Object.entries(manifest.collectors)) {
        const n = slice.rows == null ? '—' : String(slice.rows);
        console.log(`  ${name.padEnd(8)} ${String(slice.status).padEnd(8)} rows=${n.padStart(3)}  ${slice.source}`);
      }
    }
    if (manifest.fixture) console.log(`\n  ${manifest.note}`);
    console.log(`\n  warehouse: ${manifest.warehouse}\n  manifest:  ${path}\n`);
  },

  async assert() {
    const { runAssert } = await import('./assert.mjs');
    const { serialize } = await import('./oscal/common.mjs');
    let r;
    try {
      r = await runAssert({ warehousePath: opt('warehouse') ?? undefined });
    } catch (err) {
      console.log(`\n${err.message}\n`);
      return 1;
    }

    console.log(`\nASSERT — ${r.assertions.length} assertion(s) over ${r.cycles.length} cycle(s)\n`);
    for (const a of r.assertions) {
      console.log(`  ${a.as_of}  ${a.control_id.padEnd(34)} ${a.passing_count}/${a.total} passing, ${a.failing_count} failing  (tier ${a.confidence_tier})`);
    }
    if (r.coverage.note) console.log(`\n  ${r.coverage.note}`);
    if (r.fixture) console.log('\n  Every assertion is marked fixture:true — this run measured stamped fixtures.');

    const out = opt('out') ?? '.warehouse/assertions.json';
    await mkdir(out.replace(/[/\\][^/\\]+$/, ''), { recursive: true });
    await writeFile(out, serialize(r.assertions));
    console.log(`\n  wrote ${out}\n`);
  },

  async drift() {
    const { assessDrift } = await import('./drift.mjs');
    const { loadAssertions } = await import('./lib/load.mjs');
    const assertions = await loadAssertions(opt('assertions') ?? '.warehouse/assertions.json');
    if (!assertions.length) { console.log('\nno assertions to compare. Run `assert` first.\n'); return 1; }

    const r = assessDrift({ assertions, tolerance: Number(opt('tolerance') ?? 0.10) });
    console.log(`\nDENOMINATOR DRIFT — tolerance ${(r.tolerance * 100).toFixed(0)}%\n`);
    for (const c of r.controls) {
      const moved = c.drifted ? '  ⚠ DRIFTED' : '';
      const from = c.comparable ? `${c.previous_total} -> ${c.current_total}` : `${c.current_total} (single observation)`;
      console.log(`  ${c.control_id.padEnd(34)} ${from}${moved}`);
      if (c.drifted) console.log(`      ${c.reason}`);
    }
    console.log(`\n  ${r.summary}\n`);
    // Non-zero holds the cycle: the pipeline must not route failures over a moved denominator.
    return r.hold ? 1 : 0;
  },

  async route() {
    const { route } = await import('./route.mjs');
    const { assessDrift } = await import('./drift.mjs');
    const { loadAssertions } = await import('./lib/load.mjs');
    const { controls, exceptions } = await load();
    const assertions = await loadAssertions(opt('assertions') ?? '.warehouse/assertions.json');
    if (!assertions.length) { console.log('\nno assertions to route. Run `assert` first.\n'); return 1; }

    const drift = assessDrift({ assertions, tolerance: Number(opt('tolerance') ?? 0.10) });
    const r = route({ assertions, controls, exceptions, drift });

    if (r.held) {
      console.log(`\nROUTING HELD\n\n  ${r.reason}\n`);
      for (const d of r.drifted) console.log(`  ${d.control_id}: ${d.previous_total} -> ${d.current_total}`);
      console.log('');
      return 1;
    }

    console.log(`\nROUTE — ${r.items.length} work item(s)\n`);
    for (const s of r.summaries) console.log(`  ${s.owner.padEnd(22)} ${s.message}`);
    for (const i of r.items.filter((x) => x.escalate_to_root_cause)) {
      console.log(`\n  ESCALATE  ${i.item_id}\n      ${i.escalation_note}`);
    }
    if (r.note) console.log(`  ${r.note}`);
    if (r.silent && r.items.length) console.log('\n  Nothing new this cycle. A silent channel is a working channel.');

    if (flag('dispatch')) {
      if (flag('live') || flag('send')) {
        console.log('\nrefusing --live/--send on route --dispatch. Events are planned, not posted.\n');
        return 1;
      }
      const { dispatchRoute, DEFAULT_GATES } = await import('./host.mjs');
      const store = flag('no-store') ? null : (opt('store') ?? DEFAULT_GATES);
      const dispatched = await dispatchRoute({ routed: r, assertions, store });
      console.log(`  DISPATCH — ${dispatched.events.length} event(s)  executed=${dispatched.executed}  sent=${dispatched.sent}`);
      for (const ev of dispatched.events) {
        console.log(`    ${ev.kind.padEnd(22)} ${ev.event_id}`);
      }
      if (!dispatched.events.length) console.log('    (none — continuing subjects stay silent)');
      if (flag('pack') || flag('draft')) {
        const { materializeDispatch, defaultPackDir } = await import('./pack.mjs');
        const packDir = opt('pack-dir') ?? defaultPackDir(Boolean(assertions.some((a) => a.fixture)));
        try {
          const packed = await materializeDispatch({
            results: dispatched.results,
            events: dispatched.events,
            dir: packDir,
            fixture: Boolean(assertions.some((a) => a.fixture)),
          });
          console.log(`  PACK — ${packed.files.length} file(s)  shared_state_file=${packed.shared_state_file}  executed=${packed.executed}`);
          for (const f of packed.files) console.log(`    ${f}`);
          if (!packed.files.length) console.log('    (none — no specialist was packed)');
          if (flag('draft')) {
            const { materializeDrafts } = await import('./draft.mjs');
            const drafted = await materializeDrafts({
              packs: packed.packs,
              dir: packDir,
              fixture: Boolean(assertions.some((a) => a.fixture)),
            });
            console.log(`  DRAFT — ${drafted.files.length} file(s)  posted=${drafted.posted}  executed=${drafted.executed}`);
            for (const d of drafted.drafts) {
              console.log(`    ${(d.specialist ?? '?').padEnd(24)} ok=${d.ok}  ${d.code ?? d.redirect ?? d.tool ?? ''}`);
            }
          }
        } catch (err) {
          console.log(`\n${err.message}\n`);
          return 1;
        }
      }
    }
    console.log('');
  },

  async orchestrate() {
    const { loadEvent, runGate, DEFAULT_GATES } = await import('./host.mjs');
    if (flag('live') || flag('send')) {
      console.log('\nrefusing --live/--send. This host writes presenter payloads. It does not post them.\n');
      return 1;
    }
    const path = opt('event');
    if (!path) {
      console.log('\norchestrate needs --event <file>\n');
      return 1;
    }
    let event;
    try {
      event = await loadEvent(path);
    } catch (err) {
      console.log(`\n${err.message}\n`);
      return 1;
    }
    const store = flag('no-store') ? null : (opt('store') ?? DEFAULT_GATES);
    const r = await runGate({ event, store });
    const stamp = r.fixture ? `   ** ${FIXTURE_STAMP} — synthetic fixture **` : '';
    console.log(`\nORCHESTRATE — ${event.kind}  ${event.event_id}${stamp}\n`);
    if (r.plan) {
      console.log(`  accepted=${r.plan.accepted}  freeze=${r.plan.freeze}  held=${r.plan.held}  executed=${r.executed}  sent=${r.sent}`);
      if (r.plan.reason) console.log(`  ${r.plan.reason}`);
      for (const t of r.plan.tasks) console.log(`  task  ${t.agent.padEnd(24)} effect=${t.effect}`);
      if (!r.plan.tasks.length) console.log('  (no specialists — human decision or a hold)');
    }
    if (r.gate) {
      console.log(`\n  gate  ${r.gate.gate_id}  ${r.gate.kind} via ${r.gate.presenter}`);
      console.log(`        next_step=${r.gate.next_step}  executed=${r.gate.executed}${store ? `  store=${store}` : ''}`);
    } else {
      console.log('\n  (no gate)');
    }
    if (flag('pack') || flag('draft')) {
      const { materializePacks, defaultPackDir } = await import('./pack.mjs');
      const packDir = opt('pack-dir') ?? defaultPackDir(Boolean(r.fixture));
      try {
        const packed = await materializePacks({
          plan: r.plan,
          event,
          dir: packDir,
          fixture: Boolean(r.fixture),
        });
        console.log(`\n  PACK — ${packed.files.length} file(s)  shared_state_file=${packed.shared_state_file}  executed=${packed.executed}`);
        for (const f of packed.files) console.log(`    ${f}`);
        if (!packed.files.length) console.log('    (none — no specialist was packed)');
        if (flag('draft')) {
          const { materializeDrafts } = await import('./draft.mjs');
          const drafted = await materializeDrafts({
            packs: packed.plan.tasks.map((t) => t.input_pack),
            dir: packDir,
            fixture: Boolean(r.fixture),
          });
          console.log(`\n  DRAFT — ${drafted.files.length} file(s)  posted=${drafted.posted}  executed=${drafted.executed}`);
          for (const d of drafted.drafts) {
            console.log(`    ${(d.specialist ?? '?').padEnd(24)} ok=${d.ok}  ${d.code ?? d.redirect ?? d.tool ?? ''}`);
          }
        }
      } catch (err) {
        console.log(`\n${err.message}\n`);
        return 1;
      }
    }
    if (flag('json')) {
      const out = opt('out') ?? 'out/orchestrate.json';
      await mkdir(out.replace(/[/\\][^/\\]+$/, ''), { recursive: true });
      await writeFile(out, stableStringify(r));
      console.log(`\n  wrote ${out}`);
    }
    console.log('');
    return r.ok ? 0 : 1;
  },

  async gate() {
    const { loadEvent, runGate, listStored, DEFAULT_GATES } = await import('./host.mjs');
    if (flag('live') || flag('send')) {
      console.log('\nrefusing --live/--send. This host writes presenter payloads. It does not post them.\n');
      return 1;
    }
    const store = flag('no-store') ? null : (opt('store') ?? DEFAULT_GATES);

    if (flag('list')) {
      const pending = await listStored(store ?? DEFAULT_GATES);
      console.log(`\nGATES — ${pending.length} pending  store=${store ?? DEFAULT_GATES}\n`);
      for (const g of pending) {
        console.log(`  ${g.gate_id.padEnd(42)} ${g.kind.padEnd(22)} ${g.action}`);
      }
      if (!pending.length) console.log('  (none)');
      console.log('');
      return 0;
    }

    const interactionPath = opt('interaction');
    if (interactionPath) {
      const { handleStoredInteraction, loadEvent: loadPayload } = await import('./host.mjs');
      const { readIdentityMap, resolveInteractionActor, verifySlackRequest, verifyGitHubRequest } = await import('./inbound.mjs');
      if (flag('signed-github')) {
        const rawBody = await readFile(interactionPath, 'utf8');
        const verified = verifyGitHubRequest({
          signingSecret: process.env.GITHUB_WEBHOOK_SECRET,
          rawBody,
          signature: opt('signature'),
        });
        if (!verified.ok) {
          console.log(`\n${verified.message}\n`);
          return 1;
        }
      } else if (flag('signed') || opt('signature')) {
        const rawBody = await readFile(interactionPath, 'utf8');
        const verified = verifySlackRequest({
          signingSecret: process.env.SLACK_SIGNING_SECRET,
          timestamp: opt('timestamp'),
          rawBody,
          signature: opt('signature'),
        });
        if (!verified.ok) {
          console.log(`\n${verified.message}\n`);
          return 1;
        }
      }
      let payload;
      try {
        payload = await loadPayload(interactionPath);
      } catch (err) {
        console.log(`\n${err.message}\n`);
        return 1;
      }
      let map;
      if (opt('map')) {
        try {
          map = await readIdentityMap(opt('map'));
        } catch (err) {
          console.log(`\n${err.message}\n`);
          return 1;
        }
      }
      const resolved = resolveInteractionActor({ payload, map, actor: opt('actor') });
      if (!resolved.ok) {
        console.log(`\n${resolved.message}\n`);
        return 1;
      }
      const r = await handleStoredInteraction({
        store: store ?? DEFAULT_GATES,
        payload,
        map,
        extras: {
          actor: resolved.actor,
          at: opt('at'),
          expires_on: opt('expires-on'),
          ge_materiality: flag('ge-materiality'),
        },
      });
      const stamp = r.fixture ? `   ** ${FIXTURE_STAMP} — synthetic fixture **` : '';
      console.log(`\nGATE — interaction  ${r.gate?.gate_id ?? ''}${stamp}\n`);
      if (r.decision) {
        console.log(`  decision  ok=${r.decision.ok}  status=${r.decision.record.status}  executed=${r.decision.record.executed}  sent=${r.sent}`);
        if (r.decision.code) console.log(`            ${r.decision.code}: ${r.decision.message}`);
      } else {
        console.log(`  ${r.message ?? r.code ?? 'no decision'}`);
      }
      console.log('');
      return r.ok ? 0 : 1;
    }

    if (flag('present')) {
      const { sendPresenter } = await import('./present.mjs');
      const { loadGateLog, latestGate } = await import('./gates.mjs');
      const { presentGate } = await import('./gate.mjs');
      const gateId = opt('id');
      if (!gateId) {
        console.log('\n--present needs --id <gate_id>\n');
        return 1;
      }
      const { entries } = await loadGateLog(store ?? DEFAULT_GATES);
      const pending = latestGate(entries, gateId);
      if (!pending) {
        console.log(`\nNo gate ${gateId} in ${store ?? DEFAULT_GATES}\n`);
        return 1;
      }
      const payload = presentGate(pending);
      let sent;
      try {
        sent = await sendPresenter({ presenter: pending.presenter, payload, live: false });
      } catch (err) {
        console.log(`\n${err.message}\n`);
        return 1;
      }
      console.log(`\nPRESENT — ${gateId}  dryRun=${sent.dryRun}  sent=${sent.sent}  executed=${sent.executed}\n`);
      if (payload.text) console.log(`  slack fallback: ${payload.text}`);
      if (payload.body) console.log(`  github comment written to payload (${payload.body.split('\n').length} lines)`);
      if (payload.title) console.log(`  linear: ${payload.title}`);
      console.log('');
      return 0;
    }

    const path = opt('event');
    const gateId = opt('id');
    if (!path && !gateId) {
      console.log('\ngate needs --event <file>, --id <gate_id>, --list, --interaction <file>, or --present\n');
      return 1;
    }
    let event;
    if (path) {
      try {
        event = await loadEvent(path);
      } catch (err) {
        console.log(`\n${err.message}\n`);
        return 1;
      }
    }
    const verdict = opt('verdict');
    const decision = verdict
      ? {
        verdict,
        actor: opt('actor'),
        at: opt('at') ?? event?.as_of,
        expires_on: opt('expires-on'),
        ge_materiality: flag('ge-materiality'),
      }
      : undefined;
    const r = await runGate({ event, gate_id: gateId, decision, store });
    const stamp = r.fixture ? `   ** ${FIXTURE_STAMP} — synthetic fixture **` : '';
    const label = event?.kind ?? r.gate?.kind ?? 'gate';
    console.log(`\nGATE — ${label}  ${event?.event_id ?? gateId ?? ''}${stamp}\n`);
    if (!r.gate) {
      console.log(`  ${r.message ?? 'no gate'}\n`);
      return 1;
    }
    console.log(`  ${r.gate.gate_id}  ${r.gate.kind} via ${r.presenter?.presenter ?? r.gate.presenter}`);
    console.log(`  ${r.gate.summary}`);
    console.log(`  executed=${r.executed}  sent=${r.sent}  next_step=${r.gate.next_step}${store ? `  store=${store}` : ''}`);
    if (r.presenter?.text) console.log(`\n  slack fallback: ${r.presenter.text}`);
    if (r.presenter?.body) console.log(`\n  github comment:\n${r.presenter.body.split('\n').map((l) => `    ${l}`).join('\n')}`);
    if (r.presenter?.description) console.log(`\n  linear: ${r.presenter.title}`);
    if (r.decision) {
      console.log(`\n  decision  ok=${r.decision.ok}  status=${r.decision.record.status}  executed=${r.decision.record.executed}`);
      if (r.decision.code) console.log(`            ${r.decision.code}: ${r.decision.message}`);
    } else {
      console.log('\n  pending — pass --id <gate_id> --verdict approve|reject|acknowledge --actor per.*');
    }
    if (flag('json')) {
      const out = opt('out') ?? 'out/gate.json';
      await mkdir(out.replace(/[/\\][^/\\]+$/, ''), { recursive: true });
      await writeFile(out, stableStringify(r));
      console.log(`\n  wrote ${out}`);
    }
    console.log('');
    return r.ok ? 0 : 1;
  },

  async baseline() {
    // The day-1 command. Everything at once, in the order you should read it.
    //
    // Sub-commands RETURN an exit code rather than calling process.exit, precisely so this
    // composes. An early process.exit here would silently truncate the run after intake and
    // report success — which is the failure mode where you think you have a baseline and you
    // have the first third of one.
    let worst = 0;
    for (const c of ['intake', 'health', 'gap']) worst = Math.max(worst, (await commands[c]()) ?? 0);
    return worst;
  },

  help() {
    console.log(`grc — the organization control inventory, evidence pipeline and risk layer

  validate     schema-check the inventory and run the guards
  intake       validate extracted audit findings and reconcile against the inventory
  health       control health as a classification, never a score   [--detail] [--json]
  gap          four-direction gap assessment    [--direction coverage|assurance|remediation|risk]
  baseline     intake + health + gap, in reading order. Start here on day 1.
  oscal        emit OSCAL assessment-results with deterministic UUIDs
  push         build the Scytale payload (dry-run unless --live)
  collect      land source state, time-indexed (--fixture | --sandbox; default is live and refuses)
  assert       build assertion records from what collect landed
  drift        denominator movement, checked BEFORE failures are routed
  route        failing subjects -> work items. --dispatch wraps new items as events. --pack / --draft hydrate and draft, never post
  orchestrate  dispatch one event envelope (--event). --pack / --draft write per-specialist files. --live is refused
  gate         present / decide a human gate (--event | --id | --list | --interaction | --present | --map | --signed | --signed-github). --live is refused
  probe        AI agent control probes against a local target
  simulate     FAIR Monte Carlo; refuses uncalibrated scenarios

The control repo is the system of record. Everything else is a projection of it.`);
  },
};

/**
 * An unknown command is a failure, not a request for help.
 *
 * This used to be `commands[cmd] ?? commands.help`, and `help()` returns undefined, so
 * `node src/cli.mjs collect --all` printed the help text and exited 0. `ccm.yml` invokes four
 * commands that do not exist - collect, assert, drift, route - and every one of them therefore
 * SUCCEEDED. Restoring that workflow's credentials would have produced a green
 * continuous-controls-monitoring run that collected no evidence at all, emitted OSCAL over stale
 * state, and committed nothing, with a check mark against it.
 *
 * Same shape as the regression recorded at the top of tests/cli.test.mjs, where `baseline` stopped
 * after `intake` and reported success having run a third of the assessment. Reporting success for
 * work that did not happen is the failure mode this repository exists to make impossible; a CLI
 * that does it to its own operator is not exempt.
 *
 * A BARE invocation is different and stays exit 0: `node src/cli.mjs` with no argument is someone
 * asking what this thing does, and answering that is not an error.
 */
const handler = commands[cmd];
if (!handler) {
  if (cmd) console.error(`grc: unknown command "${cmd}"\n`);
  await commands.help();
  process.exit(cmd ? 1 : 0);
}
const code = await handler();
process.exit(code ?? 0);
