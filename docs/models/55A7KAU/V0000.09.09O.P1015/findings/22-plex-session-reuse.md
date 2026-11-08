# 22 — Reuse the signed-in Plex TV session, without exposing credentials

## Result

At the operator's request, the installed Plex app was opened remotely through
its normal native launch service. Its **currently selected user's server-scoped
credential** was retrieved privately, and the new feed client successfully read
movie/show recommendations and artwork over certificate-verified LAN HTTPS.
This validates the real-server transport, **not deployment of the new Home UI**.

The private setup file is `server/keys/plex-setup.json` on the operator's host,
mode 0600. Neither token values nor authenticated URLs were printed or committed.
No new Plex credential file was installed on the TV. The supplied server password
was not needed: existing key-based SSH access sufficed to identify its LAN address.

## Native launch and session discovery

- Plex is native app `42`. Use its current registered metadata with the ordinary
  `ui_service/launchapp` request, not a replacement browser URL or bypass flags.
- The first remote-control attempt received MQTT CONNACK **5**. The existing
  refresh-token flow recovered the pairing without a PIN or re-pairing. Original
  and refreshed credentials remained inside private `server/keys/` storage.
- The app started the normal `browser` processes. No existing debugger endpoint
  was available; none was enabled, and no browser flags were changed.
- Plex data resides in Chromium localStorage under
  `/var/local/webengine/odin_home_browser/Normal/Local Storage/leveldb`.
  Looking only at the current WAL is insufficient: compaction moved relevant
  records into SST tables after app startup.
- A read-only on-TV reader followed `CURRENT` and the live manifest, decoded
  bounded Snappy blocks, checked CRC32C checksums, respected sequence numbers
  and deletions, and rejected files changing during the read. Only Plex-origin
  values were decoded; unrelated app records were never exported. The database
  was never opened for writing, repaired, copied off-TV, or unlocked.
- Synthetic fixtures covered decompression, checksum rejection, live-manifest
  selection, latest-value/deletion handling and origin isolation before use.

## Important token distinction

`PlexAuthToken` identifies the selected Plex account, but is **not necessarily the
credential accepted by a particular shared media server**. Using it directly
against this server returned HTTP **401**.

The successful path matched `LastActiveUserUuid` to `OfflineUsersData`, then used
that user's entry for the selected server in `OfflineUserServersData`. Other
cached users' credentials were not used as fallbacks. This preserves the selected
account's server access rather than silently using another cached profile.

## Secure local endpoint

The supplied hostname resolved to a CGNAT/overlay address. A read-only
`hostname -I` through existing server SSH identified its TV-LAN address as
`192.168.50.8`. Plex's cached server connections included `172.18.0.24` and a
public route, but not that LAN address.

The cached Plex certificate-domain identity was retained while constructing the
secure address for the confirmed LAN IP. Normal certificate and hostname
verification succeeded; no HTTP fallback or TLS-verification bypass was used
for authenticated requests. The cached connection mismatch is a candidate for
future performance investigation, **not a measured explanation of lag**. No
server networking, advertised-address or playback setting was changed.

Real checks passed:

- Three metadata requests: HTTP 200, yielding one movie and one show candidate.
- Two artwork downloads: valid supported raster responses over verified HTTPS.
- No library names, titles, profile identifiers, tokens or server certificate
  identifiers were published in the evidence.

## Return and remaining work

Home was requested after the probe and a private HAL capture confirmed the
existing Free My TV Home was visible. **MQTT state still reported app 42**:
Home overlays the retained app, so that state alone does not establish which
screen is visible. Do not keep sending navigation based on that stale inference.

Home (`e33a1ed1…`), bootstrap (`5f6f1d20…`) and preferences (`6117b815…`) retained
their previous hashes. Free `/var/local` space was 67,825,664 bytes: only 700 KiB
above the 64 MiB reserve. No deployment should be forced into that headroom.
Guarded legacy reverse-shell retirement and preservation-first storage work
remain prerequisites to provisioning the integration on the TV. Integrated
on-TV rendering, title-specific launching and disable/rollback acceptance
remain unverified; the existing Home build is still installed.
