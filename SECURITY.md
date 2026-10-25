# Security

Dockloom executes commands with the authority of the SSH account selected by the user. Access to Docker normally implies substantial control of the host. Use only servers and application artifacts you trust.

- SSH host key verification is required. Connect once with OpenSSH and verify the fingerprint with the server owner before adding a new host.
- Private keys remain external to the app; server records contain only paths and connection metadata.
- The renderer is sandboxed and uses a constrained preload API. No public Docker API or web control panel is started.
- Known secret patterns in logs should be redacted, but arbitrary application logs can still contain secrets. Inspect them before sharing.
- Existing applications are not silently converted to managed releases. Managed releases are created only under a dedicated selected root with ownership checks.
- Compose source, selected environment files and resolved configuration are stored in private release directories on the remote host. They are not encrypted at rest. Docker users and root can inspect container environment values. Keep secrets out of build contexts with `.dockerignore`.
- Compose build/normalization output is withheld from public task output because it may contain configuration secrets. Application logs still require care before sharing.
- Backing up data is independent of rolling back a release. Do not treat image rollback as a database restore.

Use GitHub's private vulnerability reporting feature when available. Do not include private keys, subscription links or production logs in public issues.
