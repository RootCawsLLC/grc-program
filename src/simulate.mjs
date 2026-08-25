/**
 * FAIR Monte Carlo — machinery only.
 *
 * THE POINT OF THIS UNIT IS THE REFUSAL. Every scenario in scenarios/ carries
 * `derivation_level: assumed`, and this engine will not simulate any of them. A loss exceedance
 * curve drawn over invented parameters looks exactly like one drawn over calibrated ones — same
 * axes, same smooth shape, same authority — and it is fiction. That is worse than no curve,
 * because a curve ENDS the conversation: nobody argues with a chart. Refusing keeps the question
 * open until a named human has done the work.
 *
 * So the engine is built, tested against a labelled fixture, and left pointed at a register it
 * declines to run. On the day the calibration workshop fills in parameters, the curve appears that
 * afternoon instead of a build starting.
 *
 * TRIANGULAR, NOT PERT — a deliberate deviation from B21's wording. A scenario parameter here is
 * exactly three numbers: min, most_likely, max. A PERT fit needs a fourth, the shape parameter
 * (conventionally lambda=4), which nobody supplied and which materially moves the tail. Adding it
 * would manufacture confidence out of nothing, in the one file whose entire purpose is refusing to
 * do that. Triangular claims no more than the three points support. The same choice, for the same
 * reason, is documented in RootCawsLLC/proofplane's exposure module.
 *
 * SEEDED, ALWAYS. Every other artifact in this repo is byte-reproducible. A risk number that moved
 * between runs would be the one figure a reader had to take on trust, and it could not be diffed,
 * committed or argued with.
 */

import { rosi } from './faircam.mjs';

export const DEFAULT_TRIALS = 10_000;
export const DEFAULT_SEED = 20260822;

// ── sampling primitives ──────────────────────────────────────────────────────────────────────

/** mulberry32. Small, fast, adequate for loss aggregation. NOT for cryptography. */
export function seeded(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Triangular sample by inverse transform, over {min, most_likely, max}. */
export function triangular(rand, { min, most_likely: mode, max }) {
  if (max === min) return min;
  const u = rand();
  const split = (mode - min) / (max - min);
  return u < split
    ? min + Math.sqrt(u * (max - min) * (mode - min))
    : max - Math.sqrt((1 - u) * (max - min) * (max - mode));
}

/** Standard normal by Box–Muller. Used only as the large-lambda Poisson approximation. */
export function normal(rand) {
  const u1 = Math.max(rand(), Number.MIN_VALUE); // rand() can return exactly 0; log(0) is -Infinity
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * rand());
}

export const POISSON_EXACT_LIMIT = 30;

/**
 * Event count for one simulated year, given a per-year rate.
 *
 * Knuth's product method below lambda=30, a normal approximation above it — past that the product
 * loop needs impractically many draws and loses precision. At lambda=30 the Poisson skew is about
 * 0.18, well inside the noise of the three-point estimates feeding it.
 */
export function poisson(rand, lambda) {
  if (lambda <= 0) return 0;
  if (lambda > POISSON_EXACT_LIMIT) {
    return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * normal(rand)));
  }
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k += 1;
    p *= rand();
  } while (p > limit);
  return k - 1;
}

/** Percentile of a sorted array, by nearest rank. */
export function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(Math.max(rank - 1, 0), sorted.length - 1)];
}

const round = (n) => Math.round(n * 100) / 100;

/**
 * The distribution, never a bare expected value.
 *
 * `quiet_years` is the share of simulated years with no loss at all, and it is the number a mean
 * hides: a scenario losing $10M once a decade and one losing $1M every year have the same expected
 * loss and are not the same risk. Reporting the mean alone is how that distinction disappears.
 */
export function summarise(losses) {
  const sorted = [...losses].sort((a, b) => a - b);
  const total = sorted.reduce((acc, v) => acc + v, 0);
  return {
    trials: sorted.length,
    mean: round(total / (sorted.length || 1)),
    p50: round(percentile(sorted, 50)),
    p90: round(percentile(sorted, 90)),
    p95: round(percentile(sorted, 95)),
    p99: round(percentile(sorted, 99)),
    max: round(sorted.at(-1) ?? 0),
    quiet_years: round(sorted.filter((v) => v === 0).length / (sorted.length || 1)),
  };
}

/**
 * Loss exceedance curve: P(annual loss > x) at each point.
 *
 * The curve is the deliverable, not the percentiles. A percentile answers "how bad is the 90th
 * percentile year"; the curve answers "how likely is a year worse than X", which is the question
 * a risk-acceptance decision actually turns on.
 */
export function exceedanceCurve(losses, points = 20) {
  const sorted = [...losses].sort((a, b) => a - b);
  if (!sorted.length) return [];
  const curve = [];
  for (let i = 1; i <= points; i += 1) {
    const p = (i / (points + 1)) * 100;
    const loss = percentile(sorted, p);
    // Strictly greater: the probability of a year WORSE than this.
    const exceeding = sorted.filter((v) => v > loss).length / sorted.length;
    curve.push({ loss: round(loss), probability_of_exceeding: round(exceeding * 1000) / 1000 });
  }
  return curve;
}

// ── the refusal ──────────────────────────────────────────────────────────────────────────────

/** Provenance levels that represent real work having been done. */
export const CALIBRATED = new Set(['measured', 'derived', 'calibrated-estimate']);

/**
 * Refuses any scenario carrying an uncalibrated parameter, naming every one.
 *
 * Named, not counted. "3 scenarios are uncalibrated" sends someone hunting; naming the scenario,
 * the parameter and its declared source tells them exactly what to take to the workshop.
 */
export function assertCalibrated(scenarios) {
  const problems = [];
  for (const s of scenarios) {
    for (const [name, param] of Object.entries(s.parameters ?? {})) {
      const level = param?.provenance?.derivation_level;
      if (!CALIBRATED.has(level)) {
        problems.push({
          scenario_id: s.scenario_id,
          parameter: name,
          derivation_level: level ?? '<missing>',
          confidence_tier: param?.provenance?.confidence_tier ?? null,
          source: param?.provenance?.source ?? '<missing>',
        });
      }
    }
  }
  if (!problems.length) return scenarios;

  const lines = problems.map(
    (p) => `    ${p.scenario_id}  ${p.parameter}  [${p.derivation_level}, tier ${p.confidence_tier}]\n      ${p.source}`,
  );
  const err = new Error(
    `refusing to simulate: ${problems.length} parameter(s) across ` +
    `${new Set(problems.map((p) => p.scenario_id)).size} scenario(s) are not calibrated.\n` +
    lines.join('\n') +
    '\n\n  A loss exceedance curve over assumed parameters looks identical to one over calibrated\n' +
    '  parameters and is fiction. That is worse than no curve, because a curve ends the conversation.\n' +
    '  These move to calibrated-estimate or measured at the calibration workshop, by a named human,\n' +
    '  against Reco\'s own data. See scenarios/_CALIBRATION-STATUS.md.',
  );
  err.problems = problems;
  throw err;
}

// ── the engine ───────────────────────────────────────────────────────────────────────────────

/**
 * One simulated year per trial: draw a rate, draw a Poisson event count from it, draw a magnitude
 * per event, sum.
 *
 * THE AGGREGATE ASSUMES SCENARIO INDEPENDENCE, and says so in its own output. Losses are summed
 * ACROSS scenarios WITHIN each simulated year and the percentiles taken of that total — not summed
 * from per-scenario percentiles, which is a different and wrong number, because it implicitly
 * assumes every scenario has its bad year simultaneously.
 *
 * Independence is itself an assumption and frequently a false one: a credential-theft event and a
 * tenant-boundary event may share a root cause. Correlated scenarios would produce a fatter tail
 * than this reports. The aggregate carries that caveat rather than burying it in a doc.
 */
export function simulate({ scenarios, trials = DEFAULT_TRIALS, seed = DEFAULT_SEED }) {
  assertCalibrated(scenarios);

  for (const s of scenarios) {
    for (const [name, p] of Object.entries(s.parameters ?? {})) {
      if (!(p.min <= p.most_likely && p.most_likely <= p.max)) {
        throw new Error(`${s.scenario_id} ${name}: expected min <= most_likely <= max, got ${p.min}/${p.most_likely}/${p.max}`);
      }
      if (p.min < 0) throw new Error(`${s.scenario_id} ${name}: negative minimum (${p.min})`);
    }
    if (!s.parameters?.loss_event_frequency) throw new Error(`${s.scenario_id}: no loss_event_frequency`);
    if (!s.parameters?.primary_loss_magnitude) throw new Error(`${s.scenario_id}: no primary_loss_magnitude`);
  }

  // One generator for the whole run, consumed in a fixed order, so the result is a pure function
  // of (scenarios, trials, seed).
  const rand = seeded(seed);
  const perScenario = scenarios.map(() => []);
  const portfolio = [];

  for (let i = 0; i < trials; i += 1) {
    let yearTotal = 0;
    for (let s = 0; s < scenarios.length; s += 1) {
      const { loss_event_frequency: lef, primary_loss_magnitude: plm } = scenarios[s].parameters;
      const events = poisson(rand, triangular(rand, lef));
      let loss = 0;
      for (let e = 0; e < events; e += 1) loss += triangular(rand, plm);
      perScenario[s].push(loss);
      yearTotal += loss;
    }
    portfolio.push(yearTotal);
  }

  return {
    trials,
    seed,
    scenarios: scenarios.map((s, i) => ({
      scenario_id: s.scenario_id,
      statement: s.statement?.trim(),
      estimation_level: s.estimation_level,
      controls: s.controls ?? [],
      // Carried through, per B21. The weakest input governs how much the output is worth.
      confidence_tier: Math.min(
        ...Object.values(s.parameters).map((p) => p.provenance?.confidence_tier ?? 1),
      ),
      derivation_levels: Object.fromEntries(
        Object.entries(s.parameters).map(([k, p]) => [k, p.provenance?.derivation_level]),
      ),
      summary: summarise(perScenario[i]),
      exceedance_curve: exceedanceCurve(perScenario[i]),
    })),
    aggregate: {
      summary: summarise(portfolio),
      exceedance_curve: exceedanceCurve(portfolio),
      independence_assumption:
        'Scenarios are simulated as INDEPENDENT. Losses are summed across scenarios within each ' +
        'simulated year and percentiles taken of that total. If scenarios share a root cause — a ' +
        'credential-theft event and a tenant-boundary event plausibly do — the real tail is fatter ' +
        'than this shows. Aggregated risk reported without this statement is meaningless.',
      confidence_tier: Math.min(
        ...scenarios.flatMap((s) => Object.values(s.parameters).map((p) => p.provenance?.confidence_tier ?? 1)),
      ),
    },
  };
}

// ── ROSI ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Ranks controls by loss reduction per dollar.
 *
 * TWO INPUTS ARE MISSING FROM THIS REPO AND NEITHER IS GUESSED.
 *
 * 1. Control efficacy. Nothing in schemas/control.schema.json or schemas/scenario.schema.json
 *    carries how much a control reduces frequency or magnitude. Without it there is no ALE-after,
 *    so there is no reduction to divide. `efficacy` must be supplied by the caller, per control,
 *    from a source that named a human — this function will not invent one. See ADR-0004: an agent
 *    may not conclude how well a control works.
 * 2. Annual cost. Every control in the inventory carries `cost.opex_annual: 0` with a PLACEHOLDER
 *    basis. rosi() in faircam.mjs already refuses to divide by it, correctly: ROSI at zero cost is
 *    undefined, not infinite.
 *
 * So on today's inventory every control comes back unrankable, with the reason. That is the
 * accurate answer, and it is a work list.
 */
export function rankByRosi({ result, controls, efficacy = {} }) {
  const aleByScenario = new Map(result.scenarios.map((s) => [s.scenario_id, s.summary.mean]));

  const rows = controls.map((control) => {
    const covered = result.scenarios.filter((s) => (s.controls ?? []).includes(control.control_id));
    const aleBefore = covered.reduce((sum, s) => sum + (aleByScenario.get(s.scenario_id) ?? 0), 0);
    const reduction = efficacy[control.control_id];
    const annualCost = control.cost?.opex_annual ?? 0;

    if (covered.length === 0) {
      return { control_id: control.control_id, ranked: false, reason: 'no simulated scenario names this control' };
    }
    if (reduction === undefined || reduction === null) {
      return {
        control_id: control.control_id,
        ranked: false,
        ale_before: round(aleBefore),
        scenarios: covered.map((s) => s.scenario_id),
        reason:
          'no efficacy parameter. Nothing in the control or scenario schema records how much this ' +
          'control reduces loss, and inventing a figure is exactly what ADR-0004 forbids.',
      };
    }
    if (reduction < 0 || reduction > 1) {
      throw new Error(`${control.control_id}: efficacy ${reduction} is outside [0,1]. Above 1 would mean the control creates value out of the loss it prevents.`);
    }

    const aleAfter = aleBefore * (1 - reduction);
    return {
      control_id: control.control_id,
      scenarios: covered.map((s) => s.scenario_id),
      efficacy: reduction,
      ale_before: round(aleBefore),
      ale_after: round(aleAfter),
      ...rosi({ aleBefore, aleAfter, annualCost }),
    };
  });

  const ranked = rows.filter((r) => r.ranked).sort((a, b) => b.rosi - a.rosi);
  const unrankable = rows.filter((r) => !r.ranked);

  return {
    ranked,
    unrankable,
    note:
      unrankable.length === rows.length
        ? 'NOTHING IS RANKABLE. Every control is missing an efficacy parameter, an annual cost, or both. ' +
          'That is the accurate state of this inventory, not an engine failure — and it is the work list.'
        : undefined,
  };
}
