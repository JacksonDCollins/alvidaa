# Automatic Plex session following: implementation milestone, not deployment

Follow-up to [22: supervised session reuse](22-plex-session-reuse.md). The operator
requested the original Android Free My TV Plex behavior, with automatic following
of **only the TV app's active authenticated account**. This is not permission to
use another cached profile or to bypass Plex/native parental controls.

## Implemented and tested locally

- `native-plex-storage.cjs` reads the live Chromium LevelDB without opening it as a
  database, taking locks, repairing files, or writing anything. It follows CURRENT
  and the live manifest, checks CRC32C and Snappy bounds, resolves sequences and
  deletions, and rejects torn/changed reads. Only five session-related settings
  from the exact HTTPS Plex origin are decoded; other origins are not decoded.
- `native-plex-session.cjs` requires the active UUID and account token to match,
  then selects that user's server-scoped token for one explicitly approved server.
  Missing, malformed, ambiguous, signed-out or inaccessible state yields no
  credentials. A saved manual token is never a fallback in automatic mode.
- The worker checks session changes independently of context parsing. It cancels
  the old client and image owner before rebuilding; even a damaged context cannot
  retain the old account's recommendations. Startup strips persisted personal
  picks before discovery. Late image callbacks cannot revive a cancelled owner.
- Unchanged files use stat-only checks. Changed WALs reuse bounded, unchanged live
  table records, retaining copies of required Plex values rather than whole raw
  shared tables. Stop/error paths release caches.
- Both new runtime dependencies are included in packaging and release verification.

The full launcher suite passed **166 tests, zero skips**, plus **three packaging
tests**. New synthetic tests cover active-account selection, missing access,
logout tombstones, obsolete tables, origin isolation, malformed/checksum-invalid
journals, incomplete fragments, Snappy bounds, symlinks, cached-table reuse, startup
redaction and worker account changes during context errors.

## Read-only TV evidence

The server's verified HTTPS `/identity` response matched the cached server's
map key, `id` and `identifier`. The production session selector returned `ready`
and selected the same server-scoped token previously validated in finding 22.
No token or identifier was printed. Initial discovery measured 543 ms; an
unchanged session poll measured 2 ms. The hardened reader was rechecked on the
TV after adding table caching: a full scan took 521 ms / 1,071,275 bytes, versus
40 ms / 363,234 bytes for a repeated scan reusing unchanged tables. Selection
still returned `ready`. These are discovery measurements, **not an explanation
of Plex or Netflix application lag**.

An automatic-mode server binding was staged locally under `server/keys/` with
mode 0600. It contains the approved origin and server identity, not a token.
No TV credential, startup, launcher, preferences or database file was changed.
The existing Home remains the earlier Settings-backdrop release.

## Original-behavior comparison still in progress

The reference remains canonical Android `Recs.java` at
`ed6be1ecaa98804c383fa021cdb648fd80f061f3`, not the web adaptation. Additional gaps
were identified: title-specific navigation, portrait poster handling, and the
original six-hour/day-period refresh behavior. The current adapter is therefore
**not yet exact functional parity**.

Public Plex VIDAA source inspection found a launch-URI handler accepting
`ratingKey` and `providerId`; autoplay requires an explicit `1`. Its session
storage removes `PlexAuthToken` when cleared, and its offline-user deletion path
removes `LastActiveUserUuid` plus the cached user/server maps. These observations
support the implementation design but do not prove title navigation on the TV.
Sources: [VIDAA configuration](https://app.plex.tv/tv-vidaa/getAppConfig_ts.js),
[shared adapter bundle](https://app.plex.tv/tv-vidaa/packages_app_adapters_appStore_appSettingItems_ts-packages_app_adapters_input_KeyHandler_ts-p-1bce80.js),
[application bundle](https://app.plex.tv/tv-vidaa/packages_app_index_ts-packages_app_images_activityBlur_blur_activity_feed_png-packages_app_im-491552.js).
These are mutable public application URLs, not pinned vendor artifacts in this repo.

## Remaining acceptance and safeguards

Automatic following is **not installed or enabled on the TV**. Actual sign-out,
account switching, integrated card rendering, title navigation without playback,
disable/removal and rollback remain untested in deployed Home. File observation
is polling-based, not synchronous with Plex's in-memory authentication state.

Legacy reverse-shell retirement and preservation-first storage preparation still
block deployment. Preserve SSH, current preferences, recovery history and the
64 MiB reserve; use the existing guarded release coordinator. Do not treat local
tests or the read-only selector probe as completion of those prerequisites.
