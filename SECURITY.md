# Security

Dockloom executes commands with the authority of the SSH account selected by the user. Access to Docker normally implies substantial control of the host. Use only servers and application artifacts you trust.

- SSH host key verification is required. Connect once with OpenSSH and verify the fingerprint with the server owner before adding a new host.
- Private keys remain external to the app; server records contain only paths and connection metadata.
- The renderer is sandboxed and uses a constrained preload API. No public Docker API or web control panel is started.
- Known secret patterns in logs should be redacted, but arbitrary application logs can still contain secrets. Inspect them before sharing.
- Existing applications are not silently converted to managed releases. Static releases are created only under a dedicated selected root with ownership checks.
- Backing up data is independent of rolling back a static release. Do not treat image rollback as a database restore.

When this project is published on GitHub, use the repository's private vulnerability reporting feature if enabled. Do not include private keys, subscription links or production logs in public issues. The maintainer should enable private reporting before the first public release.
