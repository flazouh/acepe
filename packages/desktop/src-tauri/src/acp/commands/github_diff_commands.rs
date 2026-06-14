#![allow(clippy::result_large_err)]

use std::path::Path;

use crate::acp::github::{
    fetch_commit_diff as domain_fetch_commit_diff, fetch_pr_diff as domain_fetch_pr_diff,
    fetch_working_file_diff, get_repo_context, list_pull_requests as domain_list_pull_requests,
    CommitDiff, FileDiff, PrDiff, PrListItem, RepoContext,
};
use crate::commands::observability::{
    capture_unexpected_command_error, unexpected_command_result, CommandResult,
    SerializableCommandError,
};
use crate::path_safety::validate_project_directory_from_str;

#[tauri::command]
#[specta::specta]
pub fn get_github_repo_context(project_path: String) -> CommandResult<RepoContext> {
    unexpected_command_result(
        "get_github_repo_context",
        "Failed to get GitHub repository context",
        get_repo_context(Path::new(&project_path)),
    )
}

#[tauri::command]
#[specta::specta]
pub fn fetch_commit_diff(
    sha: String,
    project_path: String,
    repo_context: Option<RepoContext>,
) -> CommandResult<CommitDiff> {
    unexpected_command_result(
        "fetch_commit_diff",
        "Failed to fetch commit diff",
        domain_fetch_commit_diff(
            &sha,
            Path::new(&project_path),
            repo_context.as_ref(),
        ),
    )
}

#[tauri::command]
#[specta::specta]
pub fn git_working_file_diff(
    project_path: String,
    file_path: String,
    staged: bool,
    status: String,
    additions: i32,
    deletions: i32,
) -> CommandResult<FileDiff> {
    unexpected_command_result(
        "git_working_file_diff",
        "Failed to fetch working file diff",
        (|| {
            let project_path = validate_project_directory_from_str(&project_path)
                .map_err(|error| error.message_for(Path::new(&project_path)))?;
            fetch_working_file_diff(
                &project_path,
                &file_path,
                staged,
                &status,
                additions,
                deletions,
            )
        })(),
    )
}

#[tauri::command]
#[specta::specta]
pub fn fetch_pr_diff(owner: String, repo: String, pr_number: i32) -> CommandResult<PrDiff> {
    match domain_fetch_pr_diff(owner, repo, pr_number) {
        Ok(diff) => Ok(diff),
        Err(error) if error == "PR not found" => Err(SerializableCommandError::expected(
            "fetch_pr_diff",
            error,
        )),
        Err(error) => Err(capture_unexpected_command_error(
            "fetch_pr_diff",
            "Failed to fetch PR diff",
            error,
        )),
    }
}

#[tauri::command]
#[specta::specta]
pub fn list_pull_requests(
    owner: String,
    repo: String,
    state: String,
    limit: i32,
) -> CommandResult<Vec<PrListItem>> {
    unexpected_command_result(
        "list_pull_requests",
        "Failed to list pull requests",
        domain_list_pull_requests(owner, repo, state, limit),
    )
}
