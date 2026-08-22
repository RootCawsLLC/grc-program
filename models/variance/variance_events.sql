-- models/variance/variance_events.sql
--
-- The four timestamps. This is the piece almost nobody emits, and it is the entire reason the
-- pipeline is worth building twice over: it is simultaneously the audit trail and the input to
-- Loss Event Frequency.
--
-- started -> detected            = Control Monitoring        -> fix is cadence or coverage
-- detected -> remediation_started = Treatment Selection       -> fix is prioritisation or ownership
-- remediation_started -> completed = Implementation           -> fix is capacity or tooling
--
-- Without the decomposition you learn that mean time to remediate is 30 days. With it you learn
-- that 26 of those 30 days were detection latency, and that "remediate faster" was the wrong
-- instruction all along.

with state_changes as (
    select
        control_id,
        subject_id,
        as_of,
        passing,
        first_observed,
        lag(passing) over (partition by control_id, subject_id order by as_of) as prev_passing
    from {{ ref('control_assertions_unioned') }}
),

variance_started as (
    select control_id, subject_id, as_of as detected_at,
           -- Quality ladder, best first:
           --   (a) source system's own change timestamp  -> source-timestamp
           --   (b) previous passing snapshot             -> interpolated, bounded by collect interval
           --   (c) detection time itself                 -> equals-detected, UNDERSTATES duration
           -- (c) is legal but must be declared on the control record, and any efficacy derived
           -- from it is labelled an upper bound rather than an estimate.
           coalesce(
             first_observed,
             lag(as_of) over (partition by control_id, subject_id order by as_of),
             as_of
           ) as started_at,
           case
             when first_observed is not null then 'source-timestamp'
             when lag(as_of) over (partition by control_id, subject_id order by as_of) is not null then 'interpolated'
             else 'equals-detected'
           end as started_at_quality
    from state_changes
    where prev_passing = true and passing = false      -- the transition into variance
),

variance_ended as (
    select control_id, subject_id, as_of as remediation_completed_at
    from state_changes
    where prev_passing = false and passing = true      -- the transition back
)

select
    s.control_id,
    s.subject_id,
    s.started_at                                                   as variance_started_at,
    s.detected_at                                                  as variance_detected_at,
    t.first_touched_at                                             as remediation_started_at,
    e.remediation_completed_at,
    s.started_at_quality,
    date_diff('day', s.started_at, e.remediation_completed_at)      as duration_days,
    date_diff('day', s.started_at, s.detected_at)                   as detection_latency_days,
    e.remediation_completed_at is null                              as still_open

from variance_started s
left join variance_ended e
  on  e.control_id = s.control_id
  and e.subject_id = s.subject_id
  and e.remediation_completed_at > s.detected_at
-- remediation_started_at comes from the ticketing system: the moment a human first touched it.
-- Without this join the middle segment collapses and prioritisation failures hide inside
-- implementation failures.
left join {{ ref('stg_ticket_first_touch') }} t
  on  t.control_id = s.control_id
  and t.subject_id = s.subject_id
  and t.first_touched_at between s.detected_at and coalesce(e.remediation_completed_at, now())
