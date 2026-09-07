# Unswell GitHub Action

Check English prose in comments, strings and documents with
[Unswell](https://github.com/stokaro/unswell). Its main purpose is to reduce
AI-style wording and keep formulaic AI phrases out of code and documentation.
The tool reports editorial findings; it does not identify who wrote the text.

The action downloads an exact Unswell release, verifies its archive against the
published SHA-256 manifest, then runs the offline CLI. Linux, macOS and Windows
are supported on AMD64 and ARM64. No API key or model service is needed.

The first alpha is published as `v0.1.0-alpha.1`. The current CLI default is
recorded in [action.yml](action.yml). [Public release checks](https://github.com/stokaro/unswell-action/actions/runs/34134500799)
passed on Linux, macOS and Windows, including policy and parser failures.

## Use the action

```yaml
permissions:
  contents: read

steps:
  - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
  - uses: stokaro/unswell-action@5c4e109d71c1ec16429a62ac1860b97baee3974e # v0.1.0-alpha.1
    id: unswell
    with:
      version: 0.1.0-alpha.1
      config: .unswell.yaml
      paths: |
        README.md
        docs
        src
  - uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
    if: always()
    with:
      name: unswell-reports
      path: |
        ${{ steps.unswell.outputs.report-json }}
        ${{ steps.unswell.outputs.report-sarif }}
```

Keep the action pinned to a reviewed commit for a reproducible workflow. The
`version` input pins the CLI independently of the action's revision. Downloading
the archive and manifest uses HTTPS; the manifest comes from the same Unswell
release and is not an independent signature.

| Input | Default | Meaning |
| --- | --- | --- |
| `version` | See [action.yml](action.yml) | Exact release version; an optional leading `v` is accepted |
| `paths` | `.` | One file or directory per line, relative to the working directory |
| `config` | empty | Explicit policy file; when omitted, normal CLI discovery applies |
| `working-directory` | `.` | Project directory inside the checked-out workspace |

Paths and configuration are passed as separate process arguments. There is no
shell evaluation or free-form extra-arguments input. Blank lines are ignored;
leading and trailing whitespace on each path is trimmed. Names containing newlines
or intentional surrounding whitespace cannot be expressed by this input.

Global context sets, per-language overrides and reasoned exceptions belong in the
Unswell [policy file](https://github.com/stokaro/unswell/blob/main/docs/extraction-policy.md).
The action does not modify policy or source files. A pull request that can edit
its own policy can change what is checked; enforce your repository's review rules
for policy and workflow changes.

## Outcomes and reports

The step passes only when the CLI returns 0. A policy violation returns 1 and
fails the step; an operational failure returns 2 and also fails it. The action
exposes that value as `exit-code`. Cancellation and other abnormal process exits
also fail the step. It never converts incomplete analysis into success.

`report-json` and `report-sarif` point to reports in a fresh runner temporary
directory. They are set only when the files exist. Upload them with `if: always()`
to retain evidence from failed checks. The `version` output records the installed
release. Temporary executable files are removed after the check; reports remain
for later workflow steps.

The action writes SARIF 2.1.0 but does not upload code-scanning results or request
`security-events: write`. A consuming workflow can add its own SARIF upload step.
CLI snippets are kept as log data so source text cannot issue workflow commands.

## Self-checking

CI builds a real Unswell CLI from a pinned public commit and runs the action's
download, checksum, extraction and invocation paths against release-shaped test
archives. It checks clean and bad drafts, malformed C#, YAML, context overrides,
paths with spaces, missing policy files and both report formats. Changed archives,
missing releases and ambiguous manifests must fail before execution.

The `Verify published release` workflow additionally runs this action as a real
consumer on all three operating systems. It downloads the public release, checks
this repository, and requires policy and parser failures to fail their steps with
the expected outputs. CI also calls that workflow with the action default. Before
enabling automatic updates, require all three consumer checks and all three native
test checks in the branch protection settings.

The action has no npm runtime dependencies and uses the Node 24 runner runtime.
To run its integration tests locally, build Unswell first, then set
`UNSWELL_TEST_BINARY` to its absolute executable path and run `npm test`.

## Automated release updates

A successful Unswell release requests an update through `repository_dispatch`.
The `Update default release` workflow also accepts a published tag manually.
It verifies all six archive checksums, updates `action.yml`, `package.json`, and
`src/default-version.mjs`, then creates a PR through the publish app. Repeating
an update reuses its branch only if its files still match the expected output.
Changes to other files or a PR owned by someone else stop the update.

Once the setup below is complete, GitHub merges the PR after the six required
checks pass. Grant the publish app a review exception on main; other authors must
still receive an approving review.
A successful main-branch CI run publishes an exact version tag and GitHub release.
Existing tags are preserved, including the original alpha tag. Consumers should
continue to pin the action commit independently of the CLI version.

Setup requires organization variable `PUBLISH_APP_ID` and secret `PUBLISH_APP_KEY`
to be available to this repository. The installed app needs Contents and Pull
requests write access. Repository auto-merge must be enabled, and only that app
belongs in main's review bypass list. Required tests, conversation resolution,
and the restrictions on force pushes and branch deletion remain enabled.
GitHub Actions does not need permission to approve pull requests.
