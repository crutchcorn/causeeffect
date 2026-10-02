# Changesets

Run `pnpm changeset` when a change should release either public library. Commit
the generated Markdown file with the change. Choose the appropriate patch,
minor, or major bump and write a summary for the package changelog.

Changesets on `main` create or update a release PR. Merging that PR publishes the
new package versions through GitHub Actions and npm OIDC. Private applications
and examples are excluded from releases. Changes that do not affect a published
package do not need a changeset.

Run `pnpm changeset:status` to preview version bumps and `pnpm release:plan` to
query which manifest versions are missing from npm. Contributor and initial
publisher setup instructions live in [AGENTS.md](../AGENTS.md).

See the [Changesets guide](https://changesets.dev/guide/getting-started).
