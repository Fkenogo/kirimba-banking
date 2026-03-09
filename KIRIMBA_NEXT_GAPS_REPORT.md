# KIRIMBA_NEXT_GAPS_REPORT

## 1. What is now working reliably
- Member self-registration and login with phone + 6-digit PIN are functioning.
- Admin pending approvals pipeline is operational for members and groups.
- Institution selection (member-side) is live and enforced before group join/create.
- Group request and approval flow works; approved creator becomes leader in member app.
- Leader modules are separated and reachable: group code, manage group, pending requests, split.
- Join-by-code now creates pending requests (no immediate membership).
- Leader approve/reject join-request flow is live.
- Pending request identity display is improved and no longer relies on raw UID as primary display.
- Partner institution batch confirmation UI exists (`/umuco/batches`, `/umuco/batch/:id`, `/umuco/history`).
- Core provisioning endpoints for admin/agent/institution users exist and are wired in admin UI.

## 2. What is still partially implemented
- Loan lifecycle is only partially operational in UI: members can request loans, but there is no admin/agent operational UI for disbursement, repayment control, delinquency oversight, or collateral release decisions.
- Umuco batch UI is functionally present but not institution-scoped; screens iterate all groups and call per-group lookups, which is fragile for scale and role isolation.
- Agent operations are deposit-heavy; full operational breadth (loan servicing, withdrawal operations approval visibility, settlement workflows) is not fully surfaced in app UX.
- Financial governance controls exist in backend (borrow pause, settlements, ledgers) but are not exposed coherently in admin workflows.
- Request/approval notifications are present in backend but not a consistent user-facing notification center across apps.
- Legacy data handling remains mixed (older docs may miss newly required fields), so behavior is stable for new records but can vary for old records.

## 3. What is still untested end-to-end
- Full financial chain under realistic sequence: deposit confirmed -> wallet credit -> loan request -> disbursement -> repayment -> default path -> exposure counters.
- Group exposure cap behavior under concurrent requests and multi-loan scenarios.
- Borrow pause + overdue auto-default interplay and UI/operator response.
- Agent close-day -> admin reconciliation -> settlement request/approval/payment chain.
- Institution confirmation edge paths (flagged batch, corrected re-submission, replay/idempotency checks).
- Multi-role token refresh transitions after role/status changes (especially around leader promotion and cross-app sign-ins).
- Recovery/backfill behavior for pre-fix legacy users/groups/joinRequests at scale.

## 4. Highest-priority gaps for MVP readiness
- Missing operator UI for post-loan-request operations is the biggest product readiness gap.
- Financial control plane is fragmented: critical backend controls are not exposed in a single admin operations surface.
- Institution-facing flow lacks proper institution scoping and scalable query strategy.
- End-to-end financial integrity tests are not formalized/automated; current confidence is mostly path-based and manual.
- Reconciliation and settlement flows are backend-ready but underutilized in product workflow.
- Legacy-data normalization is incomplete, leaving risk of edge-case regressions during rollout.

## 5. Recommended next 10 implementation tasks in order
1. Build loan operations console in admin app.
- Objective: enable disburse/repay/default oversight from UI.
- Include pending loan queue, active loans list, per-loan action controls, and audit notes.

2. Add agent loan servicing screens.
- Objective: operationalize `disburseLoan` and `recordRepayment` for field operations with safe validations.

3. Add member loan status/history screen.
- Objective: members see requested/active/repaid/defaulted loans and repayment state without support intervention.

4. Add admin borrow-control UI for groups.
- Objective: expose `adminSetGroupBorrowPause` with reason and current pause state.

5. Institution-scope Umuco batch data access.
- Objective: stop all-groups fan-out queries; filter strictly to institution-eligible groups/batches.

6. Implement reconciliation-to-settlement UI flow.
- Objective: wire `requestSettlement`, `approveSettlement`, `markSettlementPaid` into admin/agent operations.

7. Add withdrawal governance workflow clarity.
- Objective: align withdrawal request lifecycle in UI with backend states and approval/recording paths.

8. Add financial exception dashboard.
- Objective: surface overdue loans, flagged batches, failed reconciliations, paused groups in one admin panel.

9. Run and script legacy backfills + data integrity checks.
- Objective: normalize old records (identity fields, group linkage, counters) before broader rollout.

10. Create repeatable emulator + staging E2E test suite for multi-role lifecycle.
- Objective: prevent regressions across member/leader/agent/admin/umuco flows before each deployment.

## 6. Risks if we skip those tasks
- Loan operations will stall after request stage, creating real-world process breakage.
- Financial controls will remain backend-only, increasing manual intervention and operator mistakes.
- Institution operations may degrade quickly with scale and risk data-leak style overexposure.
- Reconciliation and settlement gaps can produce unresolved cash movement discrepancies.
- Legacy data edge cases will keep surfacing as production "random" failures.
- Without E2E test coverage, each new fix risks re-breaking previously stabilized flows.
