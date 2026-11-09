# All accessible personal Plex servers

The operator approved combining all personal servers accessible to the logged-in
stock Plex user. No Plex app was added or replaced. This intentionally extends the
original single-server Free My TV integration; it is not exact original behavior.

## Implementation

- Read only the active authenticated user's server-access records. Collect every
  usable personal-server identity, its scoped token and secure app-advertised
  connection candidates. No configured server pin, other-profile fallback or
  pinned-library ordering. The storage reader no longer retains pinned sources.
- Query up to eight newest entries in every eligible section, combine by `addedAt`,
  and retain the newest eight per kind globally. The existing hourly seed chooses
  one movie and one show overall. Missing dates sort last with stable identity/key
  tie ordering. Repeated server-local keys are deduplicated, but different server
  copies remain distinct.
- Four server clients run concurrently under a shared 30-second metadata deadline,
  with a 64-server input bound. Timed-out/unfinished/unstarted servers contribute
  nothing that round; healthy results survive. The canonical list refresh remains
  the only scheduler.
- Browser IDs are negative safe-integer hashes of server/kind/rating key. Artwork
  references include server identity and are routed to the exact selected client.
  Details retain the original server identifier and rating key. Tokens are never
  copied between clients or published.
- Account, token or server-membership changes invalidate the session fingerprint.
  Stop cancels every client and clears publication; late results cannot revive it.
  All unavailable servers produce no personal recommendations.

## Validation

Offline tests exercise overlapping rating keys, newest-eight aggregation, stable
rotation, cloud/provider exclusion, active-profile credentials, unusable records,
failed peers, global timeout, stop/late completion, artwork-owner routing, and the
real worker/engine/image processor pipeline. A transport fixture confirms that a
newer title from a later library section participates in global selection.

A read-only in-memory run on the TV found **one** accessible personal server. It
returned ready with one movie and one show, correctly scoped title targets, a
269,589-byte original backdrop and a 35,498-byte poster. This validates the new
aggregation path on real transport, not a physical multiple-server setup.

## Guarded deployment and live acceptance

191 launcher tests, three packaging tests, repository checks and diff checks passed.
LSP returned no error diagnostics, with two confirmed-clean files and three
inconclusive checks. Two private ARM package builds were byte-identical and passed
the bundled release verifier.

- Code `bf0000f`; private archive `firmware/55a7kau-09.09o/plex-bf0000f.tar.gz`,
  26,014,426 bytes, SHA256
  `699cb96d97e5488e665cda89e28e692f4ae248ceed534fd86950cfaad0695686`.
- Stage `/APPS/alvidaa-plex-release-699cb96d97e5`.
- Retained journal `web-releases/release-lK4xvJ`, phase installed.
- Home remains `470e8cac2970ecfba71d5bc10a160d0556e60c7a05aacaf57edc3b4699cdcce9`.

Fresh preflight checked Home/bootstrap/config/preferences and the owned worker.
Only runtime bytes were transferred; 1,728 existing assets were individually
verified and hard-linked. The controller verified 1,808 manifest entries and
applied through the usual lock/recovery/reserve machinery.

The deployed worker reached ready with 24 candidates, two personal picks, both
prepared portraits, ten private artwork mappings, 47 native icons, no pending work
and zero image failures. Title targets matched accessible server identities.
Home/bootstrap/preferences/configuration remained byte-identical. Observed free
space after apply was 88,698,880 bytes, above the unchanged 64 MiB reserve.

Guarded disable removed both picks and every private mapping while retaining all
47 icons. Re-enable restored them and the exact original private configuration.
A final screenshot confirmed Home rendering; it is not a personal-card click test.
No Plex-server settings, native app storage, authentication or playback were
modified. Multiple physical servers and native profile switching remain untested;
those combinations are offline fixtures, not claimed real-device acceptance.
