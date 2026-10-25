# Changelog

## 0.2.0 — 2026-10-26

- Added local Compose deployment with ordered files, explicit environment files, profiles, source builds and immutable image IDs.
- Added service health verification, failed-release restoration and historical rollback while retaining named-volume data.
- Added a bilingual Compose review workflow, multi-service example, integration coverage and GitHub CI/release packaging.
- Kept existing-server discovery and validation read-only; no automatic takeover of existing projects.

This alpha supports a bounded Compose subset. Enabled service sets must remain unchanged between revisions. Writable bind mounts, privileged/host-network services, external resources and database rollback are not supported. Packages are unsigned.

## 0.1.0 — 2026-10-25

Initial local alpha: Windows Electron workspace, SSH key/alias connections, host and Compose discovery, scoped container logs/actions, static-site release planning, detached deployment jobs, health checks, failure recovery and version rollback. Includes a bilingual demo, security guidance, synthetic examples, unit/UI/integration tests and Windows packaging workflow.

Existing Compose configurations can be inspected and validated but are not rewritten or redeployed. General image/Compose releases and other desktop installers remain planned.
