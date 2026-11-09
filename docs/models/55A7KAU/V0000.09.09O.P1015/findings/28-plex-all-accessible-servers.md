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

No Plex-server settings, native app storage, authentication or playback were
modified. Deployment evidence will distinguish the single-server live environment
from multi-server offline fixtures.
