# Native-account server selection without a configured pin

The operator requested removal of the configured approved-server restriction.
`plex_auto: true` now suffices: legacy server ID, URL and token overrides are ignored.
The exact existing private configuration is retained for backward rollback only.

## Read-only discovery

The app stores personal servers as `type: pms` alongside cloud providers. Server
access tokens are scoped by active-user UUID. It also stores `<uuid>-PinnedSources`,
an ordered array with `serverId`, `providerId`, `hidden` and library metadata.
The prefix was confirmed to match the app's user UUID. `LastSession` contains
session/timing/playback counters, not a selected-server field.

The selector follows the first visible pinned personal library accessible to the
active authenticated user. If there is only one accessible personal server it
needs no pinned preference. With several servers and no usable native preference,
it reports unavailable rather than choosing by cached object order. This is a
native-library-order policy, not proof of following live navigation between servers.
No other cached user's pins or token can supply fallback authorization.

Changing the selected server changes the private session fingerprint, so existing
worker revocation/reconstruction also applies to server changes. Transport still
checks the server identity learned from the app, not a configured allowlist.

The bounded LevelDB reader now retains UUID-scoped pinned-source records in addition
to its previous keys; unrelated origins and account data remain excluded. No app
storage, server preferences or login was modified by discovery.

## Validation

184 launcher tests passed, including automatic sole-server selection, native
source ordering, hidden sources, changed-server fingerprints, another user's pins,
malformed records and reading pinned sources through real LevelDB fixture tables.
A read-only in-memory run on the TV returned ready with two app-derived connections
using only `plex_auto: true`, with no configured server identity.

## Guarded deployment

Code `48f4ea4` was packaged twice with identical bytes and verified using the
archive's bundled controller. Three packaging tests and repository checks passed.
LSP reported no errors, with two files confirmed clean and two inconclusive.

- Archive `firmware/55a7kau-09.09o/plex-48f4ea4.tar.gz`, 26,013,776 bytes.
- SHA256 `3b067fb1a94c03df868b01e1e0b4911fcddade078db3c4d78e00cde420523ddc`.
- Stage `/APPS/alvidaa-plex-release-3b067fb1a94c`.
- Retained recovery journal `web-releases/release-OYQB0s`, phase installed.
- Home hash unchanged: `470e8cac2970ecfba71d5bc10a160d0556e60c7a05aacaf57edc3b4699cdcce9`.

Apply used the guarded coordinator and individually verified existing assets.
The installed selector returned ready using only `plex_auto: true`. The production
worker returned ready with two personal candidates, ten artwork mappings, 47 native
icon aliases, no pending work and zero image failures. Home, bootstrap, preferences
and private configuration hashes remained unchanged. Free space was 93,040,640 bytes,
above the retained 64 MiB reserve. No Plex-server change was made.

Multi-server switching is fixture-tested, not a completed physical multi-server or
native-profile-switch acceptance test. Fresh card-click/portrait acceptance remains
as bounded in [finding 26](26-plex-app-connections-deployed.md).
