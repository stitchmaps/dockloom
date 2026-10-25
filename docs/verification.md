# Verification

## v0.2 alpha — 2026-10-26

- 27 unit/remote-script/store tests passed without skips; TypeScript and production builds passed.
- Actual Electron UI passed connection persistence, static and Compose review/deployment, language and server isolation tests.
- On October 25, the isolated SSH/Docker suite passed multi-service builds, ordered overrides, explicit environment files, profiles, dependency health, update/rollback, named-volume persistence and failed-release restoration without disturbing another app.
- On October 26, a local Docker Desktop startup/socket failure prevented the final local integration rerun. The GitHub CI integration job validates the committed revision independently; consult its result before using a release.

## v0.1 alpha — 2026-10-25

Executed locally before handing off this alpha:

| Check | Result |
| --- | --- |
| TypeScript type check + Vite + Electron build | Passed |
| Core, remote-script and local-store tests | 17 passed, 0 failed, 0 skipped |
| Real SSH into isolated Docker host | Passed |
| Static v1 deployment and HTTP content | Passed |
| Static v2 update and rollback to v1 | Passed |
| Failed startup restores previous HTTP content | Passed |
| Reconnect to persisted deployment job | Passed |
| Real container logs and stop/start | Passed |
| Unsafe name / missing index rejection | Passed |
| Actual packaged Electron window and preload | Passed |
| Local connection save/remove with home-relative root | Passed |
| Demo UI search, action confirmation, deploy review and task completion | Passed |
| Language and server switching | Passed |
| Packaged app read-only discovery on an existing Alibaba Cloud Linux server | Passed; nine running containers discovered |

The integration fixture was removed after testing. Production applications were not changed. Real deployment tests used an isolated local Docker daemon; existing-server verification was read-only. The UI's demo data are synthetic and are not evidence of a real deployment.

The source repository contains no production connection records. Packaged desktop UI tests used isolated temporary user-data directories. Signed distribution, macOS/Linux desktop installers and arm64 runtime verification remain future work.
