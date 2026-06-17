#![allow(clippy::result_large_err)]

use crate::acp::github::{
    check_auth, create_issue as domain_create_issue,
    create_issue_comment as domain_create_issue_comment, get_issue as domain_get_issue,
    is_expected_github_api_error, list_issue_comments as domain_list_issue_comments,
    list_issues as domain_list_issues, search_issues as domain_search_issues,
    toggle_comment_reaction as domain_toggle_comment_reaction,
    toggle_issue_reaction as domain_toggle_issue_reaction, AuthStatus, GitHubComment, GitHubIssue,
    IssueListResult,
};
use crate::commands::observability::{
    capture_unexpected_command_error, unexpected_command_result, CommandResult,
    SerializableCommandError,
};

#[tauri::command]
#[specta::specta]
pub fn check_github_auth() -> AuthStatus {
    check_auth()
}

#[tauri::command]
#[specta::specta]
#[allow(clippy::too_many_arguments)]
pub async fn list_github_issues(
    state: Option<String>,
    labels: Option<String>,
    sort: Option<String>,
    direction: Option<String>,
    page: Option<i32>,
    per_page: Option<i32>,
) -> CommandResult<IssueListResult> {
    match domain_list_issues(state, labels, sort, direction, page, per_page).await {
        Ok(result) => Ok(result),
        Err(error) if is_expected_github_api_error(&error) => {
            Err(SerializableCommandError::expected("list_github_issues", error))
        }
        Err(error) => Err(capture_unexpected_command_error(
            "list_github_issues",
            "Failed to list GitHub issues",
            error,
        )),
    }
}

#[tauri::command]
#[specta::specta]
#[allow(clippy::too_many_arguments)]
pub async fn search_github_issues(
    query: String,
    state: Option<String>,
    labels: Option<String>,
    sort: Option<String>,
    page: Option<i32>,
    per_page: Option<i32>,
) -> CommandResult<IssueListResult> {
    unexpected_command_result(
        "search_github_issues",
        "Failed to search GitHub issues",
        domain_search_issues(query, state, labels, sort, page, per_page).await,
    )
}

#[tauri::command]
#[specta::specta]
pub async fn get_github_issue(number: i32) -> CommandResult<GitHubIssue> {
    unexpected_command_result(
        "get_github_issue",
        "Failed to get GitHub issue",
        domain_get_issue(number).await,
    )
}

#[tauri::command]
#[specta::specta]
pub fn create_github_issue(
    title: String,
    body: String,
    labels: Option<Vec<String>>,
) -> CommandResult<GitHubIssue> {
    unexpected_command_result(
        "create_github_issue",
        "Failed to create GitHub issue",
        domain_create_issue(title, body, labels),
    )
}

#[tauri::command]
#[specta::specta]
pub async fn list_issue_comments(
    number: i32,
    page: Option<i32>,
    per_page: Option<i32>,
) -> CommandResult<Vec<GitHubComment>> {
    unexpected_command_result(
        "list_issue_comments",
        "Failed to list issue comments",
        domain_list_issue_comments(number, page, per_page).await,
    )
}

#[tauri::command]
#[specta::specta]
pub fn create_issue_comment(number: i32, body: String) -> CommandResult<GitHubComment> {
    unexpected_command_result(
        "create_issue_comment",
        "Failed to create issue comment",
        domain_create_issue_comment(number, body),
    )
}

#[tauri::command]
#[specta::specta]
pub fn toggle_issue_reaction(number: i32, content: String) -> CommandResult<bool> {
    unexpected_command_result(
        "toggle_issue_reaction",
        "Failed to toggle issue reaction",
        domain_toggle_issue_reaction(number, content),
    )
}

#[tauri::command]
#[specta::specta]
pub fn toggle_comment_reaction(comment_id: i64, content: String) -> CommandResult<bool> {
    unexpected_command_result(
        "toggle_comment_reaction",
        "Failed to toggle comment reaction",
        domain_toggle_comment_reaction(comment_id, content),
    )
}
