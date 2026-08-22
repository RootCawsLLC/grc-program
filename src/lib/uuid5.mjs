import { createHash } from 'node:crypto';

/**
 * RFC 4122 v5 (SHA-1, name-based) UUIDs over a fixed namespace.
 *
 * Why this is non-negotiable: with random UUIDs every OSCAL export produces a different file,
 * so diffs are unreviewable and the artifact cannot live meaningfully in Git. With v5 over a
 * fixed namespace an unchanged warehouse re-exports BYTE-IDENTICALLY and the diff shows only
 * real change. This is the direct answer to the strongest published criticism of OSCAL.
 *
 * The namespace is committed and never rotated. Rotating it orphans every previously issued
 * identifier in every artifact an auditor already holds.
 */
export const RECO_GRC_NAMESPACE = 'a2f1c0e4-8b3d-5f7a-9c21-6d4e8b0f13a7';

function uuidToBytes(uuid) {
  const hex = uuid.replace(/-/g, '');
  if (hex.length !== 32) throw new TypeError(`not a uuid: ${uuid}`);
  return Buffer.from(hex, 'hex');
}

export function uuid5(name, namespace = RECO_GRC_NAMESPACE) {
  if (typeof name !== 'string' || name.length === 0) {
    throw new TypeError('uuid5 requires a non-empty name');
  }
  const hash = createHash('sha1')
    .update(Buffer.concat([uuidToBytes(namespace), Buffer.from(name, 'utf8')]))
    .digest();

  const b = Buffer.from(hash.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50; // version 5
  b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant

  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const componentUuid   = (controlId)                 => uuid5(controlId);
export const requirementUuid = (controlId, fw, item)       => uuid5(`${controlId}|${fw}|${item}`);
export const resultUuid      = (controlId, asOf)           => uuid5(`${controlId}|${asOf}`);
export const observationUuid = (controlId, asOf, subject)  => uuid5(`${controlId}|${asOf}|${subject}`);
