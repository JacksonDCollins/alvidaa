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
