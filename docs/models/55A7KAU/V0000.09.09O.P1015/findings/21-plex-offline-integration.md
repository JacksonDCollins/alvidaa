# 21 — Personal Plex integration: offline implementation

## Scope and provenance

The installed launcher derives from the pinned `felipericardo/tv-launcher` web
adaptation, not the complete original Android Free My TV application. Its web
sources do not implement the original project's personal Plex integration.
Updating that web snapshot alone would not add it.

The new opt-in worker module adapts canonical Free My TV's `Recs.java` at
`ed6be1ecaa98804c383fa021cdb648fd80f061f3`: bounded recent library selection,
one candidate per movie/show kind, negative IDs, Plex branding and private
artwork retrieval. Build-time frontend adaptations recognize the native Plex
app and mix those candidates into the existing tabs/screensaver. Pristine web
sources remain unchanged.

See [Plex setup, limitations and teardown](../../../../../tools/launcher-host/NATIVE-PLEX.md).

## Offline evidence

- Transport fixtures cover private-LAN DNS, verified HTTPS options, header-only
  credentials, rejected redirects, oversized/credential-bearing responses,
  cancellation and retry backoff.
- Actual adapted web data code supports Plex without TMDB, keeps at most one
  Plex pick per tab and localizes runtime/season metadata.
- Image-helper tests exercise authenticated-client routing and verified raw-image
  cache reuse. Personal cards are withheld until local artwork is available.
- Worker recreation/disconnection strips persisted personal picks; no Plex
  requests occur without its installed app in the native app list.
- Package verification caught a missing entry in the explicit runtime packaging
  list after the new dependency was required. Adding `native-feed-plex.cjs` to
  that list fixed the package regression.

The offline run passed 157 Node tests (zero skips) and three package tests.
No Plex credentials were provisioned, no server was contacted, and no TV files
or preferences were changed during this implementation.

## Unproven / deployment prerequisites

Real-server certificates, DNS, library permissions, on-TV artwork and native
Plex app launch still require acceptance. Cards currently launch the app only;
there is no verified VIDAA title deep link or Continue Watching implementation.
The legacy reverse-shell startup must be retired through a guarded change before
adding personal credentials. Storage must be rechecked without lowering the
64 MiB reserve or discarding recovery history. The installed Home remains the
previous Settings-backdrop build, not this new integration.

## Read-only follow-up: reusing the TV's Plex login

The operator requested a one-time import from the already logged-in Plex TV app
instead of supplying a separate server login. Native context identifies Plex as
`app:42`. Plex-origin records exist in the app browser's Chromium localStorage
under `/var/local/webengine/odin_home_browser/Normal/Local Storage/leveldb`,
separate from the Cobalt Home storage. Never clear or rewrite that shared database.

A bounded, on-TV, read-only WAL probe filtered records by Plex origin before
examining values and printed only counts/presence flags. The current 1,110-byte
WAL contained three Plex records and one nondeleted key, but no recognized token
or secure-server URL. This is **not proof that credentials are absent**: older
compacted tables were not examined. No credential values were printed or copied.
Only the Home browser executable was running during the process check; no Plex
browser session or existing remote-debugging flag was observed. Reuse of the
actual logged-in session remains unverified. No app navigation or storage writes
were performed by these probes.
