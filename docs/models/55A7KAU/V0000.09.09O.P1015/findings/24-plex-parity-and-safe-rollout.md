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
zero personal picks, zero advertised personal image references and an unchanged
TMDB token. The release's independent controller then rolled back exactly to
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

## Still pending

Deploy the corrected pool implementation, verify actual personal-card rendering
and card-to-APC launch, and complete login/logout/account-switch acceptance.
Full sign-out may require operator-assisted Plex reauthentication; do not inject
credentials into Plex storage or bypass profile protection to complete a test.
