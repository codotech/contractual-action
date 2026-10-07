# Contractual GitHub Action

Schema contract lifecycle management for GitHub — lint, detect breaking changes, auto-generate changesets, and version contracts.

## Usage

Requires Node 22+ for development and a GitHub runner supporting the Action's Node 24 runtime. Licensed under MIT. The example uses an existing development tag; stable release tags require a separate approval. See [CONTRIBUTING.md](CONTRIBUTING.md).

```yaml
- uses: codotech/contractual-action@v0.1.0-dev.14
  with:
    mode: pr-check
    github-token: ${{ secrets.GITHUB_TOKEN }}
```

## Modes

### `pr-check`

Runs on pull requests. Detects breaking changes, posts a PR comment with a diff table, and auto-commits a changeset.

```yaml
name: Contract Check

on:
  pull_request:
    paths:
      - 'specs/**'
      - 'schemas/**'

permissions:
  contents: write
  pull-requests: write

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          ref: ${{ github.head_ref }}

      - uses: codotech/contractual-action@v0.1.0-dev.14
        with:
          mode: pr-check
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

### `release`

Runs on push to main. Consumes changesets and opens a "Version Contracts" PR.

```yaml
name: Version Contracts

on:
  push:
    branches: [main]
    paths:
      - '.contractual/changesets/**'

permissions:
  contents: write
  pull-requests: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: codotech/contractual-action@v0.1.0-dev.14
        with:
          mode: release
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `mode` | Yes | — | `pr-check` or `release` |
| `github-token` | No | `${{ github.token }}` | Token for PR comments and commits |
| `fail-on-breaking` | No | `true` | Fail if breaking changes detected |
| `auto-changeset` | No | `true` | Auto-generate changeset if missing |
| `version-pr-title` | No | `chore: version contracts` | Title of the Version PR |
| `version-pr-branch` | No | `contractual/version-contracts` | Branch for the Version PR |
| `anthropic-api-key` | No | — | Reserved; AI features are not implemented |

## Outputs

| Output | Mode | Description |
|--------|------|-------------|
| `has-breaking` | `pr-check` | `'true'` if breaking changes detected |
| `has-changes` | `pr-check` | `'true'` if any spec changes detected |
| `changeset-created` | `pr-check` | `'true'` if a changeset was committed |
| `version-pr-url` | `release` | URL of the Version Contracts PR |

## Permissions

```yaml
permissions:
  contents: write       # Commit changesets and version bumps
  pull-requests: write  # Post PR comments and create Version PR
```

## Documentation

Full documentation at [contractual.dev](https://contractual.dev)

## License

MIT
