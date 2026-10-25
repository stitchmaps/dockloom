# Compose releases

Dockloom 0.2 deploys new managed applications from a local directory. It does not adopt an existing server-side Compose project. The remote host must already have Docker Compose v2 with `config --format json` support, Python 3.6+ and permission to build/run containers.

## Supported inputs

- Ordered Compose YAML files and override files; explicit interpolation environment files; selected profiles.
- Image services and local Dockerfile builds with context, args, target or inline Dockerfile.
- One container per enabled service; required `depends_on` dependencies and healthchecks.
- One-shot services when another service depends on `service_completed_successfully`.
- Project-scoped bridge networks and local named volumes, plus tmpfs mounts.
- Read-only binds from files/directories inside the uploaded source; source-relative file configs/secrets.

Sources are limited to 32 MiB / 5,000 files and cannot contain symlinks. `.git`, `node_modules` and unselected `.env*` files are excluded. All other files are included regardless of `.gitignore`. `.dockerignore` controls Docker build contexts, not Dockloom's upload. Selected environment files are uploaded and retained privately with releases; do not put sensitive source inside a public image.

Relative paths resolve from the selected source directory, including when an override file lives in a subdirectory. No implicit `.env` is loaded. Specify any hidden environment file used by a service's `env_file` in the environment-file selection too. Only explicit values are used; deployment does not inherit arbitrary server shell variables.

## Deliberate limits

The plan rejects writable bind mounts, paths outside the source, remote build contexts, build SSH/secrets, `include`, `extends`, `container_name`, privileged containers, host/shared namespaces, external volumes/networks, custom volume/network names and scaling. Use a named volume for writable state. These restrictions keep releases isolated and recovery predictable; this is not a sandbox for untrusted Dockerfiles.

An app's enabled service names must stay unchanged across releases and rollback. Add/remove services under a new app name for now. Dockloom never performs global `down`, orphan removal or volume pruning. This also means unused volumes/images are not automatically garbage-collected.

## Release and rollback behavior

Planning uploads to a temporary private directory and normalizes the configuration without starting services. Publishing re-reads the source and configuration; avoid editing the source between review and confirmation.

Publishing builds local services using release-specific image tags, resolves each service to an image ID and freezes configuration/environment values. Image-only services use a locally available image, pulling it if absent; changing an upstream tag alone does not force a refresh. Use an explicit new tag/digest for predictable upgrades.

After switching, Dockloom verifies service ownership, release labels, image identity, running state and configured healthchecks. Without a healthcheck, a running process does not prove the application is ready. Add meaningful checks for databases and APIs. A failed switch attempts to restore the previous release. On an initial failure, Dockloom attempts to remove only the new application's managed containers, retaining volumes; inspect the task's recovery result before retrying.

Rollback recreates services with the old image/configuration. **Named-volume contents persist and database migrations are not reversed.** Re-running one-shot services can repeat migrations; make them idempotent and keep application/database schema versions compatible. Back up data separately. Releases may cause a brief outage and are not rolling or zero-downtime deployments.

See [compatibility and recovery](compatibility.md) for interrupted jobs and manual recovery boundaries.
