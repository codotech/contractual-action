# Contributing

Create a branch from `origin/next`, then open a PR to `next`. Use a Conventional Commit title, for example `fix(release): resume incomplete releases`. One approving review, resolved conversations, up-to-date branches, and passing `CI` and `PR title` checks are required. Squash merges use the PR title.

Use Node 22 or newer and pnpm 10.26.2:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
```

Commit `dist/` with source changes. CI rebuilds the bundle and checks for drift on Node 22, 24, and 26. The Action runs on GitHub's Node 24 runtime; self-hosted runners must support that runtime.

## Release approval

Ask Omer before creating or moving version tags, publishing anything, or changing release aliases. Existing tags are left intact. Documentation uses `@v0.1.0-dev.14`, the highest existing tag; it does not yet include the changes in this PR. A new version and an optional major alias require a separate approval after review and validation.

## Contractual dependencies

CLI and governance use npm's `beta` dist-tag in `package.json`. The lockfile records the exact resolved versions, and the Action bundles those versions in `dist/`. To adopt a newer beta, run `pnpm update @contractual/cli @contractual/governance`, run the checks above, and commit the lockfile and rebuilt bundle. A moving npm tag does not change an already released Action.

The published beta dependencies include the malformed-YAML version-sync fix, so no local patch is needed. Keep the regression test passing when updating dependencies.
