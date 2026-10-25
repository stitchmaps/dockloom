# Releasing Dockloom

The public repository is intended to be `stitchmaps/dockloom`. Never upload the parent operations workspace, OS user-data directory, real SSH configuration or private logs.

1. Update `package.json`, the lockfile and `CHANGELOG.md`. Run unit tests, production build, desktop tests and the isolated SSH/Docker integration suite.
2. Review `git diff` and the exact files to be published, including image fixtures. Commit and push the reviewed revision. CI runs on Linux and Windows, including an isolated multi-service Docker test.
3. Run the **Build Windows release** workflow. It builds the unsigned portable binary, a source archive, and standard SHA-256 checksums. With `publish_draft=true`, it creates a draft GitHub Release for the version in `package.json` at the workflow's exact commit. It fails rather than overwriting an existing version.
4. Verify the artifacts, release notes and successful CI before publishing the draft. The workflow never modifies production servers.

For a local release, `npm run package` produces the same Windows portable layout. Create the source ZIP from `git archive`, not from a ZIP of the whole working directory. Upload only the EXE, source ZIP and checksum file. Runtime user data and local connection records are outside the distribution.

The CI workflow has read-only repository permissions. Only the manual release job has contents write permission for draft publishing. Signing certificates are not included; binaries are unsigned until a maintainer configures code signing separately.
