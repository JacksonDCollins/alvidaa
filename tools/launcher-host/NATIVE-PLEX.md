# Plex recommendations: canonical behavior, automatic TV credentials

The scope is the Plex library behavior from Android Free My TV's
[`Recs.java`](https://github.com/simbasjungles/free-my-tv/blob/ed6be1ecaa98804c383fa021cdb648fd80f061f3/app/src/io/freemytv/Recs.java),
with credentials obtained from the logged-in native Plex app instead of supplied
URL/token fields. This is not a port of every Android feature.

The narrowed implementation is installed. App-derived connections, artwork
preparation, publication, disable/restoration and Home rendering passed live checks;
see [deployment evidence](../../docs/models/55A7KAU/V0000.09.09O.P1015/findings/26-plex-app-connections-deployed.md).
Its offline comparison and deterministic package are recorded in
[scope correction evidence](../../docs/models/55A7KAU/V0000.09.09O.P1015/findings/25-plex-scope-correction.md).
Earlier deployed acceptance is recorded in
[finding 24](../../docs/models/55A7KAU/V0000.09.09O.P1015/findings/24-plex-parity-and-safe-rollout.md).

## Recommendation behavior

- Use the existing recommendation-list refresh, including its six-hour interval,
  morning/afternoon/night periods, language/source changes and clock rollback.
  There is no independent Plex metadata-refresh loop.
- Select one of the newest eight library movies and shows, in section order,
  using the hour as the selection seed.
- Prepare artwork before adding a personal pick. Interleave each kind into the
  trending titles, alternate kinds, then fill with new releases up to 24 titles.
- Show at most one personal Plex surprise per tab, not a guaranteed card each hour.
- Use one 1920×1080 backdrop and an optional 500×750 portrait poster. Without a
  poster, use the backdrop; without usable backdrop artwork, omit that pick.
- Open the title's details, not playback. On VIDAA this uses the registered Plex
  app and native APC permission checks rather than an Android intent. Plex's own
  profile chooser and protections remain intact.
- Require the existing TMDB configuration, as the reference implementation does.
  The added Plex-only mode has been removed.

There is no Continue Watching, watch-progress integration or separate Plex service.
The existing on-TV feed worker performs the background work that Android performs
inside its app. Pinned web source files remain pristine; narrow adapters connect
that presentation to the Plex logic and VIDAA platform.

## Automatic credential adapter

The existing private `server/keys/` feed configuration enables `plex_auto: true`
and records the approved `plex_server_id`. Keep `tmdb_token` unchanged. Do not
supply a Plex URL/token: legacy `plex_url` and `plex_token` overrides are ignored.
The server identity is a selection boundary, not an account credential. Existing
deployments should retain legacy private fields for rollback to older code; the
new code ignores them. Do not remove fields an older installed release requires.

A bounded, read-only reader follows the native app's active authenticated user and
that user's server-access record. Only that user's server-scoped token and the
approved server's advertised HTTPS `*.plex.direct` connections are candidates.
The adapter tries those connections, verifies the expected server identity, and
reuses the successful connection. Like the original, remote Plex addresses are
permitted; there is no added private-IP restriction.

TLS certificate verification remains enabled. Tokens travel only in headers,
redirects are rejected, and request/file/image budgets remain bounded. Tokens,
authenticated URLs and account fingerprints never enter the launcher snapshot.
No other cached profile, manual URL or manual token is a fallback. No server
configuration, app storage, login or PIN is changed by the adapter.

On account changes, logout or uncertain storage reads, old personal recommendations
are revoked. Published artwork mappings must belong to current picks; only their
reachable media and native app icons are published. Polling is not synchronous
with Plex's in-memory authentication. Retained artwork files are ordinary cache,
not secure erasure and not authorization for a new session.

## Disable and recovery

Set `plex_auto: false` and restart through the existing owned-worker controller.
Leave TMDB, preferences and native app data untouched. Code rollback uses the
normal release coordinator and retained recovery journals; do not bypass its
concurrency checks or lower the storage reserve.

No Plex-server change is required or authorized for this integration. The earlier
private rollback record for a proposed advertisement edit was never applied.

## Verification boundary

Tests cover active-account selection, app-only connection fallback, TLS/header/
redirect boundaries, canonical list scheduling, artwork preparation and sharing,
revocation, malformed state, late callbacks and package completeness. The new
connection path passed a real-TV probe with the configured URL/token overrides
removed in memory: movie/show metadata, original artwork and a poster succeeded
using only app-provided connections.

Previously deployed logout/login, card rendering, movie details, disable and
rollback passed. Native profile switching hung during the operator's attempt and
remains unverified; its cause is not established. On the narrower release, current
hourly rotation selected no personal card in any tab, so a displayed personal
portrait and card-to-details click have not yet been retested. Earlier results
are not silently promoted to fresh acceptance.
