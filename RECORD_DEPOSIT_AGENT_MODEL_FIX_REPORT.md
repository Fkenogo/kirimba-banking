# RECORD_DEPOSIT_AGENT_MODEL_FIX_REPORT

## Root cause

`recordDeposit` was failing on members whose group linkage existed on `users/{uid}` but not on `groupMembers/{uid}`.

The deposit path called `getActiveMemberAndGroup(userId)`, and that helper previously hard-failed if `groupMembers/{uid}` did not exist at all, before considering any fallback on the user profile. That produced the error:

`User is not linked to a group.`

## Was `assignedGroups` part of the failure path?

Yes.

`recordDeposit` also loaded `agents/{agentId}` inside its Firestore transaction and enforced that:

1. `assignedGroups` was non-empty
2. the member's resolved `groupId` was included in `assignedGroups`

That was a second legacy restriction in the active failure path. It was not the source of the specific screenshot message, but it would still block valid deposits whenever the agent was active but not explicitly assigned to the member's group.

## Exact old resolution logic

Old member/group resolution in `functions/src/savings.js`:

1. Load `users/{uid}`
2. Load `groupMembers/{uid}`
3. If `groupMembers/{uid}` does not exist, throw `User is not linked to a group.`
4. Resolve `groupId` as:
   - `groupMembers/{uid}.groupId`
   - else `users/{uid}.groupId`
5. If still missing, throw `Member has no group.`
6. Load `groups/{groupId}` and require the group to exist and be active

Old agent validation in `recordDeposit`:

1. Load `agents/{agentId}`
2. Require the document to exist
3. Read `assignedGroups`
4. If `assignedGroups` is empty, reject
5. If the member's group is not in `assignedGroups`, reject

## Exact new resolution logic

New member/group resolution in `functions/src/savings.js`:

1. Load `users/{uid}`
2. Load `groupMembers/{uid}`
3. Require `users/{uid}` to exist
4. Require `users/{uid}.status === active`
5. Resolve `groupId` in this order:
   - `groupMembers/{uid}.groupId` if present
   - else `users/{uid}.groupId` if present
   - else `users/{uid}.ledGroupId` if present
6. If no value is found, throw `User is not linked to a group.`
7. Load `groups/{groupId}` and require the group to exist and be active

New agent validation in `recordDeposit`:

1. Load `agents/{agentId}`
2. Require the document to exist
3. Require `agents/{agentId}.role === agent`
4. Require `agents/{agentId}.status === active`
5. Do not require any `assignedGroups` match for deposit capture

## Files changed

- `functions/src/savings.js`
- `RECORD_DEPOSIT_AGENT_MODEL_FIX_REPORT.md`

## Final deposit eligibility rule

An agent can record a deposit when all of the following are true:

1. the caller is authenticated as an agent
2. the caller has an active `agents/{agentId}` profile
3. the target member's `users/{uid}` profile exists and is active
4. the member resolves to a valid group using:
   - `groupMembers/{uid}.groupId`
   - else `users/{uid}.groupId`
   - else `users/{uid}.ledGroupId`
5. the resolved `groups/{groupId}` document exists and is active
6. if the client sends `groupId`, it must match the resolved member group
7. the member has a wallet
8. there is no existing pending deposit awaiting confirmation for that member

Deposits are no longer blocked by legacy agent-to-group assignment requirements in `assignedGroups`.
