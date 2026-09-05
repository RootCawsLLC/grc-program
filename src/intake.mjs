import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

import { mappingsOf, needsVerification } from './lib/finding.mjs';

/**
 * Audit intake.
 *
 * Turns assurance deliverables — the SOC 2 Type 2 report, the ISO Statement of Applicability, the
 * pentest report — into structured findings the rest of the pipeline can join against.
 *
 * DESIGN DECISION, and it matters: this does NOT parse PDFs.
 *
 * Audit reports are NDA-gated, frequently watermarked, and the cost of a mis-parse is a finding
 * silently dropped or invented. The extraction is human-in-the-loop and Claude-assisted — you read
 * the report, Claude Code drafts the YAML with you against a schema, you check it, it gets
 * committed. `.claude/commands/intake-soc2.md` drives that. Source documents live in
 * intake/source/, which is gitignored, and never enter version control.
 *
 * What this module does is the part that should be automated: validate the extraction, detect
 * unmapped findings, and reconcile against the control inventory.
 */

export async function loadFindings(dir = 'intake/extracted') {
  let files;
  try { files = (await readdir(dir)).filter((f) => /\.ya?ml$/.test(f)); }
  catch { return []; }

  const out = [];
  for (const f of files.sort()) {
    const doc = parseYaml(await readFile(join(dir, f), 'utf8'));
    if (!doc) continue;
    const items = Array.isArray(doc) ? doc : (doc.findings ?? []);
    for (const item of items) out.push({ _file: join(dir, f), ...item });
  }
  return out;
}

export async function loadRequirementIndex(path = 'reference/requirement-index.yaml') {
  try { return parseYaml(await readFile(path, 'utf8')); }
  catch { return null; }
}

/**
 * Reconcile the extraction against the control inventory. This is where intake earns its keep:
 * it tells you which findings the inventory has nowhere to put.
 */
export function reconcile({ findings, controls }) {
  const ids = new Set(controls.map((c) => c.control_id));
  const problems = [];
  const seen = new Set();

  for (const f of findings) {
    const at = { file: f._file, finding_id: f.finding_id };

    if (seen.has(f.finding_id)) problems.push({ severity: 'error', ...at, rule: 'F1-duplicate', message: `${f.finding_id} appears more than once` });
    seen.add(f.finding_id);

    // F2 and F3 run over EVERY mapping, primary and secondary. A dangling secondary is exactly as
    // broken as a dangling primary, and an unattributed one is exactly as much of a judgment —
    // checking only the primary would let a whole class of mapping in unexamined.
    for (const m of mappingsOf(f)) {
      const which = m.primary ? 'primary mapping' : 'also_implicates';
      if (!ids.has(m.control_id)) {
        problems.push({ severity: 'error', ...at, rule: 'F2-dangling-control', message: `${which} names ${m.control_id}, which is not in the inventory` });
      }
      if (!m.mapped_by) {
        problems.push({ severity: 'warning', ...at, rule: 'F3-unattributed-mapping', message: `${which} to ${m.control_id} has no mapped_by. Mapping is a judgment and carries a name.` });
      }
    }

    // A control named twice is a record that disagrees with itself: two confidences and two
    // attributions for one attribution, and no way to say which governs.
    const named = mappingsOf(f).map((m) => m.control_id);
    const duplicated = [...new Set(named.filter((c, i) => named.indexOf(c) !== i))];
    for (const c of duplicated) {
      problems.push({ severity: 'error', ...at, rule: 'F8-duplicate-mapping', message: `names ${c} more than once across control_id and also_implicates. One control, one mapping.` });
    }
    if (f.disposition === 'risk-accepted') {
      if (!f.accepted_by) problems.push({ severity: 'error', ...at, rule: 'F4-unnamed-acceptance', message: 'risk-accepted with no accepted_by. Acceptance carries a person, never a team and never a blank.' });
      if (!f.accepted_until) problems.push({ severity: 'error', ...at, rule: 'F5-open-ended-acceptance', message: 'risk-accepted with no expiry. An acceptance without an end date is a decision nobody revisits.' });
    }
    if (f.disposition === 'remediated' && !f.remediated_on) {
      problems.push({ severity: 'warning', ...at, rule: 'F6-undated-remediation', message: 'remediated with no date. The next auditor will ask when.' });
    }
    if (['nonconformity-major', 'nonconformity-minor'].includes(f.kind) && !f.framework_ref?.length) {
      problems.push({ severity: 'warning', ...at, rule: 'F7-unclaused-nonconformity', message: 'an ISO nonconformity with no clause reference cannot be closed out against the standard' });
    }
  }

  const open = findings.filter((f) => ['open', 'in-remediation'].includes(f.disposition));
  return {
    problems,
    summary: {
      total: findings.length,
      open: open.length,
      unmapped_open: open.filter((f) => !f.control_id).length,
      // Same shape as unmapped_open, and for the same reason: a count in the summary is what makes
      // a soft signal visible. A mapping is a judgment with a name on it, so anything not recorded
      // as `high` is unverified — including `null`, which is weaker than `low` because nobody even
      // said how sure they were.
      unverified_mapping_open: open.filter((f) => mappingsOf(f).some(needsVerification)).length,
      by_kind: tally(findings, (f) => f.kind),
      by_document: tally(findings, (f) => f.source?.document ?? 'unknown'),
      by_disposition: tally(findings, (f) => f.disposition),
    },
  };
}

const tally = (arr, fn) => arr.reduce((acc, x) => { const k = fn(x); acc[k] = (acc[k] ?? 0) + 1; return acc; }, {});
