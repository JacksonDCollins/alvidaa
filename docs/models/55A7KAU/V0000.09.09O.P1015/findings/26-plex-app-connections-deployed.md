# App-derived Plex connections — guarded deployment

After the operator reported that the TV was back on, read-only capture confirmed
Home was visible. The preflight Home, bootstrap and preference hashes matched the
previous record. The owned worker was running; the old adapter was `unavailable`,
with 24 public candidates and no personal mappings. No server settings were changed.

## Release

Installed the private release prepared in [finding 25](25-plex-scope-correction.md):

- Code `b60ee60`, archive SHA256
  `e6b385440ce52ca5537d2aa9706d0aa2a97471286832178c944696e7e6933797`.
- Stage `/APPS/alvidaa-plex-release-e6b385440ce52`.
- Recovery journal `/var/local/alvidaa/native-home/web-releases/release-ZGUyXg`,
  phase `installed`.
- Home SHA256 `470e8cac2970ecfba71d5bc10a160d0556e60c7a05aacaf57edc3b4699cdcce9`.

Only runtime bytes were transferred. All 1,728 public assets were individually
hash/ownership checked and hard-linked into staging; the bundled verifier accepted
all 1,808 manifest files. Apply used the release coordinator with the reviewed
previous Home hash. No reserve reduction, direct runtime overwrite, recovery
removal, power cycle or Plex-server modification was used.

## Live checks passed

- The installed selector reported two app-provided secure connection candidates;
  the old configured URL was **not** one of them. The code ignores that override.
- The owned worker reached `ready`: 24 candidates, one personal movie and one
  personal show, ten private artwork mappings, both portrait mappings, shared
  original-backdrop aliases, zero image failures and no pending work.
- All 47 native icon aliases remained available.
- The supported guarded disable operation produced `disabled`, zero personal
  candidates and zero private mappings while preserving all 47 native icons.
  Re-enabling restored both personal candidates and ten mappings.
- The exact private configuration was restored. Bootstrap and preferences remained
  byte-identical to preflight; SSH remained available. Final free space was
  **99,627,008 bytes**, above the unchanged 64 MiB reserve.
- A fresh Home capture showed the new build rendering normally.

The private configuration retains ignored legacy fields for backward rollback
compatibility. No new URL/token entry was supplied and no alternate profile was
used. Disable/re-enable is not an authentication logout/login test.

## Acceptance boundaries

The current-hour selection had no personal card in any tab. This is permitted by
the original surprise-card rotation: having two personal candidates does not
promise a personal card on screen every hour. We did not force a Plex-only mode,
alter the TV clock, rewrite the list or start playback to make a screenshot.

Thus this release has live connection, decoded-artwork preparation, publication,
revocation/restoration and Home-rendering evidence. A naturally selected personal
card, its displayed portrait and a card-to-details click have **not** been retested
on this release. Earlier card/details and actual logout/login results remain the
historical evidence in [finding 24](24-plex-parity-and-safe-rollout.md), not fresh
acceptance. Native profile switching, cold boot and broader performance acceptance
remain outstanding. The new release journal was retained but not rolled back in
this pass.

Diagnostic traps: the first preflight script had an extra closing parenthesis and
failed to parse before executing; correcting the read-only script completed the
checks. An initial icon counter inspected `images` instead of `media`; the correct
native-icon alias count was 47, not zero. Neither was a deployed-code fault.
