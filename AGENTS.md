# Repository workflow

- Start branches from `origin/next` and open PRs targeting `next` with Conventional Commit titles.
- Use Node 22 or newer and pnpm 10.26.2. Run `pnpm typecheck`, `pnpm test`, and `pnpm build`; commit the rebuilt `dist/` with source changes.
- Require review and passing CI; never bypass the ruleset or push directly to `next`.
- Keep workflow automation in GitHub Actions; do not add a `scripts/` folder for workflow helpers. Manage rulesets directly in GitHub, not checked-in JSON copies.
- Always ask Omer before creating, moving, or pushing version tags, publishing a GitHub Release or package, changing distribution tags, or dispatching any workflow that performs these actions. Code fixes and PRs are not release approval.
- Use existing version tags in documentation, not commit SHAs or nonexistent stable aliases. The latest numbered development tag is `v0.1.0-dev.14`.
- Keep `patches/@contractual__changesets@0.1.0-dev.5.patch` until an approved dependency upgrade contains the YAML fix. No npm publication is needed to build this patch into the Action.
