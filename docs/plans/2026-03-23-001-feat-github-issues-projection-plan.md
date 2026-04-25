---
title: "feat: Replace Bug Reports with GitHub Issues Projection"
type: feat
status: active
date: 2026-03-23
deepened: 2026-03-23
---

# Replace Bug Reports with GitHub Issues Projection

## Enhancement Summary

**Deepened on:** 2026-03-23
**Research agents used:** GitHub REST API docs, gh CLI auth patterns, TanStack Query + Tauri invoke, Edge case reviewer

### Key Improvements
1. Dual-mode API: `gh api` for authenticated users, direct `reqwest` for unauthenticated reads (gh api always requires auth)
2. PR filtering — `/repos/{owner}/{repo}/issues` returns both issues AND PRs, must filter by `pull_request` field
3. Dual endpoint strategy — list endpoint for browsing, search endpoint (`/search/issues`) for text search
4. Command injection safety — pipe user content via stdin, never as CLI args
5. Search API rate limit awareness — 30 req/min (vs 5000/hr for core API)

### New Considerations Discovered
- `gh api` **cannot** make unauthenticated requests, even for public repos — need `reqwest` fallback
- Reactions are returned inline on issue objects (no extra API call for counts)
- `--paginate` flag doesn't work with search endpoint (returns wrapper objects, not items)
- Toggle reactions requires knowing the `reaction_id` — need GET first, then DELETE
- GitHub comments are flat (no threading) — simplifies our UI

---

## Overview

Replace the custom `@acepe/api` bug report system (backed by acepe.dev) with a GitHub Issues projection for `flazouh/acepe`. The UI stays in-app but all data comes from and writes to GitHub Issues via Tauri Rust commands.

## Problem Statement

The app is now open source. Maintaining a separate bug report backend is unnecessary when GitHub Issues provides the same functionality with better visibility for the community.

## Proposed Solution

1. **New Rust module** `github_issues.rs` with Tauri commands — `gh api` for authenticated, `reqwest` for unauthenticated reads
2. **Adapt UI components** to consume GitHub issue data via `invoke()` instead of `ApiClient`
3. **Delete `@acepe/api`** package and website API routes entirely
4. **Map GitHub labels → categories**, GitHub states → statuses, reactions → votes

## Acceptance Criteria

- [ ] List issues with pagination, label filtering, state filtering, search, and sorting
- [ ] View issue detail with body (rendered markdown) and comments
- [ ] Create new issues with title, body, and label (category)
- [ ] Add comments to issues
- [ ] React to issues and comments (thumbs up/down)
- [ ] "Open on GitHub" link on every issue/comment
- [ ] `@acepe/api` package deleted
- [ ] Website API routes for reports deleted
- [ ] Works with user's existing `gh auth login` (no separate token setup needed)
- [ ] Graceful degradation when `gh` not installed or not authenticated (read-only mode via reqwest)
- [ ] Pull requests filtered out from issue list

---

## Implementation Plan

### Phase 1: Rust Backend — `github_issues.rs`

Create `/packages/desktop/src-tauri/src/acp/github_issues.rs`

Follow the exact pattern from `github_commands.rs`: `#[tauri::command] #[specta::specta]`, `Result<T, String>`, `Command::new("gh")`.

#### Data Structures

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "serde", rename_all = "camelCase")]
pub struct GitHubIssue {
    pub number: i32,
    pub title: String,
    pub body: String,
    pub state: String,                    // "open" | "closed"
    pub labels: Vec<GitHubLabel>,
    pub author: GitHubUser,
    pub comments_count: i32,
    pub reactions: GitHubReactions,        // inline reaction counts
    pub created_at: String,
    pub updated_at: String,
    pub html_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "serde", rename_all = "camelCase")]
pub struct GitHubReactions {
    pub plus1: i32,       // +1
    pub minus1: i32,      // -1
    pub heart: i32,
    pub rocket: i32,
    pub eyes: i32,
    pub total_count: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "serde", rename_all = "camelCase")]
pub struct GitHubLabel {
    pub name: String,
    pub color: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "serde", rename_all = "camelCase")]
pub struct GitHubUser {
    pub login: String,
    pub avatar_url: String,
    pub html_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "serde", rename_all = "camelCase")]
pub struct GitHubComment {
    pub id: i64,
    pub body: String,
    pub author: GitHubUser,
    pub reactions: GitHubReactions,
    pub created_at: String,
    pub updated_at: String,
    pub html_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "serde", rename_all = "camelCase")]
pub struct IssueListResult {
    pub items: Vec<GitHubIssue>,
    pub total_count: Option<i32>,  // only available from search endpoint
    pub has_next_page: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "serde", rename_all = "camelCase")]
pub struct AuthStatus {
    pub authenticated: bool,
    pub username: Option<String>,
    pub gh_installed: bool,
}
```

#### Research Insights: Dual API Strategy

**Critical finding:** `gh api` always requires authentication — it refuses to run without a configured token. For a public repo, unauthenticated reads must use direct HTTP (`reqwest`, already a dependency in Cargo.toml).

**Strategy:**
1. On modal open, check auth via `gh auth status --json hosts` (or `gh auth token`)
2. If authenticated → use `gh api` for all operations (5,000 req/hr)
3. If not authenticated → use `reqwest` GET to `https://api.github.com/repos/...` for reads (60 req/hr), disable write features
4. If `gh` not installed → same as unauthenticated, pure `reqwest` reads

```rust
/// Check if gh CLI is installed and authenticated
fn check_gh_auth() -> AuthStatus {
    // 1. Check gh installed
    let gh_check = Command::new("gh").arg("--version").output();
    if gh_check.is_err() {
        return AuthStatus { authenticated: false, username: None, gh_installed: false };
    }

    // 2. Check auth status - use gh auth token (simplest, outputs raw token or fails)
    let auth_check = Command::new("gh").args(["auth", "token"]).output();
    match auth_check {
        Ok(output) if output.status.success() => {
            // Get username
            let user_output = Command::new("gh").args(["api", "user", "--jq", ".login"]).output();
            let username = user_output.ok()
                .filter(|o| o.status.success())
                .and_then(|o| String::from_utf8(o.stdout).ok())
                .map(|s| s.trim().to_string());
            AuthStatus { authenticated: true, username, gh_installed: true }
        }
        _ => AuthStatus { authenticated: false, username: None, gh_installed: true },
    }
}

/// Fallback: direct HTTP for unauthenticated public repo reads
async fn fetch_issues_unauthenticated(
    owner: &str, repo: &str, query_params: &str
) -> Result<Vec<serde_json::Value>, String> {
    let client = reqwest::Client::new();
    let url = format!("https://api.github.com/repos/{}/{}/issues?{}", owner, repo, query_params);
    let resp = client.get(&url)
        .header("User-Agent", "acepe-desktop")
        .header("Accept", "application/vnd.github+json")
        .send().await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("GitHub API error: {}", resp.status()));
    }

    resp.json().await.map_err(|e| format!("JSON parse failed: {}", e))
}
```

#### Research Insights: PR Filtering

The `/repos/{owner}/{repo}/issues` endpoint returns **both issues AND pull requests**. PRs have a `pull_request` field present. Filter in Rust before returning to frontend:

```rust
// After parsing JSON array from gh api
let issues: Vec<GitHubIssue> = raw_items.iter()
    .filter(|item| item.get("pull_request").is_none())  // exclude PRs
    .filter_map(|item| parse_issue(item))
    .collect();
```

**Important:** This means a page of 30 results might yield fewer after filtering. If heavily PR-laden, consider using the search endpoint with `is:issue` qualifier instead.

#### Research Insights: Dual Endpoint Strategy

| Scenario | Endpoint | Reason |
|----------|----------|--------|
| Default browse (no search text) | `GET /repos/{owner}/{repo}/issues` | Simpler, no rate limit concerns, supports state/label/sort |
| User types search query | `GET /search/issues?q=repo:flazouh/acepe+is:issue+{term}` | Only way to do text search |
| Sort by reactions | `GET /search/issues?q=repo:flazouh/acepe+is:issue&sort=reactions-+1` | List endpoint has no reaction sort |

**Search API rate limit:** 30 req/min (authenticated), 10 req/min (unauthenticated). Debounce search input by 400ms minimum.

**Pagination difference:**
- List endpoint: no `total_count`, use `Link: rel="next"` header (absent = last page)
- Search endpoint: returns `total_count` and `items[]`, capped at 1000 results

#### Commands

| Command | Args | Returns | Notes |
|---------|------|---------|-------|
| `check_github_auth` | — | `AuthStatus` | Check gh installed + authenticated |
| `list_github_issues` | owner, repo, state?, labels?, sort?, direction?, page?, per_page? | `IssueListResult` | Uses list endpoint, filters out PRs |
| `search_github_issues` | owner, repo, query, sort?, page?, per_page? | `IssueListResult` | Uses search endpoint with `is:issue` |
| `get_github_issue` | owner, repo, number | `GitHubIssue` | Single issue detail |
| `create_github_issue` | owner, repo, title, body, labels? | `GitHubIssue` | Requires auth |
| `list_issue_comments` | owner, repo, number, page?, per_page? | `Vec<GitHubComment>` | Paginated |
| `create_issue_comment` | owner, repo, number, body | `GitHubComment` | Requires auth |
| `toggle_issue_reaction` | owner, repo, number, content | `bool` | Requires auth. GET reactions → check if exists → POST or DELETE |
| `toggle_comment_reaction` | owner, repo, comment_id, content | `bool` | Same pattern |

#### Research Insights: Command Injection Safety

**Never** pass user-supplied text (issue title, body, comment) as CLI arguments. Use stdin piping instead:

```rust
// SAFE: pipe body content via stdin
let mut child = Command::new("gh")
    .args(["api", &format!("repos/{}/{}/issues", owner, repo),
           "-X", "POST",
           "-f", &format!("title={}", title),  // title is short, but still prefer stdin for body
           "--input", "-"])
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .spawn()
    .map_err(|e| format!("Failed to spawn gh: {}", e))?;

// Write JSON body to stdin
let body_json = serde_json::json!({ "title": title, "body": body, "labels": labels });
child.stdin.take().unwrap().write_all(body_json.to_string().as_bytes())
    .map_err(|e| format!("Failed to write to stdin: {}", e))?;

let output = child.wait_with_output()
    .map_err(|e| format!("gh command failed: {}", e))?;
```

**Rust's `Command::arg()` does NOT spawn a shell** — so shell metacharacters are safe. But `gh api -f` can still misinterpret values starting with `@` (file reference) or `-`. Using `--input -` with JSON via stdin is the safest approach for bodies.

#### Research Insights: Reaction Toggle Flow

Reactions are **idempotent on POST** (returns 200 with existing reaction if already created). But to remove, you need the `reaction_id`:

```rust
fn toggle_reaction(owner: &str, repo: &str, issue_number: i32, content: &str) -> Result<bool, String> {
    // 1. List current user's reactions on this issue
    let reactions_output = Command::new("gh")
        .args(["api", &format!("repos/{}/{}/issues/{}/reactions", owner, repo, issue_number),
               "--jq", &format!("[.[] | select(.content == \"{}\")]", content)])
        .output()?;
    let reactions: Vec<serde_json::Value> = serde_json::from_slice(&reactions_output.stdout)?;

    // 2. Find if current user already reacted (gh api uses authenticated user)
    // The API returns all reactions; filter by checking if any exist from POST idempotency
    if let Some(existing) = reactions.first() {
        // Remove: DELETE with reaction_id
        let reaction_id = existing["id"].as_i64().unwrap();
        Command::new("gh")
            .args(["api", "--method", "DELETE",
                   &format!("repos/{}/{}/issues/{}/reactions/{}", owner, repo, issue_number, reaction_id)])
            .output()?;
        Ok(false) // removed
    } else {
        // Add: POST (idempotent)
        Command::new("gh")
            .args(["api", &format!("repos/{}/{}/issues/{}/reactions", owner, repo, issue_number),
                   "-f", &format!("content={}", content)])
            .output()?;
        Ok(true) // added
    }
}
```

**Valid reaction content values:** `+1`, `-1`, `laugh`, `confused`, `heart`, `hooray`, `rocket`, `eyes`

#### Research Insights: Error Handling

`gh api` error detection:
- Exit code 4 → auth required (but unreliable — sometimes returns 1 for HTTP 401)
- Parse stderr for `HTTP 401` (bad credentials), `HTTP 403` (rate limit), `HTTP 404` (not found)
- Check stderr for `rate limit` substring for rate limiting specifically

```rust
fn parse_gh_error(output: &Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr);
    if stderr.contains("HTTP 401") || output.status.code() == Some(4) {
        "GitHub authentication required. Run 'gh auth login' to authenticate.".to_string()
    } else if stderr.contains("rate limit") || stderr.contains("HTTP 403") {
        "GitHub API rate limit exceeded. Please try again later.".to_string()
    } else if stderr.contains("HTTP 404") {
        "Repository not found.".to_string()
    } else {
        format!("GitHub API error: {}", stderr.trim())
    }
}
```

#### Registration in `lib.rs`

Add imports and register all commands in `tauri::generate_handler![]`:

```rust
use acp::github_issues::{
    check_github_auth, list_github_issues, search_github_issues,
    get_github_issue, create_github_issue, list_issue_comments,
    create_issue_comment, toggle_issue_reaction, toggle_comment_reaction,
};
```

---

### Phase 2: Gut `@acepe/api` Package

#### Delete

- `packages/api/` — entire directory
- `packages/website/src/routes/api/reports/` — all API route handlers (8 files)

#### Remove dependency references

- `packages/desktop/package.json` — remove `@acepe/api` from dependencies
- `packages/ui/package.json` — remove `@acepe/api` from dependencies
- `packages/website/package.json` — remove `@acepe/api` from dependencies
- Root `package.json` or workspace config if referencing it

---

### Phase 3: Define Local Types in UI Package

Replace `@acepe/api` type imports with local types in `packages/ui/src/components/user-reports/types.ts`:

```typescript
// Maps to GitHub labels
export type IssueCategory = 'bug' | 'enhancement' | 'question' | 'discussion';

// Maps to GitHub issue state
export type IssueState = 'open' | 'closed';

export interface GitHubReactions {
  plus1: number;
  minus1: number;
  heart: number;
  rocket: number;
  eyes: number;
  totalCount: number;
}

export interface GitHubUser {
  login: string;
  avatarUrl: string;
  htmlUrl: string;
}

export interface GitHubLabel {
  name: string;
  color: string;
  description?: string;
}

// GitHub issue shape (from Tauri invoke)
export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  state: IssueState;
  labels: GitHubLabel[];
  author: GitHubUser;
  commentsCount: number;
  reactions: GitHubReactions;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
}

export interface GitHubComment {
  id: number;
  body: string;
  author: GitHubUser;
  reactions: GitHubReactions;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
}

export interface IssueListResult {
  items: GitHubIssue[];
  totalCount?: number;
  hasNextPage: boolean;
}

export interface AuthStatus {
  authenticated: boolean;
  username?: string;
  ghInstalled: boolean;
}
```

**Label → Category mapping:**

| GitHub Label | Display | Icon |
|---|---|---|
| `bug` | Bug | Bug |
| `enhancement` | Feature | Lightbulb |
| `question` | Question | Question |
| `discussion` | Discussion | ChatCircle |
| *(unlabeled)* | — | *(no badge, show as uncategorized)* |
| *(unknown label)* | *(raw label name)* | Tag |

**Research insight:** Issues with zero labels need a default/uncategorized handling. Issues with multiple category labels should show all matching badges. Unknown labels render with their raw name and GitHub color.

Keep `CATEGORY_CONFIG` but adapt keys to GitHub label names. Replace `STATUS_CONFIG` with simple open/closed.

---

### Phase 4: Adapt UI Components

#### Research Insights: TanStack Query + Tauri Patterns

Tauri's `invoke()` returns a Promise and **throws on `Err`** — this maps perfectly to TanStack Query's `queryFn` (which expects thrown errors).

**Query key factory:**
```typescript
export const issueKeys = {
  all: ['github-issues'] as const,
  auth: () => [...issueKeys.all, 'auth'] as const,
  list: (params: { state?: string; labels?: string; sort?: string; page?: number; search?: string }) =>
    [...issueKeys.all, 'list', params] as const,
  detail: (number: number) => [...issueKeys.all, 'detail', number] as const,
  comments: (number: number, page?: number) => [...issueKeys.all, 'comments', number, page] as const,
};
```

**Recommended staleTime values:**
| Data | staleTime | Reason |
|------|-----------|--------|
| Auth status | `Infinity` | Doesn't change during session; re-check on modal open |
| Issue list | `60_000` (1 min) | Reasonable freshness for browsing |
| Issue detail | `60_000` (1 min) | Same |
| Comments | `30_000` (30s) | Comments update more frequently |

**Mutation pattern** — simple invalidation (no optimistic updates needed since `gh api` calls are network-bound, not instant IPC):
```typescript
const createIssueMutation = createMutation(() => ({
  mutationFn: (args: { title: string; body: string; labels?: string[] }) =>
    invoke('create_github_issue', { owner, repo, ...args }),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: issueKeys.all });
  },
}));
```

#### Container (`user-reports-container.svelte`)

Replace `createApiClient()` entirely. Pass hardcoded `owner="flazouh"` and `repo="acepe"` down. Check auth status on mount.

```svelte
<script lang="ts">
  import { invoke } from '$lib/utils/tauri-commands.js';
  import { UserReportsModal } from '@acepe/ui/user-reports';
  import type { AuthStatus } from '@acepe/ui/user-reports';

  interface Props { open: boolean; onClose: () => void; }
  let { open, onClose }: Props = $props();

  const OWNER = 'flazouh';
  const REPO = 'acepe';
</script>

<UserReportsModal {open} owner={OWNER} repo={REPO} {onClose} />
```

#### Modal (`user-reports-modal.svelte`)

- Replace `apiClient: ApiClient` prop with `owner: string, repo: string`
- Check auth on mount via `createQuery(() => ({ queryKey: issueKeys.auth(), queryFn: () => invoke('check_github_auth') }))`
- Pass `authStatus` to child components to conditionally disable write features
- Simplify status filter: just "Open" / "Closed" (from 7 statuses to 2)
- Sort options: "Newest" (created desc), "Recently updated" (updated desc), "Most commented" (comments desc)
- When search text is entered, switch from list endpoint to search endpoint (debounce 400ms)

#### List (`user-reports-list.svelte`)

- Use `list_github_issues` for default browsing, `search_github_issues` when search text present
- TanStack Query key: `issueKeys.list({ state, labels, sort, page, search })`
- **Debounce search**: 400ms to avoid burning search API rate limit (30/min)
- Pagination: "Next" / "Prev" buttons based on `hasNextPage`

#### List Item (`user-reports-list-item.svelte`)

- Replace `ReportOutput` prop with `GitHubIssue`
- Show `reactions.plus1` count (thumbs up) as primary indicator
- Show all labels as colored badges (using GitHub label color)
- Show issue number (e.g., `#42`)
- Author avatar + login

#### Detail (`user-reports-detail.svelte`)

- Fetch issue: `invoke('get_github_issue', { owner, repo, number })`
- Fetch comments: `invoke('list_issue_comments', { owner, repo, number })`
- **Render issue body as markdown** — reuse existing markdown renderer from agent panel
- Add "Open on GitHub" button linking to `htmlUrl`
- Show full reaction bar (not just thumbs up) — all 8 reaction types
- Remove follow/unfollow (not a GitHub concept)
- If not authenticated, hide comment form and show "Sign in to comment" prompt

#### Create (`user-reports-create.svelte`)

- `invoke('create_github_issue', { owner, repo, title, body, labels: [category] })`
- Keep title + body + category selector
- On success, navigate to detail view with returned issue number
- If not authenticated, show auth prompt instead of form

#### Vote Button (`user-reports-vote-button.svelte`)

- Show reaction summary (thumbs up count prominently, other reactions as small icons if non-zero)
- Click thumbs up/down calls `invoke('toggle_issue_reaction', { owner, repo, number, content: '+1' })`
- Disable reaction buttons if not authenticated

#### Comments (`user-reports-comment-list.svelte`, `user-reports-comment.svelte`)

- GitHub comments are **flat** (no nesting) — remove reply threading, simplify to linear list
- Each comment shows author avatar, login, relative time, body (rendered markdown), reaction counts
- "Open on GitHub" link per comment
- Comment form at bottom calls `invoke('create_issue_comment', { owner, repo, number, body })`

#### Remove

- `user-reports-sidebar.svelte` — not needed
- `user-reports-status-badge.svelte` — replace with simple open/closed indicator (dot + text)

---

### Phase 5: Handle Auth State

#### Research Insights: Auth Flow

1. **On modal open**: call `check_github_auth` Tauri command
2. **If `gh` not installed**: `ghInstalled: false`
   - Show all issues read-only via `reqwest` (60 req/hr unauthenticated)
   - Show banner: "Install GitHub CLI for full features" with link to https://cli.github.com
3. **If `gh` installed but not authenticated**: `ghInstalled: true, authenticated: false`
   - Show issues read-only via `reqwest`
   - Show banner: "Sign in to GitHub to create issues and comment"
   - "Sign in" button runs `gh auth login --web --hostname github.com --git-protocol https` with `GH_FORCE_TTY=1`
   - After login completes, re-check auth and refresh queries
4. **If authenticated**: `authenticated: true, username: "..."
   - Full CRUD via `gh api`
   - Show username in header

**UI states:**
- Write features (create issue, comment, react) → disabled when not authenticated, show tooltip explaining why
- Read features (browse, search, view) → always available

#### Research Insights: Rate Limiting

| API | Authenticated | Unauthenticated |
|-----|--------------|-----------------|
| Core (list, get, comments) | 5,000/hr | 60/hr |
| Search | 30/min | 10/min |

**Mitigation:**
- Cache with TanStack Query staleTime (issues don't change frequently)
- Debounce search input by 400ms
- On 403 rate limit response, show "Rate limit reached, try again in X seconds" using `X-Ratelimit-Reset` header
- For unauthenticated users (60/hr), show a gentle "Sign in for faster browsing" prompt after 30 requests

---

## Files Changed Summary

### New
- `packages/desktop/src-tauri/src/acp/github_issues.rs`

### Modified
- `packages/desktop/src-tauri/src/acp/mod.rs` — add `pub mod github_issues;`
- `packages/desktop/src-tauri/src/lib.rs` — import + register commands
- `packages/ui/src/components/user-reports/types.ts` — local GitHub types
- `packages/ui/src/components/user-reports/user-reports-modal.svelte`
- `packages/ui/src/components/user-reports/user-reports-list.svelte`
- `packages/ui/src/components/user-reports/user-reports-list-item.svelte`
- `packages/ui/src/components/user-reports/user-reports-detail.svelte`
- `packages/ui/src/components/user-reports/user-reports-create.svelte`
- `packages/ui/src/components/user-reports/user-reports-vote-button.svelte`
- `packages/ui/src/components/user-reports/user-reports-comment-list.svelte`
- `packages/ui/src/components/user-reports/user-reports-comment.svelte`
- `packages/ui/src/components/user-reports/user-reports-comment-form.svelte`
- `packages/desktop/src/lib/components/user-reports/user-reports-container.svelte`
- `packages/ui/src/components/user-reports/index.ts`
- `packages/desktop/package.json` — remove @acepe/api dep
- `packages/ui/package.json` — remove @acepe/api dep

### Deleted
- `packages/api/` — entire directory
- `packages/website/src/routes/api/reports/` — entire directory
- `packages/ui/src/components/user-reports/user-reports-sidebar.svelte`

## Known Limitations (v1)

- No editing of own issues/comments (users can edit on GitHub directly via "Open on GitHub" link)
- No closing issues from the app (can be added later)
- No "report from session" pre-fill with context (good future feature — pre-fill body with OS info, model, error logs)
- Search capped at 1000 results (GitHub API limitation)

## Sources

- Existing pattern: `packages/desktop/src-tauri/src/acp/github_commands.rs`
- [GitHub REST API: Issues](https://docs.github.com/en/rest/issues/issues)
- [GitHub REST API: Reactions](https://docs.github.com/en/rest/reactions/reactions)
- [GitHub REST API: Search Issues](https://docs.github.com/en/rest/search/search)
- [GitHub REST API: Rate Limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
- [gh api manual](https://cli.github.com/manual/gh_api)
- [gh auth manual](https://cli.github.com/manual/gh_auth_status)
- [TanStack Svelte Query v6](https://tanstack.com/query/latest/docs/framework/svelte/overview)
- Target repo: `flazouh/acepe`
