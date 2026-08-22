/**
 * Emits the whole OSCAL package from the control inventory.
 *
 * One entry point, because the artifacts cross-reference each other and emitting a subset produces
 * documents whose references dangle. That is not a theoretical concern: this repo shipped an
 * assessment-results whose `import-ap` pointed at an assessment-plan nobody generated, and
 * oscal-cli rejects it with FODC0002 and a Java stack trace rather than a readable schema message.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { serialize, FILENAMES, profileFilename } from './common.mjs';
import { emitCatalog, emitProfiles } from './catalog.mjs';
import { emitComponentDefinition } from './component-definition.mjs';
import { emitAssessmentPlan } from './assessment-plan.mjs';
import { emitAssessmentResults } from './assessment-results.mjs';
import { emitPoam } from './poam.mjs';
import { emitSsp } from './ssp.mjs';

/**
 * Builds every document. Returns `{filename: document}` rather than writing, so tests can assert on
 * the objects and the determinism check can serialize twice without touching disk.
 */
export function buildPackage({ controls, assertions = [], variance = [], asOf = null }) {
  const stamp = asOf ?? assertions.map((a) => a.as_of).sort().at(-1) ?? null;
  const docs = {};

  docs[FILENAMES.catalog] = emitCatalog({ controls, assertions });
  for (const { key, doc } of emitProfiles({ controls, assertions })) docs[profileFilename(key)] = doc;
  docs[FILENAMES['component-definition']] = emitComponentDefinition({ controls, assertions });
  docs[FILENAMES['assessment-plan']] = emitAssessmentPlan({ controls, assertions });
  docs[FILENAMES.poam] = emitPoam({ controls, assertions, variance });
  docs[FILENAMES.ssp] = emitSsp({ controls, assertions });

  // Emitted last so the package it references already exists in `docs`.
  if (assertions.length) {
    docs[FILENAMES['assessment-results']] = emitAssessmentResults({ assertions, controls, asOf: stamp });
  }

  return docs;
}

export async function emitAll({ controls, assertions = [], variance = [], asOf = null, out = 'out' }) {
  const docs = buildPackage({ controls, assertions, variance, asOf });
  await mkdir(out, { recursive: true });
  const written = [];
  for (const [filename, doc] of Object.entries(docs).sort(([a], [b]) => a.localeCompare(b))) {
    await writeFile(join(out, filename), serialize(doc));
    written.push(filename);
  }
  return written;
}
