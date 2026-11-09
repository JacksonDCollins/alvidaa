# Public/personal branch reconciliation — no TV deployment

PR39's public follow-ups through `2314fc1` were merged into the personal deployment
branch after its deployed all-server release. No unfinished DOM work or historical
working-tree draft was merged. The public PR branch remains separate and unchanged.

## Overlap handled explicitly

The generic artwork-publication fix was extracted from behavior already in the
personal branch. Git's automatic merge inserted a second `renderableSnapshot`
definition even though only the publication call/export conflicts were marked.
Leaving the duplicate would override the personal authorization/poster handling.
It was removed: the personal worker remains byte-identical to its pre-merge code.
Its automatic-account status and credential-reader export are retained.

The imported generic test checks cache content equality rather than object identity
because the personal adapter copies/sanitizes its recommendation cache. Both the
public-only publication coverage and personal revocation coverage remain enabled.
The evidence-table conflict now links both the public retirement record and the
historical personal rollout evidence.

## Validation and release boundary

194 launcher tests passed with zero skips. Three packaging tests, repository checks
and diff checks passed. The merge adds documentation and generic regression tests;
production source is unchanged relative to personal commit `9988969`.

No TV connection, install, configuration change or power command was used for this
reconciliation. The last installed release remains `bf0000f` with retained journal
`release-lK4xvJ`, as recorded in [finding 28](28-plex-all-accessible-servers.md).
Git publication does not imply deployment.

## Future updates

1. Develop public launcher fixes without personal integration code; submit through
   the public branch/PR.
2. Merge public/upstream updates into `free-my-tv-plex`, resolving overlapping
   worker, package and evidence changes without dropping personal functionality.
3. Run the full combined tests and build a private ARM release from that branch.
4. Verify fresh TV ownership/state/space, then use the existing guarded coordinator.
   Preserve private settings, SSH, recovery journals and the 64 MiB reserve.
5. Record actual device acceptance and push combined source only to the fork.
   Firmware-derived archives stay local and are never published.

The public checkout, exact archived working state and unfinished DOM draft are
kept separately. Drafts are not considered tested deployment inputs.
