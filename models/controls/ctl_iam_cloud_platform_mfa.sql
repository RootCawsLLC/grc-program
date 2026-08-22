-- models/controls/ctl_iam_cloud_platform_mfa.sql
--
-- This model IS the evidence. The control record's query_ref points here, and the WHERE clause
-- below IS the population definition. Drift between this clause and the prose in
-- controls/ctl.iam.cloud-platform.mfa.yaml is a finding, and tests/ enforces the pairing.
--
-- What an auditor receives: this file, its dbt lineage, and the time series of its output.
-- Not a screenshot. Not a sample. A questionnaire asks a human to attest; a query asks a system
-- to prove.

{{ config(materialized='incremental', unique_key=['as_of','subject_id']) }}

select
    '{{ var("as_of") }}'::timestamp                                      as as_of,
    'ctl.iam.cloud-platform.mfa'                                         as control_id,
    p.account_id || ':' || p.principal_name                              as subject_id,

    (p.mfa_active and not p.has_long_lived_key)                          as passing,

    case
        when not p.mfa_active and p.is_root then 'root_without_mfa'
        when not p.mfa_active                then 'no_mfa_device'
        when p.has_long_lived_key            then 'long_lived_access_key_present'
    end                                                                  as reason,

    -- Source timestamp, not collection timestamp. This single column is the difference between
    -- a compliance dashboard and a risk instrument: it is what makes Variance Duration real
    -- rather than an artifact of how often we happened to look.
    coalesce(p.access_key_1_last_rotated, p.principal_created_at)        as first_observed,

    p.account_id                                                         as account_id

from {{ ref('stg_aws_iam_principals') }} p

where p.is_production_org                    -- production organisation only
  and (p.can_authenticate_interactively      -- humans and assumable roles
       or p.has_long_lived_key)              -- plus anything holding a static key
  and p.principal_status = 'active'

{% if is_incremental() %}
  and '{{ var("as_of") }}'::timestamp > (select max(as_of) from {{ this }})
{% endif %}
