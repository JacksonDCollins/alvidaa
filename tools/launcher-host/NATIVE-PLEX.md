# Plex library recommendations on VIDAA

Status: implemented and tested offline; **not yet provisioned or validated against
the operator's Plex server or deployed to the TV**.

This is an opt-in extension to the existing native web port. It adapts the Plex
library logic from [canonical Free My TV `Recs.java`](https://github.com/simbasjungles/free-my-tv/blob/ed6be1ecaa98804c383fa021cdb648fd80f061f3/app/src/io/freemytv/Recs.java),
not merely the Plex app icon. The pinned web frontend remains unchanged on disk;
its build-time adapters add personal picks and recognize the installed Plex app.
The original MIT notice is retained in [LICENSE](third-party/free-my-tv/LICENSE).

## What it does

- Reads movie and show library sections, taking up to eight recent items of each
  kind in section order, like upstream. One movie and one show are selected using
  the hour as the rotation seed and mixed into the public recommendation pool.
- Shows at most one personal Plex pick per tab selection. The existing upstream
  selection logic determines which candidates are visible at a given time.
- Retrieves artwork through the private worker and existing bounded image cache.
  Personal cards wait until local artwork is available; the browser never fetches
  an authenticated Plex URL. Localized metadata uses the existing UI translators.
- Works with an explicitly empty TMDB token as a Plex-only recommendation source.
- Uses the existing native app lookup and guarded APC launch path. Selecting a
  card currently opens the **Plex app**, not a verified title-specific page.

It does not sign the TV's Plex app into an account, import watch progress, or
implement Continue Watching. Those are separate features. The TV app needs its
own appropriate login. Use a server account whose accessible libraries are
appropriate for everyone using this launcher; app-launch PIN checks are not a
substitute for restricting the recommendation account's library access.

## Connection and credential policy

The existing private feed JSON in `server/keys/` accepts two optional fields:

- `plex_url`: the server's HTTPS `*.plex.direct` origin, including its port.
  No path, query, fragment or embedded username/password is accepted.
- `plex_token`: a restricted Plex user's token. Never paste it into chat, commit
  it, include it in an archive, or add it to browser `CONFIG`.

Keep the existing `tmdb_token` field unchanged, or explicitly set it to `""` if
TMDB is not wanted. Both Plex fields absent/empty disables the integration; a
partially configured pair is rejected. The file must remain mode 0600 in the
private `server/keys/` directory. Do not overwrite the existing TMDB credential
when adding Plex.

Use Plex's secure local connection address, as described in the canonical
project's Plex setup instructions. This adapter deliberately supports **LAN
servers only**: DNS results must be private IPv4 or IPv6 ULA addresses. Loopback,
link-local, public addresses, plain HTTP and certificate-verification bypasses
are not supported. A router's DNS-rebinding protection may require a narrowly
scoped exception for your exact Plex hostname; do not disable DNS protection
or change TV networking as an automatic setup step.

The token is sent only in `X-Plex-Token` to the configured HTTPS origin. Redirects
are rejected, TLS validation stays enabled, and errors exposed in snapshots are
generic. Only validated relative Plex artwork paths can reach the image
transcoder. Browser-visible artwork references are opaque hashes, not server
addresses or authenticated URLs.

This does not make the rooted firmware a security sandbox. Personal titles and
cached artwork are intentionally readable by the TV UI. Resolve the documented
legacy reverse-shell startup before placing additional personal credentials on
the TV; use the least-privileged Plex account practical for the intended libraries.

## Bounds and lifecycle

Metadata is limited to 16 sections, eight returned items per queried section,
and 2 MiB per response. Images are limited to 8 MiB per download and use the
existing image processor's pixel/time/storage bounds. Requests time out after
10 seconds; a metadata refresh has a 30-second budget. Successful metadata is
cached for four hours, failures for five minutes. Failed artwork requests also
back off for five minutes rather than hammering a sleeping server.

No Plex requests occur when its app is absent from the native app list. Worker
shutdown aborts outstanding Plex requests. A worker/context restart requires
fresh authenticated metadata before personal picks can reappear; persisted
personal picks are not accepted as authorization for a new account/session.

There is no additional HTTP listener, MQTT session or PC runtime dependency.

## Deployment and teardown

The updated frontend **and** worker modules must be packaged together. The
release verifier requires `native-feed-plex.cjs`; the package includes it.
Use the existing guarded release process, not manual writes over the running
worker. Current TV storage headroom needs review before any full release update;
never lower the 64 MiB reserve or silently delete recovery history to make room.

To disable: remove both Plex fields (preserving TMDB), or set both to empty
strings, then restart the owned feed worker through its normal service controller.
The new snapshot drops personal picks. Cached artwork may remain on disk under
normal image-cache retention; disabling is not a secure-erase operation.
Configuration changes and any backup of them must remain inside `server/keys/`.
Reverting code uses the existing release/Home recovery mechanisms.

## Verification still required

Offline tests cover credential permissions, request boundaries, private DNS,
redirect/body/token rejection, cancellation, backoff, selection, artwork caching,
Plex-only rendering, localized metadata, disconnect and package completeness.
A real-server trial must still confirm certificate/DNS compatibility, library
visibility, actual on-TV artwork, native Plex launch and removal. Specific-title
launching remains explicitly unimplemented until VIDAA support is demonstrated.
