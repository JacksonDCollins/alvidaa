# Resumed release-controller validation

The operator authorized TV access again after the offline work in
[findings 18](18-web-port-completion.md). This record separates observations from
unfinished trial steps; no power commands are part of this validation.

## Read-only baseline

- Home remained `d83a4e18b15211d5d5449c9b36a51e343d3ce68051a66f0b34377fb24a4f5b78`.
- Home controller: installed, no pending update.
- Bootstrap remained `5f6f1d2043080867678aeea92d687b92df85a8bc37d99286c8d6a31da2872857`, matching its installed journal.
- Engine PID 21260 and owned feed PID/group 18264 were still alive.
- Exact preference hash remained `7d0d11a3bd1cb34c10ed80bfbfdcf6286c9e1464f3ab494ad3a0a24711255a87`.
- 47 apps, Brisbane timezone, 124 image mappings and zero image failures.
- Uptime was approximately 126,559 seconds. This was **not a cold boot** and does
  not close that acceptance gate.

## Preflight space-accounting defect

Before staging, read-only inspection showed about 97 MB free on `/var/local`
and 180 MB on `/APPS`. The release contains about 5 MB of runtime and 44.7 MB
of assets that are already installed under the same content-addressed ID.

The first coordinator incorrectly charged the complete release plus backups
against **each** filesystem, then added its 64 MiB reserve. This would reject a
safe update despite reusing the assets. No deployment was attempted with that
calculation.

Accounting now verifies existing assets and counts only missing ones. Runtime,
recovery copies, Home update copies and public writes are budgeted on their own
filesystems; allocations sharing a device are summed before adding the reserve.
Regression tests cover existing/changed assets, distinct filesystems, shared
mounts and insufficient headroom. The reserve is retained, not reduced to force
an installation through.

## Apply / rollback / reinstall

The checked archive was staged privately on `/APPS`, not over the live runtime.
Its 1,805 payload files verified on the TV. The received archive was removed only
after hash verification and extraction; the staged recovery inputs remain.

- Apply installed frontend `63a452c1…` and started owned worker 22272.
- Independent journal `release-SdVlls` restored Home `d83a4e18…` and **every prior
  runtime file hash**, then restarted the previous feed as PID 22614.
- Reapply produced journal `release-udfYjr` and owned worker 22746.
- Home rendered live recommendations; exact original preferences remained intact,
  with 47 apps and zero image failures after the first apply.

## Light focus-label regression

The actual light Settings view exposed a remaining contrast defect: the focused
static category label/icon remained white despite a light focus surface. Other
labels and controls were readable. The vendor first-level renderer places these
under `#v-focus.firstLevelItem`; the broad text inheritance removed by the prior
semantic-color fix had also been masking this focus-specific behavior.

Corrections target the static category label/icon and the native setting-item
primary-title slot (`#v-focus.item-class .s_item_title`), not secondary values or
warning/confirmation content. Explicit semantic/inline colors remain excluded.
The desktop CSS fixture checks native white focus descendants and warning text.
Live captures now confirm readable focused Picture, TV Name and Subtitle Settings
labels, including the Connection and Accessibility menus. Menu Transparency
remained Medium; these were navigation-only checks, with no preference toggles.

## Stock teardown and final reinstall

The coordinator's `uninstall` restored exact stock Home `046b41ae…`, exact
pre-feed bootstrap `42f85336…`, and stopped the worker. The first capture was
black; stock Home visibly rendered after a Home key and an eight-second wait.
Do not interpret that first frame as either successful rendering or a failure.

The supported Home/boot setup controllers then reinstalled the corrected web
Home and the exact original feed-enabled bootstrap. Further focus corrections
used the existing stopped-engine Home updater, not an unguarded file write.
These later Home changes intentionally make the earlier release journals
historical; their concurrent-change guards must not be bypassed to roll them back.
Current stock teardown remains available through the Home/boot controllers.

Final observed state:

- Home: `4d541b567ae9f7265d887fc663d30b63381b70f9fd6b754ed01b1d7d0768bc42`.
- Bootstrap: `5f6f1d2043080867678aeea92d687b92df85a8bc37d99286c8d6a31da2872857`, installed.
- Engine 24852; owned feed PID/group 24006; 47 apps; 108 images; zero image failures.
- Exact original preference hash still `7d0d11a3bd1cb34c10ed80bfbfdcf6286c9e1464f3ab494ad3a0a24711255a87`.
- Latest Home-update recovery directory: `/var/local/alvidaa/native-home/update-jwSXUb`.
- TV returned to Home. No diagnostic candidate or forced preference is active.

All trial backups were retained. Private free space was approximately 70 MB;
further full-release updates may correctly refuse the 64 MiB reserve plus
backup budget. Do not delete history or lower the reserve to bypass that guard.

Root/SSH, credentials, origin storage and hardware settings remain protected.
Cold boot, physical voice/audio/playback, actual accessibility-mode transitions
and subjective acceptance still require the operator. The legacy reverse-shell
recovery channel remains unchanged pending independent cold-boot recovery proof.
