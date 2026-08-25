import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

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

    if (f.control_id && !ids.has(f.control_id)) {
      problems.push({ severity: 'error', ...at, rule: 'F2-dangling-control', message: `maps to ${f.control_id}, which is not in the inventory` });
    }
    if (f.control_id && !f.mapped_by) {
      problems.push({ severity: 'warning', ...at, rule: 'F3-unattributed-mapping', message: 'has a control mapping with no mapped_by. Mapping is a judgement and carries a name.' });
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
      // a soft signal visible. A mapping is a judgement with a name on it, so anything not recorded
      // as `high` is unverified — including `null`, which is weaker than `low` because nobody even
      // said how sure they were.
      unverified_mapping_open: open.filter((f) => f.control_id && f.mapping_confidence !== 'high').length,
      by_kind: tally(findings, (f) => f.kind),
      by_document: tally(findings, (f) => f.source?.document ?? 'unknown'),
      by_disposition: tally(findings, (f) => f.disposition),
    },
  };
}

const tally = (arr, fn) => arr.reduce((acc, x) => { const k = fn(x); acc[k] = (acc[k] ?? 0) + 1; return acc; }, {});
