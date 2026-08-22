import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uuid5, componentUuid, requirementUuid } from '../src/lib/uuid5.mjs';

test('matches the RFC 4122 v5 DNS test vector', () => {
  // Canonical vector: uuid5(DNS namespace, "python.org")
  const DNS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
  assert.equal(uuid5('python.org', DNS), '886313e1-3b8a-5372-9b90-0c9aee199e5d');
});

test('same input re-exports byte-identically — this is the whole point', () => {
  assert.equal(componentUuid('ctl.iam.enterprise-sso.mfa'), componentUuid('ctl.iam.enterprise-sso.mfa'));
});

test('different control ids do not collide', () => {
  assert.notEqual(componentUuid('ctl.iam.enterprise-sso.mfa'), componentUuid('ctl.iam.cloud-platform.mfa'));
});

test('requirement uuids are keyed on control + framework + item', () => {
  assert.notEqual(
    requirementUuid('ctl.iam.enterprise-sso.mfa', 'soc2', 'CC6.1'),
    requirementUuid('ctl.iam.enterprise-sso.mfa', 'soc2', 'CC6.2'),
  );
});

test('version and variant bits are set correctly', () => {
  const u = uuid5('anything');
  assert.equal(u[14], '5');
  assert.ok(['8', '9', 'a', 'b'].includes(u[19]));
});
