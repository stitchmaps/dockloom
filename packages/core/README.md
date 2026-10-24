# Deployment core

`DeploymentCore` is an asynchronous Node-only API matching `packages/shared/types.ts`.
Use it in the Electron main process. `remote.ts` exports an embedded `REMOTE_PYTHON`
string; esbuild bundles it automatically. No resource copying, Python installation
on the desktop, or Python npm package is required.

```ts
const core = new DeploymentCore({
  // Optional, especially useful for an isolated integration fixture:
  knownHostsFile: '/absolute/path/to/known_hosts',
  // sshExecutable: '/absolute/path/to/ssh',
  // sshOptions: ['-F', '/absolute/path/to/ssh_config'],
});
```

The remote requires Linux, Python **3.6+**, Docker Engine, and Compose v2 supporting
`--pull never`, long bind syntax and `pull_policy`. Inspection reports capabilities;
if Python itself is absent, SSH returns an actionable bootstrap error. Authentication
is OpenSSH key/agent authentication with `BatchMode=yes` and
`StrictHostKeyChecking=yes`. Trust the host key manually first. Alias mode preserves
the configured port when the shared server record has its default port 22.
`sshOptions` and the executable are trusted host configuration, never renderer input.
`RemoteTransport.request<T>(server, operation, args)` can also be injected for tests.

All remote input travels as JSON over stdin. No user paths, names or IDs are
interpolated into shell commands. Imported Compose is validated read-only with
ordered files and the original project directory; expanded environments are never
returned. Imported projects are not adopted or rewritten. Container lifecycle uses
only a validated ID and the explicit start/stop/restart operation.

Managed state lives under `<root>/.dockloom/`, with root/app ownership markers.
Unmarked existing namespaces, app directories, symlinked paths and Compose project
name collisions are refused. Each application uses project name
`dockloom-<app>-<root-path-hash>`, isolating the same app name in different roots.
Compose paths and labels escape dollar signs to preserve literal root paths. Inspection and
planning do not create remote directories. Releases are immutable files beneath
`apps/<app>/releases/<id>`; checksums detect content/config drift before updates or
rollback. Static sources must contain `index.html`; directory-only v0.1 rejects
symlinks and special files, with limits of 5000 files and 32 MiB. Only select built
public assets. No ZIP support is claimed.

Deploy/rollback submit detached Python jobs using Linux process identity and boot
ID. Status, stage, bounded returned logs and requests are private files under
`jobs/<id>`. The worker deletes uploaded request data after preparing the release.
An application `flock` prevents simultaneous switches. A durable transaction marker
records previous/target releases before switching. Server reboot/process death is
reported as `interrupted`, and an unfinished transaction blocks new deployment;
it is never silently replayed. Manual inspection/recovery is required in that case.
Detachment uses a new session with redirected descriptors; SSH servers configured
to kill all session descendants need an administrator-supported execution policy.

Cached images are preferred and pinned to their immutable image IDs. No registry
access is needed when the selected image is cached. The image must be compatible
with the official Nginx configuration layout and support `nginx -t`. Compose and
Nginx configuration are checked before switching. A server-local HTTP release
marker plus the running image ID verifies the switch; external reachability is
not claimed. Successful verification commits `current.json`. Failed switches
restore and verify the previous release; recovery failure is recorded and blocks
further switches. No global `down`, prune, volume deletion or existing Compose edits.
Old releases and images are retained; there is no automatic cleanup in v0.1.

Logs are capped and common credentials/private keys redacted on both sides. This
cannot identify every secret an arbitrary application might print. Remote worker
logs contain stage/error messages only; Docker command output and environment dumps
are not persisted. Memory and disk quantities in snapshots are **bytes**.

Tests: `npm test` (tsx + Node test runner). Remote-script unit tests use `python3`
or `python`; set `DOCKLOOM_TEST_PYTHON` when the interpreter is elsewhere. They skip
explicitly if no local interpreter exists. Real SSH/Docker verification is supplied
by the separate isolated integration harness.
