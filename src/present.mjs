/**
 * Presenter send adapter — payloads leave this process only after a confirmed
 * contract, and even then `executed` stays false.
 *
 * Same shape as the Scytale adapter (ADR-0001) and live `collect`: a dry run
 * is the default; `--live` without a confirmed contract is a refusal, not a
 * no-op. A send that quietly does nothing looks like success, and the next
 * person to "fix" it is the first to contact a real channel.
 *
 * CONTRACT_CONFIRMED stays false until a human reconciles chat.postMessage /
 * the GitHub review-comment API / Linear `save_issue` against what we actually
 * emit. Guessing those field names produces a message that looks like a gate
 * and is not one.
 *
 * A successful send posts the presenter payload. It does not merge, accept
 * risk, or change cloud. Consent is not execution — see ADR-0009. The inbound
 * half (signature + identity map) lives in `src/inbound.mjs`.
 */

export const CONTRACT_CONFIRMED = false;

export const LIVE_CREDENTIALS = Object.freeze({
  slack: ['SLACK_BOT_TOKEN', 'SLACK_CHANNEL'],
  github: ['GH_TOKEN', 'GITHUB_REPOSITORY'],
  linear: ['LINEAR_API_KEY'],
});

const present = (name, env) => typeof env[name] === 'string' && env[name].trim() !== '';

export function presentReadiness(presenter, env = process.env) {
  const vars = LIVE_CREDENTIALS[presenter];
  if (!vars) {
    return { presenter, missing: [`unknown presenter ${presenter}`], ready: false };
  }
  const missing = vars.filter((v) => !present(v, env));
  return { presenter, missing, ready: missing.length === 0 };
}

function endpoint(presenter) {
  if (presenter === 'slack') return 'https://slack.com/api/chat.postMessage';
  if (presenter === 'github') return 'https://api.github.com/repos/{owner}/{repo}/pulls/comments';
  if (presenter === 'linear') return 'https://api.linear.app/graphql';
  return null;
}

/**
 * @param {{ presenter: string, payload: object, live?: boolean, contractConfirmed?: boolean, env?: object, fetchImpl?: Function }} opts
 */
export async function sendPresenter({
  presenter,
  payload,
  live = false,
  contractConfirmed = CONTRACT_CONFIRMED,
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!live) {
    return { sent: false, dryRun: true, executed: false, payload };
  }
  if (!contractConfirmed) {
    throw new Error(
      'Refusing to send: the presenter contract has not been confirmed. ' +
        'Posting a guessed Slack/GitHub/Linear body produces a message that looks like a gate ' +
        'and is not one. Confirm the payload against the live API, then set CONTRACT_CONFIRMED.',
    );
  }
  const { missing } = presentReadiness(presenter, env);
  if (missing.length) {
    throw new Error(
      `Refusing to send: missing ${missing.join(', ')}. ` +
        'Absent credentials are not a degraded send.',
    );
  }
  const url = endpoint(presenter);
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return {
    sent: Boolean(res?.ok),
    dryRun: false,
    executed: false,
    status: res?.status ?? 0,
  };
}
