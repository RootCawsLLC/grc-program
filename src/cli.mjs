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
      // Coverage is noisy by nature; summarise unless asked for it specifically.
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
    console.log('  Every assertion is marked fixture:true — a reference target is not a Reco runtime.\n');

    return chain.intact ? 0 : 1;
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
    console.log(`grc — Reco control inventory, evidence pipeline and risk layer

  validate     schema-check the inventory and run the guards
  intake       validate extracted audit findings and reconcile against the inventory
  health       control health as a classification, never a score   [--detail] [--json]
  gap          four-direction gap assessment    [--direction coverage|assurance|remediation|risk]
  baseline     intake + health + gap, in reading order. Start here on day 1.
  oscal        emit OSCAL assessment-results with deterministic UUIDs
  push         build the Scytale payload (dry-run unless --live)

The control repo is the system of record. Everything else is a projection of it.`);
  },
};

const code = await (commands[cmd] ?? commands.help)();
process.exit(code ?? 0);
