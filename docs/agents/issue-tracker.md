# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues on `flazouh/acepe`. Use the `gh` CLI for all operations. (`gh` resolves the repo correctly despite the `github.com-personal` SSH host alias in the remote.)

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v` — `gh` does this automatically when run inside a clone.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Wayfinding operations

Wayfinder maps and tickets are GitHub issues in `flazouh/acepe`:

- Map label: `wayfinder:map`
- Ticket type labels: `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, `wayfinder:task`
- Claim label: `wayfinder:claimed`

The installed `gh` version does not expose GitHub's relationship flags, so use the REST API for native sub-issues and dependencies. These endpoints require the issue's integer database `id`, not its issue number or GraphQL node id.

### Add an existing issue as a child of a map

```bash
CHILD_ID=$(gh api repos/flazouh/acepe/issues/<child-number> --jq .id)
gh api --method POST \
  -H 'Accept: application/vnd.github+json' \
  -H 'X-GitHub-Api-Version: 2026-03-10' \
  repos/flazouh/acepe/issues/<map-number>/sub_issues \
  -F sub_issue_id="$CHILD_ID"
```

List a map's children:

```bash
gh api repos/flazouh/acepe/issues/<map-number>/sub_issues \
  --paginate --jq '.[] | {number, title, state, labels: [.labels[].name]}'
```

### Add a blocking dependency

To say `<blocked-number>` cannot proceed until `<blocker-number>` closes:

```bash
BLOCKER_ID=$(gh api repos/flazouh/acepe/issues/<blocker-number> --jq .id)
gh api --method POST \
  -H 'Accept: application/vnd.github+json' \
  -H 'X-GitHub-Api-Version: 2026-03-10' \
  repos/flazouh/acepe/issues/<blocked-number>/dependencies/blocked_by \
  -F issue_id="$BLOCKER_ID"
```

List blockers:

```bash
gh api repos/flazouh/acepe/issues/<issue-number>/dependencies/blocked_by \
  --jq '.[] | {number, title, state}'
```

An open child is on the **frontier** when its `blocked_by` list has no open issue and it does not have the `wayfinder:claimed` label. Claim it before reading deeply or starting work:

```bash
gh issue edit <ticket-number> --repo flazouh/acepe --add-label wayfinder:claimed
```

Re-read the issue and labels immediately after claiming because concurrent sessions may update the map.
