import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Universal CSV adapter. Drop an export in inbox/<source>/ and it lands identically to an API
 * collector, except confidence_tier drops to 3 (external empirical, point-in-time) and the record
 * is marked degraded. That marking is the honesty: manual evidence is legitimate, pretending it
 * was automated is not.
 *
 * Expected header: subject_id,passing,reason,first_observed
 */
export async function collectCsvInbox({ inboxDir = 'inbox', source }) {
  const dir = join(inboxDir, source ?? '');
  let files;
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.csv'));
  } catch {
    return { rows: [], degraded: true, degraded_reason: `no csv inbox at ${dir}`, confidence_tier: 1 };
  }

  const rows = [];
  for (const file of files.sort()) {
    const text = await readFile(join(dir, file), 'utf8');
    const [header, ...lines] = text.trim().split(/\r?\n/);
    const cols = header.split(',').map((c) => c.trim());

    for (const line of lines) {
      if (!line.trim()) continue;
      const values = splitCsvLine(line);
      const rec = Object.fromEntries(cols.map((c, i) => [c, values[i]?.trim() ?? '']));
      rows.push({
        subject_id: rec.subject_id,
        passing: /^(true|yes|pass|1)$/i.test(rec.passing ?? ''),
        reason: rec.reason || null,
        first_observed: rec.first_observed || null,
        _meta: { source_file: file },
      });
    }
  }
  return { rows, degraded: true, degraded_reason: 'manual CSV export', confidence_tier: 3 };
}

function splitCsvLine(line) {
  const out = [];
  let cur = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = !inQuotes; }
    else if (ch === ',' && !inQuotes) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
