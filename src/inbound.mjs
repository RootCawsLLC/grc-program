/**
 * Inbound Slack / GitHub interactions — verify the request, then name the human.
 *
 * `present.mjs` is the outbound half: payloads leave only after a confirmed
 * contract, and even then `executed` stays false. This file is the inbound
 * half. A Slack `user.id` is not a `per.*` actor. A GitHub `sender.id` is
 * not one either. A display name or login is not identity. An unsigned body
 * is not a click.
 *
 * Mapping is explicit. Slack keys are `U…` user ids; GitHub keys are numeric
 * account ids. Usernames and logins are refused at load so they cannot be
 * looked up later. Unmapped users are refused.
 *
 * Signature verification is a function, not a listener. An HTTP receiver that
 * "isn't wired yet" is the first real inbound. Call these from whatever
 * eventually listens; do not add a server here.
 *
 * GitHub's HMAC does not bind a timestamp. Replay protection is a delivery-id
 * at the listener, which does not exist yet. Do not invent one here.
 *
 * Consent recorded after a verified, mapped click is still not a merge
 * (ADR-0009). `executed` stays false.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';

import { FIXTURE_STAMP, isUnderFixtures } from './lib/load.mjs';
import { PERSON_ID } from './gate.mjs';

export const SLACK_MAX_SKEW_SECONDS = 300;
export const SIGNING_SECRET_ENV = 'SLACK_SIGNING_SECRET';
export const GITHUB_SIGNING_SECRET_ENV = 'GITHUB_WEBHOOK_SECRET';
export const SLACK_USER_ID = /^U[A-Z0-9]+$/i;
export const GITHUB_USER_ID = /^[1-9][0-9]*$/;

export function signSlackRequest(signingSecret, timestamp, rawBody) {
  const base = `v0:${timestamp}:${rawBody}`;
  return `v0=${createHmac('sha256', signingSecret).update(base).digest('hex')}`;
}

/**
 * Slack signing-secret check. Missing secret, skew, or a bad HMAC is a
 * refusal, not a degraded "unsigned is fine".
 *
 * @param {{ signingSecret?: string, timestamp?: string|number, rawBody?: string, signature?: string, now?: number, maxSkewSeconds?: number }} opts
 */
export function verifySlackRequest({
  signingSecret,
  timestamp,
  rawBody,
  signature,
  now = Date.now(),
  maxSkewSeconds = SLACK_MAX_SKEW_SECONDS,
} = {}) {
  if (typeof signingSecret !== 'string' || signingSecret.trim() === '') {
    return {
      ok: false,
      code: 'missing-signing-secret',
      message:
        `Refusing signed interaction: ${SIGNING_SECRET_ENV} is absent. ` +
        'An unsigned click is not a degraded verified one.',
    };
  }
  if (timestamp === undefined || timestamp === null || timestamp === ''
      || signature === undefined || signature === null || signature === ''
      || rawBody === undefined || rawBody === null) {
    return {
      ok: false,
      code: 'incomplete-signed-request',
      message: 'Signed interaction needs timestamp, raw body and signature. Partial headers are not a signature.',
    };
  }
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || ts <= 0) {
    return {
      ok: false,
      code: 'bad-timestamp',
      message: `Slack timestamp ${JSON.stringify(timestamp)} is not a unix epoch.`,
    };
  }
  const skew = Math.abs(now / 1000 - ts);
  if (skew > maxSkewSeconds) {
    return {
      ok: false,
      code: 'replay-window',
      message: `timestamp skew ${Math.round(skew)}s exceeds ${maxSkewSeconds}s. Treating as replay.`,
    };
  }
  const expected = signSlackRequest(signingSecret, String(timestamp), String(rawBody));
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(signature), 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return {
      ok: false,
      code: 'bad-signature',
      message: 'Slack signature does not match. Unsigned or tampered payload refused.',
    };
  }
  return { ok: true, executed: false };
}

export function signGitHubRequest(signingSecret, rawBody) {
  return `sha256=${createHmac('sha256', signingSecret).update(String(rawBody)).digest('hex')}`;
}

/**
 * GitHub webhook HMAC (`X-Hub-Signature-256`). Missing secret or a bad
 * digest is a refusal. There is no timestamp in this scheme.
 */
export function verifyGitHubRequest({ signingSecret, rawBody, signature } = {}) {
  if (typeof signingSecret !== 'string' || signingSecret.trim() === '') {
    return {
      ok: false,
      code: 'missing-signing-secret',
      message:
        `Refusing signed interaction: ${GITHUB_SIGNING_SECRET_ENV} is absent. ` +
        'An unsigned webhook is not a degraded verified one.',
    };
  }
  if (signature === undefined || signature === null || signature === ''
      || rawBody === undefined || rawBody === null) {
    return {
      ok: false,
      code: 'incomplete-signed-request',
      message: 'Signed GitHub interaction needs raw body and X-Hub-Signature-256. Partial headers are not a signature.',
    };
  }
  const expected = signGitHubRequest(signingSecret, rawBody);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(signature), 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return {
      ok: false,
      code: 'bad-signature',
      message: 'GitHub signature does not match. Unsigned or tampered payload refused.',
    };
  }
  return { ok: true, executed: false };
}

function cleanJoin(table, keyOk, kind) {
  if (table == null) return {};
  if (typeof table !== 'object' || Array.isArray(table)) {
    throw new Error(`identity map.${kind} must be an object of ${kind} id → per.*.`);
  }
  const clean = {};
  for (const [key, value] of Object.entries(table)) {
    if (!keyOk.test(key)) {
      throw new Error(
        `identity map key ${JSON.stringify(key)} is not a ${kind} user id. ` +
          'Usernames, logins and display names are not identity.',
      );
    }
    if (typeof value !== 'string' || !PERSON_ID.test(value)) {
      throw new Error(
        `identity map target ${JSON.stringify(value)} for ${key} is not a per.* person_id. ` +
          'Do not invent an approver.',
      );
    }
    clean[key] = value;
  }
  return clean;
}

/**
 * Parse an identity map. Slack keys are `U…`. GitHub keys are numeric account
 * ids. A login or username key is refused at the door.
 */
export function parseIdentityMap(obj, { path = '' } = {}) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('identity map must be an object with a slack and/or github join table.');
  }
  if (isUnderFixtures(path) && obj._stamp !== FIXTURE_STAMP) {
    throw new Error(
      `refusing unstamped fixture identity map ${path}. ` +
        `Expected _stamp: "${FIXTURE_STAMP}". An unstamped map is indistinguishable from a real join.`,
    );
  }
  return {
    slack: cleanJoin(obj.slack ?? {}, SLACK_USER_ID, 'slack'),
    github: cleanJoin(obj.github ?? {}, GITHUB_USER_ID, 'github'),
    fixture: obj._stamp === FIXTURE_STAMP || obj.fixture === true,
  };
}

export async function readIdentityMap(path) {
  const text = await readFile(path, 'utf8');
  const obj = /\.ya?ml$/i.test(path) ? parseYaml(text) : JSON.parse(text);
  return parseIdentityMap(obj, { path });
}

function slackIdFrom(payload) {
  const id = payload?.user?.id;
  return typeof id === 'string' && SLACK_USER_ID.test(id) ? id : null;
}

function githubIdFrom(payload) {
  const id = payload?.sender?.id ?? payload?.comment?.user?.id;
  if (id == null || id === '') return null;
  const asString = String(id);
  return GITHUB_USER_ID.test(asString) ? asString : null;
}

/**
 * Name the human who clicked. Slack and GitHub only identify a workspace or
 * account; the host has to join that onto a `per.*` via `--actor` or `--map`.
 */
export function resolveInteractionActor({ payload, map, actor } = {}) {
  const rawSlack = payload?.user?.id ?? null;
  if (rawSlack && PERSON_ID.test(rawSlack)) {
    return {
      ok: false,
      code: 'slack-id-is-not-a-person',
      message:
        `Slack user.id ${JSON.stringify(rawSlack)} looks like a person_id. ` +
        'That field is a workspace identifier, not an approver. Refuse rather than trust it.',
    };
  }
  const login = payload?.sender?.login ?? payload?.comment?.user?.login ?? null;
  if (login && PERSON_ID.test(login)) {
    return {
      ok: false,
      code: 'github-login-is-not-a-person',
      message:
        `GitHub login ${JSON.stringify(login)} looks like a person_id. ` +
        'A login is not an approver. Refuse rather than trust it.',
    };
  }

  const slackUser = slackIdFrom(payload);
  const githubUser = githubIdFrom(payload);

  let fromMap = null;
  let via = 'actor';
  if (map) {
    const hasSlack = Boolean(map.slack && Object.keys(map.slack).length);
    const hasGithub = Boolean(map.github && Object.keys(map.github).length);
    if (slackUser && (hasSlack || !hasGithub)) {
      fromMap = map.slack?.[slackUser] ?? null;
      via = 'slack';
      if (!fromMap) {
        return {
          ok: false,
          code: 'unmapped-slack-user',
          message:
            `Slack user ${slackUser} is not in the identity map. ` +
            'Do not invent a per.* id from the username or display name.',
        };
      }
    } else if (githubUser && (hasGithub || !hasSlack)) {
      fromMap = map.github?.[githubUser] ?? null;
      via = 'github';
      if (!fromMap) {
        return {
          ok: false,
          code: 'unmapped-github-user',
          message:
            `GitHub user ${githubUser} is not in the identity map. ` +
            'Do not invent a per.* id from the login.',
        };
      }
    } else if (slackUser && hasGithub && !hasSlack) {
      return {
        ok: false,
        code: 'map-has-no-slack',
        message: 'Identity map has no slack join table. A Slack user.id cannot be resolved from GitHub ids.',
      };
    } else if (githubUser && hasSlack && !hasGithub) {
      return {
        ok: false,
        code: 'map-has-no-github',
        message: 'Identity map has no github join table. A GitHub sender.id cannot be resolved from Slack ids.',
      };
    } else {
      return {
        ok: false,
        code: 'missing-sender',
        message: 'Identity map was supplied but the payload has no Slack user.id or GitHub sender.id to join on.',
      };
    }
  }

  if (actor && fromMap && actor !== fromMap) {
    return {
      ok: false,
      code: 'actor-mismatch',
      message: `--actor ${actor} does not match mapped ${fromMap}.`,
    };
  }

  const resolved = fromMap ?? actor ?? null;
  if (!resolved) {
    return {
      ok: false,
      code: 'actor-required',
      message: 'A Slack user.id or GitHub sender.id is not a person_id. Pass --actor per.* or --map <identity-file>.',
    };
  }
  if (!PERSON_ID.test(resolved)) {
    return {
      ok: false,
      code: 'actor-not-a-person',
      message: `${JSON.stringify(resolved)} is not a per.* person_id.`,
    };
  }
  return { ok: true, actor: resolved, via: fromMap ? via : 'actor' };
}
