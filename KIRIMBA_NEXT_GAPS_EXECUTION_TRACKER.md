# KIRIMBA_NEXT_GAPS_EXECUTION_TRACKER

## Sprint Execution Tracker
| # | Task | Objective | Primary Files/Areas | Dependencies | Est. Effort | Owner | Status | Exit Criteria |
|---|------|-----------|----------------------|--------------|-------------|-------|--------|---------------|
| 1 | Admin loan operations console | Enable disbursement/repayment/default oversight from admin UI | `apps/admin/src/features/*`, `functions/src/loans.js` call wiring | None | L (5-8d) | TBD | Not started | Admin can list pending/active/defaulted loans and trigger allowed actions with audit trail visible |
| 2 | Agent loan servicing screens | Operationalize loan disburse + repayment in field workflow | `apps/agent/src/features/*`, callable integrations | Task 1 (policy alignment) | M (3-5d) | TBD | Not started | Agent can disburse pending loans and record repayments with success/error handling |
| 3 | Member loan status/history screen | Give members visibility on loan lifecycle | `apps/member/src/features/Loans/*`, `getMemberLoans` integration | Task 1 | M (2-4d) | TBD | Not started | Member sees requested, active, repaid, defaulted states with amounts/dates |
| 4 | Group borrow-pause admin controls | Expose `adminSetGroupBorrowPause` in UI | `apps/admin` group/loan management areas | Task 1 | S-M (1-3d) | TBD | Not started | Admin can pause/unpause borrowing with reason; requestLoan respects state |
| 5 | Institution-scoped Umuco data model in UI | Restrict partner views/actions to institution-relevant groups/batches | `apps/umuco/src/features/Batches/*`, related filters/query params | Baseline identity mapping complete | M (3-5d) | TBD | Not started | Umuco user only sees actionable batches within authorized institution scope |
| 6 | Reconciliation -> settlement UI flow | Wire request/approve/paid settlement chain | `apps/agent`, `apps/admin`, `functions/src/reconciliation.js` integrations | Agent close-day flow stable | M-L (4-6d) | TBD | Not started | End-to-end settlement lifecycle executable via UI and traceable in records |
| 7 | Withdrawal governance workflow alignment | Ensure withdrawal lifecycle is complete and operator-safe | `apps/member` + `apps/admin` withdrawal screens, savings callables | Task 1 governance patterns | M (3-5d) | TBD | Not started | Withdrawal request, approval/rejection, and final state are consistent across roles |
| 8 | Financial exceptions dashboard | Centralize overdue/flagged/paused/reconciliation issues | `apps/admin` dashboard modules; potentially summary callable | Tasks 1, 4, 6 provide data sources | M (3-5d) | TBD | Not started | Admin has one screen for high-risk operational exceptions with drill-down |
| 9 | Legacy data normalization runbook + scripts | Reduce edge-case regressions from older docs | `scripts/*`, selected `functions/src/*` checks | None (can run in parallel) | S-M (2-4d) | TBD | Not started | One-off scripts complete; report shows corrected records and residual anomalies |
| 10 | Repeatable multi-role E2E suite (emulator + staging) | Protect stabilized flows from regression | `scripts/`, CI workflow, Playwright/emulator tests | Tasks 1-9 behaviors finalized enough for assertions | L (5-8d) | TBD | Not started | Automated suite covers member->leader->agent->admin->umuco critical lifecycle |

## Suggested Sprint Grouping
- Sprint A (stability + operations core): 1, 2, 3, 4
- Sprint B (institution + settlement + withdrawals): 5, 6, 7
- Sprint C (quality hardening + rollout safety): 8, 9, 10

## Status Legend
- `Not started`
- `In progress`
- `Blocked`
- `Ready for QA`
- `Done`

## Immediate Kickoff Order (this week)
1. Task 1
2. Task 4
3. Task 2
4. Task 3

Rationale: this sequence opens the full loan operations loop first, then extends safely to field/member surfaces.
