# Family isolation and rollout

Every account belongs to one access family (`family_groups`). This is separate from
surname/lineage tags (`families`) and the A/B sides within that family. A tag never
grants permission. “All” and “both” mean all/both sides of the selected family only.

## Joining and creating

- A valid family invitation creates an active member in the inviter's fixed access
  family and allowed sides. Submitted family IDs, admin flags, and extra sides are
  ignored. Expired invitations, invitations from disabled/moved members, and old
  invitations without an access family cannot be used.
- “Create my family” atomically creates an isolated family and its first family
  administrator. It does not grant global administration. Duplicate names/phones
  roll back the whole operation, including the new group.
- Registration without an invitation or a new-family name is rejected. Accounts
  cannot have a null family assignment in the database.

## Administration

Family administrators can correct records, manage members, set passwords through
the existing reset-link flow, and appoint other family administrators only in their
own family. They cannot move accounts between families, view unassigned records,
delete accounts and their historical cross-family data, change global settings,
or create global administrators.

The existing main/global administrator retains access to all administration. In
Admin → family access, select the family to view its content. This also scopes
images and downloads via a validated HttpOnly cookie. No content endpoint provides
an unfiltered all-family view. Global admins can change a member's family; doing so
revokes that member's sessions and presence. Family-owned historical content stays
in its original family. A moved account loses its former family-admin role; the main admin can explicitly
appoint it in the new family if appropriate. Global administration can also correct user roles and records.

## Existing data: explicit assignment required

Migration 016 deliberately does **not** infer access from names, sides, creator IDs,
or surname labels. Existing accounts are placed in a locked holding group; ordinary
members in that group cannot log in or read family content. Existing content has a
null access family and is invisible to ordinary/family-admin accounts. No family
records are deleted. The main administrator can still open administration.

Before reopening member access after syncing/deploying the reviewed Git revision:

1. Back up the production database and inspect the existing memberships. Do not
   overwrite deployment-specific migrations or data with a fresh database.
2. Main admin creates the actual access families (e.g. Bochner-Biderman and Parnes).
3. Assign existing members explicitly with the per-member Family selector.
4. Use “Assign old records” to review and assign the correct people, surname tags,
   linked yahrzeits, learning lists, directory entries, simchas, attachments and
   messages. Select linked records together; composite foreign keys reject a partial
   or cross-family graph. The operation is atomic and audited. The screen shows up
   to 500 unassigned records per type at a time; repeat for additional records.
5. Generate new family invitation links; legacy links are intentionally invalid.
6. Verify with ordinary accounts from each family: tree, directory/export,
   yahrzeits, learning, home, chat, files, and direct copied links. Keep ambiguous
   legacy records in the holding state until their audience is confirmed.

The new access policy is not proof that existing live assignments are correct.
This rollout requires explicit classification of the existing live data.

## Enforcement and tests

Request-local family context is derived from the current account, never a request
body. Only a global administrator can select a different family. Every non-account,
non-administration API defaults to requiring a family. Direct resource IDs and
submitted relationship IDs are checked before handlers; list queries include the
family predicate. Inserts receive a transaction-local server family default.
Composite foreign keys prevent cross-family parent/spouse, directory, memorial,
learning and attachment/reply references. API responses are private/no-store.

`test/family-isolation.test.mjs` exercises independent family creation, invite
assignment, privilege escalation attempts, forged family headers/body IDs, list and
home filtering, direct read/write attacks, chat/DM/attachment isolation, concurrent
request context, legacy assignment, main-admin corrections, reassignment and
revocation. Existing workflow integration tests use an explicitly assigned family.

## Duplicate-person gate (follow-up change)

The person form searches the people the member can already see, showing parents and
spouse and offering an existing record. The server normalizes name spacing,
punctuation and combining marks; it does not infer transliterations or merge records.
An exact normalized name match requires an explicit different-person confirmation
and explanation. A name match with the same recorded parent queues a review instead
of creating/updating a person. Family/main admins can approve a distinct person,
select an existing person (discarding the proposed changes), or reject. Stale edit
reviews cannot overwrite subsequent corrections.

Inline new relatives are checked too; when the name exists, select it or create a
confirmed different person separately. This avoids creating orphan relatives during
failed saves. Request keys and the existing transaction lock make retries and
simultaneous submissions idempotent. Audit/review records and candidate lists are
restricted to the current access family and the member's existing side visibility.
Members see only their own reviews; family admins see reviews in their family.
Existing duplicates are not automatically merged or removed.
