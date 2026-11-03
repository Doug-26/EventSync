# EventSync architecture index

This index is not the full contract. Do not implement from this file alone; follow the artifact paths below.

## Implementation Guide

### Global artifacts

- `unit_graph.yaml`: all units read their trigger, source anchors, dependencies, and dynamic entrypoints.
- `wire_contracts.yaml`: filter by `unit`; preserve frozen REST and SQL shapes.
- `shared_modules.yaml`: filter `used_by_units` to find shared frontend/API infrastructure.
- `cross_unit_state.yaml`: filter writer/reader units; runtime-confirm rows marked `must_confirm: runtime`.
- `migration_boundary.yaml`: analysis-only scope; do not infer rewrite tasks from source anchors.

### Units

Each unit has `units/<name>/behavior.yaml`, `bindings.yaml`, and `unit_decomposition.yaml`. Read behavior for observable outcomes, bindings for route/config wiring, and decomposition only for advisory split candidates. Completion evidence must name artifacts read, preserved contracts, unresolved items, and build/runtime evidence.

Units: `dashboard-page`, `public-rsvp-page`, `auth-api`, `events-api`, `event-types-api`, `invite-links-api`, `public-rsvp-api`, `organizer-rsvp-api`, `uploads-api`, and `health-endpoints`.
