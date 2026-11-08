# Plex parity and guarded rollout — in progress

Follow-up to [automatic session following](23-plex-automatic-session.md). The
operator authorized parity completion, safe startup/storage preparation, guarded
deployment, and acceptance. No power cycle or playback was authorized or performed.

## Title-detail transport proved, integrated UI acceptance still pending

The registered native Plex app (42, `https://app.plex.tv/tv-vidaa`) accepted
`providerId` and `ratingKey` query parameters with **`autoplay=0`** through the
normal native launch service. Plex first displayed its own profile chooser.
Read-only storage inspection confirmed that the highlighted profile was the
already-active authenticated account; only that profile was selected. A HAL
capture then showed the requested movie's details page, with the Play button
still idle. The captured title matched the privately prepared target. Home was
restored using the normal Home key. No playback, PIN bypass or alternate-profile
fallback occurred.

The launcher adapters now pass this target through native app membership and
fresh availability checks, then APC's existing PIN/EULA/hotel checks. Only the
registered Plex URL and validated server/item identifiers are accepted; autoplay
is explicitly disabled. Narrow Plex cards request 500×750 posters with backdrop
fallback. Successful metadata refresh now uses six hours and the original local
05:00/12:00/18:00 period boundaries, including clock rollback handling.

These changes passed 168 launcher tests before the separate retirement tests.
Transport proof is not yet acceptance of clicking a deployed launcher card.

## Preservation-first storage preparation

The unused runtime `stage.tar.gz` was copied into private local
`server/keys/storage-retirement/`, mode 0600, and verified before removal from the
TV. Its 26,005,354 bytes had SHA-256
`985458325e5ebe8b4640b1caee30b75a1d09adae8a4bb123594fbc7e9a6d01df`.
207 live-script/recovery JSON files were inspected for references; only the
historical ownership inventory named this archive, not a runtime or recovery
consumer. That inventory was retained.

Removal used the existing Home lock, unchanged Home/bootstrap guards, an open-FD
check and a restoration record. The record is
`/var/local/alvidaa/native-home/archived-stage-985458325e5e/state.json`.
It records the local backup, exact hash, size, original root ownership and 0600
mode. Restoring those verified bytes to the recorded source path reverses the
operation. No app data, active artwork, preferences or recovery backup was deleted.
Free `/var/local` space increased to 94,126,080 bytes.

## Legacy reverse-shell startup retired

`retire-native-phonehome.cjs` and `patch-native-phonehome.py` accept only the
fingerprinted legacy block. The IPK root payload, other control files, SSH setup,
feed hook and surrounding startup code are unchanged. The obsolete runtime script
had a known hash and no owned loop or reverse connection was active. No broad
process kill or SSH-directory cleanup was used.

The controller moved the complete old feed-bootstrap journal into
`/var/local/alvidaa/native-home/retired-phonehome/old-boot`, retaining its exact
bytes. A new active bootstrap journal uses a phonehome-free baseline, so ordinary
feed teardown cannot silently re-enable the reverse shell. Independent recovery
code and the inactive script backup remain under the retirement journal. Its
explicit `restore` command restores old startup bytes but starts no process;
**that exceptional undo would re-enable insecure startup on a later boot** and
is not the normal launcher rollback path.

Four synthetic tests passed: payload preservation and safe feed teardown, exact
restoration, recovery from an interrupted journal migration, and refusal of
unknown scripts/concurrent edits. Both actual private IPK candidates were also
validated before applying through the owned Home lock.

After retirement, a new key-only SSH connection verified:

- retirement phase `retired`, old recovery retained, safe baseline hash valid;
- obsolete script absent and no owned reverse-shell process/connection;
- Home unchanged: `e33a1ed19f07a7a072f79f54b68617087f34811ee2508de0534e2b1c61ac1393`;
- preferences unchanged: `6117b815026a8ff186c0f1b335008d59fa80a847212e53a296bf4a29097ac20a`;
- bootstrap now `ef4ad527ce4c2d34c5c73ba4d4f65245dd3b64372e93a744128c1efe6611fa68`;
- free `/var/local`: 92,438,528 bytes, above the unchanged 64 MiB reserve.

The staging directory is `/APPS/alvidaa-phonehome-retire-ef4ad527ce4c`.
No reboot has been used to test startup; inspection proves the startup edit and
fresh SSH proves the current recovery lane, not cold-boot acceptance.

## First deployment, disable and exact rollback

Release `2524b955d7d4bf320be937941d2d54b06783719ba78c5533d01bbc0b60cd625a`
was installed through the coordinator, journal `web-releases/release-Se9dDY`.
The automatic worker reported `ready`, two personal picks (movie/show), two
available posters and zero image failures. Preferences remained unchanged.
This establishes backend operation, not acceptance of clicking a visible card.
The current hour's three public cards contained no personal pick: the original
algorithm permits at most one Plex surprise, not a guaranteed Plex card every hour.

Source comparison during acceptance exposed a remaining mismatch: the first
adapter inserted personal picks into the already-built public pool, producing
26 rather than 24 titles and a different order. The correction records trending
provenance, interleaves Plex within each trending kind, alternates kinds, then
fills with fresh titles up to 24. Legacy caches refresh their provenance; removing
personal entries from a capped persisted pool also invalidates its freshness so
public tail entries can be refilled. Pinned upstream files remain unchanged.

A guarded private-config disable and owned-worker restart produced `disabled`,
zero personal picks and an unchanged TMDB token. Its image-reference counter
was later found invalid; see the artwork-publication correction below. The release's independent controller then rolled back exactly to
Home `e33a1ed19f07a7a072f79f54b68617087f34811ee2508de0534e2b1c61ac1393`.
The exact pre-Plex private configuration was restored. A later SSH check confirmed
the previous worker remained running/selected, the preference hash was unchanged,
and the phonehome-free bootstrap remained `ef4ad527…`.

## Additional rollback headroom and diagnostic traps

The unused private runtime `assets/` staging tree had no direct references in
261 inspected runtime/recovery scripts and JSON files. All 1,728 files matched
the private verified release archive, totaling 44,739,003 bytes. Original paths,
owners, modes and modification times were recorded privately before removal
under the Home lock, Home/bootstrap hash guards and an open-FD check. The on-TV
restoration record is `native-home/archived-assets-49e13fbfa4c41725e0cd/state.json`.
Public assets, their hard links and all recovery journals remain. Free space
increased to 129,835,008 bytes; the 64 MiB reserve was not reduced.

The vendor Node build lacks `Intl`, so `buildProgram()` must remain a host-side
operation. A diagnostic JSON inventory exceeding 64 KiB was truncated by an
immediate `process.exit()`; waiting for the stdout write callback fixed the probe
before any staging deletion. The backend clock was verified at UTC+10, matching
`Australia/Brisbane`.

Both TCP 8008 and 36669 briefly returned `EHOSTUNREACH` after rollback. The operator
confirmed the TV was on. Ordinary SSDP discovery saw the same address and SSH
subsequently worked; no wake, restart or power command was sent. Cause is unproven.

## Corrected reapply and integrated acceptance

Commit `58482c3` passed 174 launcher tests, three packaging tests, repository and
diff checks. LSP reported no errors (one file confirmed clean, three inconclusive).
The packager correctly rejected a host-only image helper before rebuilding with
the ARMv7 binary. The corrected archive is
`bf902a0dec4c095f88b33677f10d3b0d073c53fb653eaf8125dea0453686bda1`, staged at
`/APPS/alvidaa-plex-release-bf902a0dec4c`. Guarded reapply installed Home
`bde9180bb6768d62040f437d5bb0bf4a5205723eb9483938d719c8036f490c95`, retaining
journal `web-releases/release-SJTbT5` and the earlier rolled-back journal.

The selected worker reported automatic `ready`, provenance version 1, exactly
24 candidates, two personal picks, both posters available and zero image
failures. Free `/var/local` was 117,747,712 bytes, above the unchanged reserve.
The actual frontend selected the personal card in column two of Movies and Shows.
HAL captures verified both portrait cards. Selecting the movie card through the
remote opened native Plex's normal chooser. Read-only production selection
confirmed its highlighted profile was already active; confirming that profile
opened the matching movie details page with the Play button idle. Home returned
normally. No playback or profile/PIN bypass occurred.

Disable was repeated on this exact build. The personal card disappeared from the
visible Shows row; the snapshot reported `disabled` and zero personal picks
while TMDB stayed configured. The initial image-reference counter was wrong
(`plex:` rather than `/plex-`), so its zero-reference result was invalid. The approved
automatic configuration was then restored through the owned worker. This is
advertised removal, not secure erasure of retained artwork cache files.

## Artwork publication bug found before authentication testing

A corrected diagnostic found ten `/plex-` artwork references still advertised
while disabled. Old render mappings remained until image processing finished;
persisted startup mappings and unreachable raw-media records were also published.
The operator had not begun account tests and was asked to keep waiting.

The fix filters published image mappings to the current renderable picks and
publishes only media reachable from those mappings or native app-icon aliases.
Startup sanitizes persisted recommendations and artwork in automatic, disabled
and manual modes. Internal verified image caching remains available, but does not
authorize publication. Tests cover stale posters/originals, orphan media, native
icons and their derived resources, malformed context/cache, logout and late
cancelled callbacks. All 175 launcher tests pass; deployment verification follows.

## Still pending

Deploy and verify artwork revocation, then actual login/logout/account-switch
acceptance requires operator-assisted Plex
authentication. Do not inject credentials into Plex storage or bypass profile
protection to complete a test. A cold boot remains untested and unauthorized.
