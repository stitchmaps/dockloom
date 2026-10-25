# Architecture

```text
React UI → isolated preload → validated Electron IPC → DeploymentCore
                                                       ↓
                                                system OpenSSH
                                                       ↓
                                            Python standard library
                                                       ↓
                                               Docker Compose v2
```

The UI has no filesystem or shell access. Server IDs are resolved by the main process from the OS user-data store; renderer requests never supply an SSH command. Host, path and action inputs are validated again by the core.

Each SSH request uses a fixed Python bootstrap and JSON on stdin. Source files are bounded, hashed and transmitted in the authenticated request; this alpha does not need a remote Node installation or an additional listening daemon. Sources are limited to 32 MiB rather than attempting unbounded streaming.

Remote jobs run detached from the SSH request, persist their state and serialize writes using a project lock. Release directories are immutable inputs for managed Compose configurations. A current-release pointer is updated only after verification. On failure, the runner attempts to restore the last successful release and records the outcome. Status is recovered from the remote task rather than inferred from the local connection's exit.

Compose YAML is parsed locally, constrained for source paths, then normalized by the remote Docker Compose parser. Explicit environment files determine interpolation; shell interpolation variables are filtered. Each release pins resolved image IDs and stores a private canonical configuration. Project identities include the deployment root to isolate similarly named apps. Named-volume identity stays stable while releases change; volume contents are never rolled back. Services are verified by project/release labels, image, running state and configured healthchecks. Services without healthchecks receive process-level verification only.

Existing Compose projects are identified by Docker labels. Logs and explicit container lifecycle operations target validated container IDs. Discovery does not reinterpret project ownership or rewrite manifests. No global compose down or image pruning is performed.

The demo backend implements the same TypeScript interface with synthetic data and is labeled as a simulation. It never attempts SSH. Desktop main and renderer communicate only through the methods in `packages/shared/types.ts`.

## UI design

The dark surface hierarchy, hairline borders and restrained lavender accent were informed by the Linear DESIGN.md reference from `VoltAgent/awesome-design-md`. Dockloom uses original layouts and system fonts; it does not redistribute proprietary Linear fonts or logos. Semantic error colors and desktop density are product-specific additions.
