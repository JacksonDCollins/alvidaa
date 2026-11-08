# Plex scope correction — TV-side only

The operator requested the canonical Android Free My TV Plex behavior, with only
URL/token discovery adapted to the native TV app. Plex-server changes are expressly
prohibited. Earlier server inspection was read-only; a private rollback record was
prepared but **no server setting was changed**. No restart was performed.

## The connection problem was in our adapter

The TV app already advertises secure connections to the approved server. A bounded,
credential-free `/identity` probe from the TV, with normal certificate verification
and no redirects, found:

- the app's cached local `plex.direct` connection timed out;
- its other advertised `plex.direct` connection returned HTTP 200 and the expected
  server identity;
- its custom HTTPS connection also returned that identity, but is not needed for
  the canonical `plex.direct` transport.

Our extra private-IP restriction had excluded the working connection. The original
Android implementation requires verified HTTPS `*.plex.direct`, but does not require
private DNS addresses. Correcting the TV adapter does not require changing Plex's
server advertisement. Connection addresses and tokens are not recorded here.

A separate inspection trap: the server's preferences-file `MachineIdentifier` was
not equal to its API identity. The `/identity` response matched the approved app
server identifier. No identities or owner tokens were published.

## Narrowed implementation (local, not yet deployed)

- Automatic selection takes HTTPS `plex.direct` URLs and the selected user's
  server-scoped token from the app's own stored server/access records. The old
  configured URL is ignored; the approved server identity remains the selection
  boundary. No other account or arbitrary server is used as fallback.
- The connection adapter tries only those advertised secure endpoints and verifies
  the expected server identity. It reuses the successful connection within that
  client. Normal TLS, header-only tokens, redirect rejection and resource bounds
  remain.
- Plex joins the existing recommendation-list refresh, rather than running a
  separate six-hour timer/retry schedule. The pinned list logic owns refresh
  decisions, including time period, language, source changes and backward clocks.
- The added Plex-only mode and legacy manual-credential route are removed. As in
  the reference Android implementation, recommendations require TMDB configuration.
- Artwork is prepared before personal picks enter the list. One 1920×1080 original
  serves backdrop sizes; narrow cards use a 500×750 poster with backdrop fallback.
  Preparation and ordinary image updates share the existing serialized pipeline.
- Native VIDAA launching, localization, bounded transport and account revocation
  remain platform/credential adapters, not additional recommendation features.

Reference: `Recs.java` at `ed6be1ecaa98804c383fa021cdb648fd80f061f3`.
The pinned web sources remain unchanged. This does not claim that the entire VIDAA
launcher is identical to the Android app, or add Trakt/Continue Watching.

## Read-only real-TV probe

The new selector and transport were executed in memory on the TV, without replacing
installed files. The configured URL/token overrides were removed from the input.
Only the app's two advertised canonical secure connections were used; movie/show
metadata and two raster downloads succeeded. The original backdrop was 271,130
bytes and the poster 59,410 bytes. Every request verified TLS, no token appeared
in a URL, and the separately configured LAN override was not used.

## Offline completion after the TV was switched off

The operator then requested further work without TV validation. No further TV/NAS
access was made. Offline refinements preserve a committed current-session list
while it refreshes, but still strip startup cache and revoke it on lost access.
The original movie-before-show failure ordering and hour selection are covered.

Tests caught a remaining selector call to the removed manual-configuration helper;
it was replaced with a shared header-safe token validator. Another test initially
mistook persisted startup cache for a committed authenticated list; startup correctly
removed it, so the refresh-retention assertion now exercises an actual completed
list fetch. No production manual URL/token configuration route remains.

All **182 launcher tests**, three packaging tests, repository checks and diff checks
passed. LSP returned no error diagnostics but could not confirm six source files
clean (silent push-only server); it is not recorded as a clean LSP sweep.

The TV remains on the previously accepted build documented in
[finding 24](24-plex-parity-and-safe-rollout.md). Final release deployment and UI,
account-switch, boot and performance acceptance remain unverified. Retain the old
private configuration unchanged so a rollback to the earlier release still works.
PR39 was rechecked: open, cleanly mergeable, and still the post-PR29 branch—not this
Plex branch. No Plex publication or deployment is implied by these offline checks.
