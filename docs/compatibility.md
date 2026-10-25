# Compatibility and verification

This is an alpha, not a claim that every Linux distribution or Compose configuration is supported.

| Environment | Verification |
| --- | --- |
| Windows 11 x64 desktop | Type checking, production build, actual Electron window/IPC and UI workflows |
| Alibaba Cloud Linux 3, x86_64, Python 3.6.8, Docker 26.1.3, Compose 2.27.0 | Read-only discovery of an existing nine-container deployment; no production changes |
| Local disposable Alpine Linux fixture, Python 3.12, Docker 27 / Compose v2 | Real SSH static and Compose deployment, source builds, ordered overrides, environment files, profiles, healthchecks, named-volume persistence, version update, rollback and failed-release recovery |
| macOS/Linux desktop | Source architecture intended to be portable; installers not yet verified |
| arm64 or non-root Docker access | Not yet integration-certified |

The remote bootstrap uses Python standard library syntax compatible with 3.6+. The unit suite checks the embedded script's syntax and exercises failure recovery, drift detection, ownership, paths, log redaction and process identity. The oldest Python is supported for compatibility, not recommended for a new installation.

Docker Compose v1, Kubernetes, Podman, Windows Server, password-prompt SSH, automated sudo, automatic Docker installation, takeover of existing apps and database rollback are not supported in this alpha. Managed Compose releases support a documented [subset of Compose](compose.md).

## Reproduce

Run `npm test`, `npm run build`, `npm run test:ui` and `npm run test:integration` from the repository root. UI tests launch the actual Electron app with an isolated user-data directory. Their screenshots are written to gitignored `test-results/`.

Integration tests need Docker in Linux-container mode and image registry access for the first run. Tests build an isolated privileged DinD fixture, import a test Nginx image, create a temporary SSH identity and trust its host key obtained directly from the local fixture. No production credentials or server address are used. Only the uniquely named test container and its volume are removed afterward.

## Recovery boundaries

A closed SSH connection does not mean a deployment failed. Reconnect and inspect its persisted job. A dead worker or reboot is reported as interrupted; an unfinished switch prevents further deployment of that app.

For an interrupted switch, inspect `<root>/.dockloom/apps/<app>/transaction.json`, `current.json`, the referenced release manifests and the actual container labels before manual recovery. Do not delete transaction files to bypass the guard. Release configuration and file checksums must still match. Reapplying the previous Compose configuration requires the exact original project name and release path; this alpha does not provide a forced-recovery button.

Normal startup/HTTP failure automatically attempts to restore the last successful release. If that restoration also fails, the error stays visible and blocks new switches until resolved.
