use serde::{Deserialize, Serialize};

/// Repository context extracted from .git/config
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "serde", rename_all = "camelCase")]
pub struct RepoContext {
    pub owner: String,
    pub repo: String,
    pub remote_url: String,
}

/// Single file diff in a commit or PR
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "serde", rename_all = "camelCase")]
pub struct FileDiff {
    pub path: String,
    pub status: String,
    pub additions: i32,
    pub deletions: i32,
    pub patch: String,
}

/// Complete diff for a commit
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "serde", rename_all = "camelCase")]
pub struct CommitDiff {
    pub sha: String,
    pub short_sha: String,
    pub message: String,
    pub message_body: Option<String>,
    pub author: String,
    pub author_email: String,
    pub date: String,
    pub files: Vec<FileDiff>,
    pub repo_context: Option<RepoContext>,
}

/// Summary entry for a pull request in a listing
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "serde", rename_all = "camelCase")]
pub struct PrListItem {
    pub number: i32,
    pub title: String,
    pub author: String,
    pub state: String,
    pub head_ref: String,
    pub base_ref: String,
    pub updated_at: String,
    pub additions: i32,
    pub deletions: i32,
    pub changed_files: i32,
}

/// PR metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "serde", rename_all = "camelCase")]
pub struct PrMetadata {
    pub number: i32,
    pub title: String,
    pub author: String,
    pub state: String,
    pub description: Option<String>,
}

/// Complete diff for a PR
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "serde", rename_all = "camelCase")]
pub struct PrDiff {
    pub pr: PrMetadata,
    pub files: Vec<FileDiff>,
    pub repo_context: RepoContext,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "serde", rename_all = "camelCase")]
pub struct AuthStatus {
    pub authenticated: bool,
    pub username: Option<String>,
    pub gh_installed: bool,
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
pub struct GitHubLabel {
    pub name: String,
    pub color: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "serde", rename_all = "camelCase")]
pub struct GitHubReactions {
    pub plus1: i32,
    pub minus1: i32,
    pub heart: i32,
    pub rocket: i32,
    pub eyes: i32,
    pub total_count: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "serde", rename_all = "camelCase")]
pub struct GitHubIssue {
    pub number: i32,
    pub title: String,
    pub body: String,
    pub state: String,
    pub labels: Vec<GitHubLabel>,
    pub author: GitHubUser,
    pub comments_count: i32,
    pub reactions: GitHubReactions,
    pub created_at: String,
    pub updated_at: String,
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
    pub total_count: Option<i32>,
    pub has_next_page: bool,
}
