//! Git panel operations: stage, unstage, commit, push, pull, fetch, stash, log.
//!
//! Uses `git2` crate for local operations and `git` CLI for remote/stash operations.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use git2::{IndexAddOption, StatusOptions};
use serde::{Deserialize, Serialize};
use tokio::process::Command as AsyncCommand;
use tokio::time::{timeout, Duration};

use crate::commands::observability::{
    expected_command_result, unexpected_command_result, CommandResult, SerializableCommandError,
};
use crate::file_index::git::open_repository;
use crate::git::gh_pr;
use crate::path_safety::validate_project_directory_from_str;

// ─── Types ──────────────────────────────────────────────────────────────────

/// Split git status for a file: index (staged) vs worktree (unstaged).
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GitPanelFileStatus {
    pub path: String,
    /// Staged status (index vs HEAD). Null if not staged.
    pub index_status: Option<String>,
    /// Unstaged status (worktree vs index). Null if clean in worktree.
    pub worktree_status: Option<String>,
    pub index_insertions: u64,
    pub index_deletions: u64,
    pub worktree_insertions: u64,
    pub worktree_deletions: u64,
}

/// Result of a commit operation.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CommitResult {
    pub sha: String,
    pub short_sha: String,
}

/// Ahead/behind status relative to upstream tracking branch.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GitRemoteStatus {
    pub ahead: u32,
    pub behind: u32,
    pub remote: String,
    pub tracking_branch: String,
}

/// A stash entry.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GitStashEntry {
    pub index: usize,
    pub message: String,
    pub date: String,
}

/// A commit log entry.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GitLogEntry {
    pub sha: String,
    pub short_sha: String,
    pub message: String,
    pub author: String,
    pub date: String,
}

/// Aggregate diff statistics for uncommitted changes.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffStats {
    pub insertions: u64,
    pub deletions: u64,
    pub files_changed: u64,
}

/// Result of the commit step in a stacked action.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GitStackedCommitStep {
    pub status: String, // "created" | "skipped_no_changes"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit_sha: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subject: Option<String>,
}

/// Result of the push step in a stacked action.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GitStackedPushStep {
    pub status: String, // "pushed" | "skipped_not_requested"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub upstream_branch: Option<String>,
}

/// Result of the PR step in a stacked action.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GitStackedPrStep {
    pub status: String, // "created" | "opened_existing" | "skipped_not_requested"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub number: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub head_branch: Option<String>,
}

/// Result of running a stacked git action (commit → push → optional PR).
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GitStackedActionResult {
    pub action: String,
    pub commit: GitStackedCommitStep,
    pub push: GitStackedPushStep,
    pub pr: GitStackedPrStep,
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/// Run a git CLI command and return stdout on success, stderr on failure.
async fn run_git_command(project_path: &Path, args: &[&str]) -> Result<String, String> {
    let output = AsyncCommand::new("git")
        .args(args)
        .current_dir(project_path)
        .output()
        .await
        .map_err(|e| format!("Failed to run git: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!(
                "git {} failed with exit code {:?}",
                args[0],
                output.status.code()
            )
        } else {
            stderr
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn run_git_command_sync(
    project_path: &Path,
    args: &[&str],
    allow_diff_exit: bool,
) -> Result<String, String> {
    let output = std::process::Command::new("git")
        .args(args)
        .current_dir(project_path)
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;

    if !(output.status.success() || allow_diff_exit && output.status.code() == Some(1)) {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!(
                "git {} failed with exit code {:?}",
                args[0],
                output.status.code()
            )
        } else {
            stderr
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn validate_project_path(project_path: &str) -> Result<PathBuf, String> {
    validate_project_directory_from_str(project_path)
        .map_err(|e| e.message_for(Path::new(project_path.trim())))
}

async fn get_git_remote_status_impl(path: PathBuf) -> Result<GitRemoteStatus, String> {
    tokio::task::spawn_blocking(move || {
        let repo = open_repository(&path).map_err(|e| e.to_string())?;

        let head = repo
            .head()
            .map_err(|e| format!("Failed to get HEAD: {}", e))?;
        let branch_name = head.shorthand().unwrap_or("HEAD").to_string();

        let local_branch = repo
            .find_branch(&branch_name, git2::BranchType::Local)
            .map_err(|e| format!("Failed to find branch: {}", e))?;

        let upstream = match local_branch.upstream() {
            Ok(upstream) => upstream,
            Err(_) => {
                return Ok(GitRemoteStatus {
                    ahead: 0,
                    behind: 0,
                    remote: String::new(),
                    tracking_branch: String::new(),
                });
            }
        };

        let upstream_name = upstream
            .name()
            .map_err(|e| format!("Failed to get upstream name: {}", e))?
            .unwrap_or("")
            .to_string();

        let local_oid = head.target().ok_or("HEAD has no target")?;
        let upstream_oid = upstream.get().target().ok_or("Upstream has no target")?;

        let (ahead, behind) = repo
            .graph_ahead_behind(local_oid, upstream_oid)
            .map_err(|e| format!("Failed to compute ahead/behind: {}", e))?;

        let remote = upstream_name.split('/').next().unwrap_or("").to_string();

        Ok(GitRemoteStatus {
            ahead: ahead as u32,
            behind: behind as u32,
            remote,
            tracking_branch: upstream_name,
        })
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

fn index_status_string(status: git2::Status) -> Option<String> {
    if status.is_index_new() {
        Some("added".to_string())
    } else if status.is_index_modified() {
        Some("modified".to_string())
    } else if status.is_index_deleted() {
        Some("deleted".to_string())
    } else if status.is_index_renamed() {
        Some("renamed".to_string())
    } else {
        None
    }
}

fn worktree_status_string(status: git2::Status) -> Option<String> {
    if status.is_wt_new() {
        Some("untracked".to_string())
    } else if status.is_wt_modified() {
        Some("modified".to_string())
    } else if status.is_wt_deleted() {
        Some("deleted".to_string())
    } else {
        None
    }
}

fn parse_numstat_map(output: &str) -> HashMap<String, (u64, u64)> {
    let mut stats = HashMap::new();

    for line in output.lines() {
        let mut parts = line.splitn(3, '\t');
        let Some(insertions_raw) = parts.next() else {
            continue;
        };
        let Some(deletions_raw) = parts.next() else {
            continue;
        };
        let Some(path) = parts.next() else {
            continue;
        };

        let insertions = insertions_raw.parse::<u64>().unwrap_or(0);
        let deletions = deletions_raw.parse::<u64>().unwrap_or(0);
        stats.insert(path.to_string(), (insertions, deletions));
    }

    stats
}

fn read_numstat_map(
    project_path: &Path,
    args: &[&str],
) -> Result<HashMap<String, (u64, u64)>, String> {
    let output = run_git_command_sync(project_path, args, false)?;
    Ok(parse_numstat_map(&output))
}

fn read_untracked_numstat(project_path: &Path, file_path: &str) -> Result<(u64, u64), String> {
    let output = run_git_command_sync(
        project_path,
        &[
            "diff",
            "--no-index",
            "--numstat",
            "--",
            "/dev/null",
            file_path,
        ],
        true,
    )?;
    Ok(parse_numstat_map(&output)
        .into_iter()
        .next()
        .map(|(_, stats)| stats)
        .unwrap_or((0, 0)))
}

/// Build a PR step from existing open PR info (used for both "opened_existing" and "created").
fn pr_step_from_open_pr(
    status: &str,
    open_pr: &gh_pr::OpenPrInfo,
    base_branch: &str,
    head_branch: &str,
) -> GitStackedPrStep {
    GitStackedPrStep {
        status: status.to_string(),
        url: Some(open_pr.url.clone()),
        number: Some(open_pr.number),
        title: Some(open_pr.title.clone()),
        base_branch: Some(base_branch.to_string()),
        head_branch: Some(head_branch.to_string()),
    }
}

/// Format a git2 `Time` as a relative date string (e.g. "2h ago", "3d ago").
fn format_relative_time(time: &git2::Time) -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let diff = now - time.seconds();

    if diff < 60 {
        "just now".to_string()
    } else if diff < 3600 {
        format!("{}m ago", diff / 60)
    } else if diff < 86400 {
        format!("{}h ago", diff / 3600)
    } else if diff < 604800 {
        format!("{}d ago", diff / 86400)
    } else if diff < 2592000 {
        format!("{}w ago", diff / 604800)
    } else {
        format!("{}mo ago", diff / 2592000)
    }
}

/// Returns true if there are staged changes (tree-to-index diff).
fn has_staged_changes(repo: &git2::Repository) -> Result<bool, String> {
    let head = match repo.head() {
        Ok(h) => h,
        Err(_) => {
            // No HEAD: consider staged if index has any entries
            let index = repo.index().map_err(|e| e.to_string())?;
            return Ok(!index.is_empty());
        }
    };
    let head_commit = head
        .peel_to_commit()
        .map_err(|e| format!("Failed to peel HEAD: {}", e))?;
    let head_tree = head_commit
        .tree()
        .map_err(|e| format!("Failed to get HEAD tree: {}", e))?;
    let diff = repo
        .diff_tree_to_index(Some(&head_tree), None, None)
        .map_err(|e| format!("Failed to diff tree to index: {}", e))?;
    Ok(diff.stats().map_err(|e| e.to_string())?.files_changed() > 0)
}

/// Perform commit of staged changes (sync, run in spawn_blocking).
fn do_commit(path: &Path, message: &str) -> Result<CommitResult, String> {
    let repo = open_repository(path).map_err(|e| e.to_string())?;
    let mut index = repo
        .index()
        .map_err(|e| format!("Failed to get index: {}", e))?;

    let tree_oid = index
        .write_tree()
        .map_err(|e| format!("Failed to write tree: {}", e))?;

    let tree = repo
        .find_tree(tree_oid)
        .map_err(|e| format!("Failed to find tree: {}", e))?;

    let signature = repo.signature().map_err(|e| {
        format!(
            "Failed to get signature (check git config user.name/email): {}",
            e
        )
    })?;

    let parent = match repo.head() {
        Ok(head) => Some(
            head.peel_to_commit()
                .map_err(|e| format!("Failed to peel HEAD to commit: {}", e))?,
        ),
        Err(_) => None,
    };

    let parents: Vec<&git2::Commit> = parent.iter().collect();

    let oid = repo
        .commit(
            Some("HEAD"),
            &signature,
            &signature,
            message,
            &tree,
            &parents,
        )
        .map_err(|e| format!("Failed to commit: {}", e))?;

    let sha = oid.to_string();
    let short_sha = sha[..7.min(sha.len())].to_string();

    Ok(CommitResult { sha, short_sha })
}

// ─── Panel Status ───────────────────────────────────────────────────────────

/// Get git status with split index/worktree status for the git panel.
#[tauri::command]
#[specta::specta]
pub async fn git_panel_status(project_path: String) -> CommandResult<Vec<GitPanelFileStatus>> {
    unexpected_command_result(
        "git_panel_status",
        "Failed to get git panel status",
        async {
            let path = validate_project_path(&project_path)?;

            tokio::task::spawn_blocking(move || {
                let repo = open_repository(&path).map_err(|e| e.to_string())?;
                let staged_stats = read_numstat_map(&path, &["diff", "--cached", "--numstat"])?;
                let unstaged_stats = read_numstat_map(&path, &["diff", "--numstat"])?;

                let mut opts = StatusOptions::new();
                opts.include_untracked(true)
                    .recurse_untracked_dirs(true)
                    .include_ignored(false)
                    .exclude_submodules(true);

                let statuses = repo
                    .statuses(Some(&mut opts))
                    .map_err(|e| format!("Failed to get status: {}", e))?;

                let mut results = Vec::new();

                for entry in statuses.iter() {
                    let status = entry.status();
                    let file_path = entry.path().unwrap_or("").to_string();
                    if file_path.is_empty() {
                        continue;
                    }

                    let idx = index_status_string(status);
                    let wt = worktree_status_string(status);

                    // Skip files with no relevant status
                    if idx.is_none() && wt.is_none() {
                        continue;
                    }

                    let (index_insertions, index_deletions) =
                        staged_stats.get(&file_path).copied().unwrap_or((0, 0));
                    let (worktree_insertions, worktree_deletions) =
                        if wt.as_deref() == Some("untracked") {
                            read_untracked_numstat(&path, &file_path)?
                        } else {
                            unstaged_stats.get(&file_path).copied().unwrap_or((0, 0))
                        };

                    results.push(GitPanelFileStatus {
                        path: file_path,
                        index_status: idx,
                        worktree_status: wt,
                        index_insertions,
                        index_deletions,
                        worktree_insertions,
                        worktree_deletions,
                    });
                }

                Ok(results)
            })
            .await
            .map_err(|e| format!("Task join error: {}", e))?
        }
        .await,
    )
}

// ─── Diff Stats ─────────────────────────────────────────────────────────────

/// Get aggregate diff stats (insertions, deletions, files changed) for all uncommitted changes.
/// Combines both staged and unstaged diffs.
#[tauri::command]
#[specta::specta]
pub async fn git_diff_stats(project_path: String) -> CommandResult<GitDiffStats> {
    unexpected_command_result(
        "git_diff_stats",
        "Failed to get git diff stats",
        async {
            let path = validate_project_path(&project_path)?;

            // Get unstaged diff stats
            let unstaged = run_git_command(&path, &["diff", "--shortstat"])
                .await
                .unwrap_or_default();
            // Get staged diff stats
            let staged = run_git_command(&path, &["diff", "--cached", "--shortstat"])
                .await
                .unwrap_or_default();

            let (u_files, u_ins, u_del) = parse_shortstat(&unstaged);
            let (s_files, s_ins, s_del) = parse_shortstat(&staged);

            Ok(GitDiffStats {
                insertions: u_ins + s_ins,
                deletions: u_del + s_del,
                files_changed: u_files + s_files,
            })
        }
        .await,
    )
}

/// Parse `git diff --shortstat` output like "3 files changed, 10 insertions(+), 5 deletions(-)"
fn parse_shortstat(output: &str) -> (u64, u64, u64) {
    let trimmed = output.trim();
    if trimmed.is_empty() {
        return (0, 0, 0);
    }

    let mut files = 0u64;
    let mut insertions = 0u64;
    let mut deletions = 0u64;

    for part in trimmed.split(',') {
        let part = part.trim();
        if let Some(num_str) = part.split_whitespace().next() {
            if let Ok(num) = num_str.parse::<u64>() {
                if part.contains("file") {
                    files = num;
                } else if part.contains("insertion") {
                    insertions = num;
                } else if part.contains("deletion") {
                    deletions = num;
                }
            }
        }
    }

    (files, insertions, deletions)
}

fn normalize_absolute_repo_path(workdir: &Path, raw_path: &Path) -> Option<PathBuf> {
    if !raw_path.is_absolute() {
        return Some(raw_path.to_path_buf());
    }

    if let Ok(relative_path) = raw_path.strip_prefix(workdir) {
        return Some(relative_path.to_path_buf());
    }

    let canonical_workdir =
        std::fs::canonicalize(workdir).unwrap_or_else(|_| workdir.to_path_buf());

    let candidate_path = if raw_path.exists() {
        std::fs::canonicalize(raw_path).unwrap_or_else(|_| raw_path.to_path_buf())
    } else if let Some(parent) = raw_path.parent() {
        let canonical_parent =
            std::fs::canonicalize(parent).unwrap_or_else(|_| parent.to_path_buf());
        if let Some(file_name) = raw_path.file_name() {
            canonical_parent.join(file_name)
        } else {
            raw_path.to_path_buf()
        }
    } else {
        raw_path.to_path_buf()
    };

    candidate_path
        .strip_prefix(&canonical_workdir)
        .ok()
        .map(Path::to_path_buf)
}

// ─── Stage / Unstage ────────────────────────────────────────────────────────

/// Stage specific files (add to index).
#[tauri::command]
#[specta::specta]
pub async fn git_stage_files(project_path: String, files: Vec<String>) -> CommandResult<()> {
    unexpected_command_result(
        "git_stage_files",
        "Failed to stage files",
        async {
            let path = validate_project_path(&project_path)?;

            tokio::task::spawn_blocking(move || {
                let repo = open_repository(&path).map_err(|e| e.to_string())?;
                let mut index = repo
                    .index()
                    .map_err(|e| format!("Failed to get index: {}", e))?;

                let workdir = repo
                    .workdir()
                    .ok_or("Repository has no working directory")?;

                for file in &files {
                    let raw_path = Path::new(file);

                    let Some(file_path) = normalize_absolute_repo_path(workdir, raw_path) else {
                        continue;
                    };

                    // Check if the file exists on disk
                    let full_path = workdir.join(&file_path);

                    if full_path.exists() {
                        // File exists: add to index (handles both new and modified)
                        index
                            .add_path(&file_path)
                            .map_err(|e| format!("Failed to stage {}: {}", file, e))?;
                    } else {
                        // File doesn't exist: remove from index (deleted file)
                        index
                            .remove_path(&file_path)
                            .map_err(|e| format!("Failed to stage deletion of {}: {}", file, e))?;
                    }
                }

                index
                    .write()
                    .map_err(|e| format!("Failed to write index: {}", e))?;
                Ok(())
            })
            .await
            .map_err(|e| format!("Task join error: {}", e))?
        }
        .await,
    )
}

/// Unstage specific files (reset to HEAD).
#[tauri::command]
#[specta::specta]
pub async fn git_unstage_files(project_path: String, files: Vec<String>) -> CommandResult<()> {
    unexpected_command_result(
        "git_unstage_files",
        "Failed to unstage files",
        async {
            let path = validate_project_path(&project_path)?;

            // Use git CLI for unstaging — simpler and more reliable than git2 index manipulation.
            let mut args = vec!["reset", "HEAD", "--"];
            let file_refs: Vec<&str> = files.iter().map(|s| s.as_str()).collect();
            args.extend(file_refs);

            run_git_command(&path, &args).await?;
            Ok(())
        }
        .await,
    )
}

/// Stage all changes (add all modified + new + deleted files).
#[tauri::command]
#[specta::specta]
pub async fn git_stage_all(project_path: String) -> CommandResult<()> {
    unexpected_command_result(
        "git_stage_all",
        "Failed to stage all files",
        async {
            let path = validate_project_path(&project_path)?;

            tokio::task::spawn_blocking(move || {
                let repo = open_repository(&path).map_err(|e| e.to_string())?;
                let mut index = repo
                    .index()
                    .map_err(|e| format!("Failed to get index: {}", e))?;

                index
                    .add_all(["*"].iter(), IndexAddOption::DEFAULT, None)
                    .map_err(|e| format!("Failed to stage all: {}", e))?;

                // Also handle deleted files: update index to match working directory
                index
                    .update_all(["*"].iter(), None)
                    .map_err(|e| format!("Failed to update index: {}", e))?;

                index
                    .write()
                    .map_err(|e| format!("Failed to write index: {}", e))?;
                Ok(())
            })
            .await
            .map_err(|e| format!("Task join error: {}", e))?
        }
        .await,
    )
}

/// Discard unstaged changes for specific files.
#[tauri::command]
#[specta::specta]
pub async fn git_discard_changes(project_path: String, files: Vec<String>) -> CommandResult<()> {
    unexpected_command_result(
        "git_discard_changes",
        "Failed to discard changes",
        async {
            let path = validate_project_path(&project_path)?;

            // Separate tracked (checkout) from untracked (remove) files
            let repo = tokio::task::spawn_blocking({
                let path = path.clone();
                move || -> Result<(Vec<String>, Vec<String>), String> {
                    let repo = open_repository(&path).map_err(|e| e.to_string())?;
                    let mut opts = StatusOptions::new();
                    opts.include_untracked(true)
                        .include_ignored(false)
                        .exclude_submodules(true);

                    let statuses = repo
                        .statuses(Some(&mut opts))
                        .map_err(|e| format!("Failed to get status: {}", e))?;

                    let mut tracked = Vec::new();
                    let mut untracked = Vec::new();

                    for file in &files {
                        let is_untracked = statuses.iter().any(|entry| {
                            entry.path() == Some(file.as_str()) && entry.status().is_wt_new()
                        });

                        if is_untracked {
                            untracked.push(file.clone());
                        } else {
                            tracked.push(file.clone());
                        }
                    }

                    Ok((tracked, untracked))
                }
            })
            .await
            .map_err(|e| format!("Task join error: {}", e))??;

            let (tracked, untracked) = repo;

            // Restore tracked files from index
            if !tracked.is_empty() {
                let mut args = vec!["checkout", "--"];
                let file_refs: Vec<&str> = tracked.iter().map(|s| s.as_str()).collect();
                args.extend(file_refs);
                run_git_command(&path, &args).await?;
            }

            // Remove untracked files
            for file in &untracked {
                let full_path = path.join(file);
                if full_path.exists() {
                    tokio::fs::remove_file(&full_path)
                        .await
                        .map_err(|e| format!("Failed to remove {}: {}", file, e))?;
                }
            }

            Ok(())
        }
        .await,
    )
}

// ─── Commit ─────────────────────────────────────────────────────────────────

/// Commit staged changes.
#[tauri::command]
#[specta::specta]
pub async fn git_commit(project_path: String, message: String) -> CommandResult<CommitResult> {
    unexpected_command_result(
        "git_commit",
        "Git commit failed",
        async {
            if message.trim().is_empty() {
                return Err("Commit message cannot be empty".to_string());
            }

            let path = validate_project_path(&project_path)?;

            tokio::task::spawn_blocking(move || do_commit(&path, &message))
                .await
                .map_err(|e| format!("Task join error: {}", e))?
        }
        .await,
    )
}

// ─── Remote Operations ──────────────────────────────────────────────────────

/// Push to remote.
#[tauri::command]
#[specta::specta]
pub async fn git_push(project_path: String) -> CommandResult<()> {
    unexpected_command_result(
        "git_push",
        "Git push failed",
        async {
            let path = validate_project_path(&project_path)?;
            run_git_command(&path, &["push"]).await?;
            Ok(())
        }
        .await,
    )
}

/// Pull from remote.
#[tauri::command]
#[specta::specta]
pub async fn git_pull(project_path: String) -> CommandResult<()> {
    unexpected_command_result(
        "git_pull",
        "Git pull failed",
        async {
            let path = validate_project_path(&project_path)?;
            run_git_command(&path, &["pull"]).await?;
            Ok(())
        }
        .await,
    )
}

/// Fetch from remote.
#[tauri::command]
#[specta::specta]
pub async fn git_fetch(project_path: String) -> CommandResult<()> {
    unexpected_command_result(
        "git_fetch",
        "Git fetch failed",
        async {
            let path = validate_project_path(&project_path)?;
            run_git_command(&path, &["fetch"]).await?;
            Ok(())
        }
        .await,
    )
}

/// Get ahead/behind status relative to upstream.
#[tauri::command]
#[specta::specta]
pub async fn git_remote_status(project_path: String) -> CommandResult<GitRemoteStatus> {
    let path = expected_command_result("git_remote_status", validate_project_path(&project_path))?;
    unexpected_command_result(
        "git_remote_status",
        "Failed to get git remote status",
        get_git_remote_status_impl(path).await,
    )
}

// ─── Stash ──────────────────────────────────────────────────────────────────

/// List stash entries.
#[tauri::command]
#[specta::specta]
pub async fn git_stash_list(project_path: String) -> CommandResult<Vec<GitStashEntry>> {
    unexpected_command_result(
        "git_stash_list",
        "Failed to list git stash",
        async {
            let path = validate_project_path(&project_path)?;

            let output =
                run_git_command(&path, &["stash", "list", "--format=%gd\t%gs\t%cr"]).await?;

            if output.is_empty() {
                return Ok(Vec::new());
            }

            let entries: Vec<GitStashEntry> = output
                .lines()
                .filter_map(|line| {
                    let parts: Vec<&str> = line.splitn(3, '\t').collect();
                    if parts.len() < 3 {
                        return None;
                    }

                    // Parse index from "stash@{N}"
                    let index_str = parts[0].trim_start_matches("stash@{").trim_end_matches('}');
                    let index = index_str.parse::<usize>().ok()?;

                    Some(GitStashEntry {
                        index,
                        message: parts[1].to_string(),
                        date: parts[2].to_string(),
                    })
                })
                .collect();

            Ok(entries)
        }
        .await,
    )
}

/// Pop a stash entry.
#[tauri::command]
#[specta::specta]
pub async fn git_stash_pop(project_path: String, index: usize) -> CommandResult<()> {
    unexpected_command_result(
        "git_stash_pop",
        "Failed to pop git stash",
        async {
            let path = validate_project_path(&project_path)?;
            let stash_ref = format!("stash@{{{}}}", index);
            run_git_command(&path, &["stash", "pop", &stash_ref]).await?;
            Ok(())
        }
        .await,
    )
}

/// Drop a stash entry.
#[tauri::command]
#[specta::specta]
pub async fn git_stash_drop(project_path: String, index: usize) -> CommandResult<()> {
    unexpected_command_result(
        "git_stash_drop",
        "Failed to drop git stash",
        async {
            let path = validate_project_path(&project_path)?;
            let stash_ref = format!("stash@{{{}}}", index);
            run_git_command(&path, &["stash", "drop", &stash_ref]).await?;
            Ok(())
        }
        .await,
    )
}

/// Save current changes to stash.
#[tauri::command]
#[specta::specta]
pub async fn git_stash_save(project_path: String, message: Option<String>) -> CommandResult<()> {
    unexpected_command_result(
        "git_stash_save",
        "Failed to save git stash",
        async {
            let path = validate_project_path(&project_path)?;

            let mut args = vec!["stash", "push"];
            if let Some(ref msg) = message {
                args.push("-m");
                args.push(msg);
            }

            run_git_command(&path, &args).await?;
            Ok(())
        }
        .await,
    )
}

// ─── Log ────────────────────────────────────────────────────────────────────

/// Get commit history.
#[tauri::command]
#[specta::specta]
pub async fn git_log(project_path: String, limit: u32) -> CommandResult<Vec<GitLogEntry>> {
    unexpected_command_result(
        "git_log",
        "Failed to get git log",
        async {
            let path = validate_project_path(&project_path)?;
            let limit = if limit == 0 { 50 } else { limit };

            tokio::task::spawn_blocking(move || {
                let repo = open_repository(&path).map_err(|e| e.to_string())?;

                let mut revwalk = repo
                    .revwalk()
                    .map_err(|e| format!("Failed to create revwalk: {}", e))?;
                revwalk
                    .push_head()
                    .map_err(|e| format!("Failed to push HEAD: {}", e))?;
                revwalk
                    .set_sorting(git2::Sort::TIME)
                    .map_err(|e| format!("Failed to set sorting: {}", e))?;

                let mut entries = Vec::new();

                for oid_result in revwalk.take(limit as usize) {
                    let oid = oid_result.map_err(|e| format!("Revwalk error: {}", e))?;
                    let commit = repo
                        .find_commit(oid)
                        .map_err(|e| format!("Failed to find commit: {}", e))?;

                    let sha = oid.to_string();
                    let short_sha = sha[..7.min(sha.len())].to_string();
                    let message = commit.summary().unwrap_or("").to_string();
                    let author = commit.author().name().unwrap_or("").to_string();
                    let date = format_relative_time(&commit.time());

                    entries.push(GitLogEntry {
                        sha,
                        short_sha,
                        message,
                        author,
                        date,
                    });
                }

                Ok(entries)
            })
            .await
            .map_err(|e| format!("Task join error: {}", e))?
        }
        .await,
    )
}

// ─── Branch Operations ──────────────────────────────────────────────────────

/// Create a new branch.
#[tauri::command]
#[specta::specta]
pub async fn git_create_branch(
    project_path: String,
    name: String,
    start_point: Option<String>,
) -> CommandResult<String> {
    unexpected_command_result(
        "git_create_branch",
        "Failed to create git branch",
        async {
            let path = validate_project_path(&project_path)?;

            tokio::task::spawn_blocking(move || {
                let repo = open_repository(&path).map_err(|e| e.to_string())?;

                let commit = if let Some(ref sp) = start_point {
                    let obj = repo
                        .revparse_single(sp)
                        .map_err(|e| format!("Failed to resolve '{}': {}", sp, e))?;
                    obj.peel_to_commit()
                        .map_err(|e| format!("Failed to peel to commit: {}", e))?
                } else {
                    repo.head()
                        .map_err(|e| format!("Failed to get HEAD: {}", e))?
                        .peel_to_commit()
                        .map_err(|e| format!("Failed to peel HEAD to commit: {}", e))?
                };

                let branch = repo
                    .branch(&name, &commit, false)
                    .map_err(|e| format!("Failed to create branch '{}': {}", name, e))?;

                Ok(branch
                    .name()
                    .map_err(|e| format!("Failed to get branch name: {}", e))?
                    .unwrap_or(&name)
                    .to_string())
            })
            .await
            .map_err(|e| format!("Task join error: {}", e))?
        }
        .await,
    )
}

/// Delete a branch.
#[tauri::command]
#[specta::specta]
pub async fn git_delete_branch(
    project_path: String,
    name: String,
    force: bool,
) -> CommandResult<()> {
    unexpected_command_result(
        "git_delete_branch",
        "Failed to delete git branch",
        async {
            let path = validate_project_path(&project_path)?;

            tokio::task::spawn_blocking(move || {
                let repo = open_repository(&path).map_err(|e| e.to_string())?;

                let mut branch = repo
                    .find_branch(&name, git2::BranchType::Local)
                    .map_err(|e| format!("Failed to find branch '{}': {}", name, e))?;

                if !force && !branch.is_head() {
                    // Check if branch is merged into HEAD
                    let head_oid = repo
                        .head()
                        .map_err(|e| format!("Failed to get HEAD: {}", e))?
                        .target()
                        .ok_or("HEAD has no target")?;

                    let branch_oid = branch.get().target().ok_or("Branch has no target")?;

                    let merge_base = repo
                        .merge_base(head_oid, branch_oid)
                        .map_err(|e| format!("Failed to find merge base: {}", e))?;

                    if merge_base != branch_oid {
                        return Err(format!(
                            "Branch '{}' is not fully merged. Use force=true to delete anyway.",
                            name
                        ));
                    }
                }

                branch
                    .delete()
                    .map_err(|e| format!("Failed to delete branch '{}': {}", name, e))?;

                Ok(())
            })
            .await
            .map_err(|e| format!("Task join error: {}", e))?
        }
        .await,
    )
}

// ─── AI Generation Context ──────────────────────────────────────────────────

/// Maximum bytes for name-status summary (~100 files at 80 chars/line)
const MAX_SUMMARY_BYTES: usize = 8_000;
/// Maximum bytes for unified diff patch (~12-15K tokens)
const MAX_PATCH_BYTES: usize = 50_000;
/// Maximum bytes for commit log
const MAX_COMMIT_LOG_BYTES: usize = 20_000;
/// Maximum bytes for diff stat
const MAX_DIFF_STAT_BYTES: usize = 20_000;
/// Maximum bytes for range diff patch
const MAX_RANGE_PATCH_BYTES: usize = 60_000;

/// Context from staged changes for AI commit message generation.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StagedContext {
    pub summary: String,
    pub patch: String,
}

/// Context from a branch range for PR description generation.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RangeContext {
    pub commit_summary: String,
    pub diff_summary: String,
    pub diff_patch: String,
}

/// Truncate a string at a safe UTF-8 boundary.
fn truncate_context(value: &str, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        value.to_string()
    } else {
        let boundary = value.floor_char_boundary(max_bytes);
        format!("{}\n\n[truncated]", &value[..boundary])
    }
}

/// Collect staged diff context for AI commit message generation.
/// Returns None if nothing is staged.
pub async fn collect_staged_context(project_path: &Path) -> Result<Option<StagedContext>, String> {
    let summary = run_git_command(project_path, &["diff", "--cached", "--name-status"]).await?;
    if summary.trim().is_empty() {
        return Ok(None);
    }
    let patch = run_git_command(project_path, &["diff", "--cached", "--patch"]).await?;
    Ok(Some(StagedContext {
        summary: truncate_context(&summary, MAX_SUMMARY_BYTES),
        patch: truncate_context(&patch, MAX_PATCH_BYTES),
    }))
}

/// Collect diff context between base branch and HEAD for PR generation.
pub async fn collect_range_context(
    project_path: &Path,
    base_branch: &str,
) -> Result<RangeContext, String> {
    let range = format!("{base_branch}..HEAD");
    let commit_summary = run_git_command(project_path, &["log", "--oneline", &range]).await?;
    let diff_summary = run_git_command(project_path, &["diff", "--stat", &range]).await?;
    let diff_patch = run_git_command(project_path, &["diff", "--patch", &range]).await?;
    Ok(RangeContext {
        commit_summary: truncate_context(&commit_summary, MAX_COMMIT_LOG_BYTES),
        diff_summary: truncate_context(&diff_summary, MAX_DIFF_STAT_BYTES),
        diff_patch: truncate_context(&diff_patch, MAX_RANGE_PATCH_BYTES),
    })
}

// ─── Stacked Action ─────────────────────────────────────────────────────────

/// Run commit → push → optional PR in one go. Action: "commit" | "commit_push" | "commit_push_pr".
#[tauri::command]
#[specta::specta]
pub async fn git_run_stacked_action(
    project_path: String,
    action: String,
    commit_message: String,
    pr_title: Option<String>,
    pr_body: Option<String>,
) -> CommandResult<GitStackedActionResult> {
    let path = expected_command_result(
        "git_run_stacked_action",
        validate_project_path(&project_path),
    )?;
    let action = match action.as_str() {
        "commit" | "commit_push" | "commit_push_pr" => action,
        _ => {
            return Err(SerializableCommandError::expected(
                "git_run_stacked_action",
                "Invalid action: use commit, commit_push, or commit_push_pr",
            ));
        }
    };
    let branch = unexpected_command_result(
        "git_run_stacked_action",
        "Git stacked action failed",
        crate::git::worktree::get_current_branch(&path),
    )?;
    let remote_status = unexpected_command_result(
        "git_run_stacked_action",
        "Git stacked action failed",
        get_git_remote_status_impl(path.clone()).await,
    )?;
    let has_staged = unexpected_command_result(
        "git_run_stacked_action",
        "Git stacked action failed",
        tokio::task::spawn_blocking({
            let path = path.clone();
            move || {
                let repo = open_repository(&path).map_err(|e| e.to_string())?;
                has_staged_changes(&repo)
            }
        })
        .await
        .map_err(|e| format!("Task join error: {}", e))
        .and_then(|result| result),
    )?;
    if has_staged && commit_message.trim().is_empty() {
        return Err(SerializableCommandError::expected(
            "git_run_stacked_action",
            "Commit message required when there are staged changes",
        ));
    }

    unexpected_command_result(
        "git_run_stacked_action",
        "Git stacked action failed",
        async {
            let mut branch = branch;
            let remote_status = remote_status;

            let do_push = action == "commit_push" || action == "commit_push_pr";

            // Auto-create a feature branch when on the default branch and creating a PR
            let mut created_branch = false;
            if action == "commit_push_pr" {
                let default_branch = gh_pr::get_default_branch(&path)
                    .await?
                    .unwrap_or_else(|| "main".to_string());
                if branch == default_branch {
                    let timestamp = chrono::Utc::now().format("%Y%m%d-%H%M%S");
                    let new_branch = format!("acepe/{}", timestamp);
                    run_git_command(&path, &["checkout", "-b", &new_branch]).await?;
                    branch = new_branch;
                    created_branch = true;
                }
            }

            let push_remote = if remote_status.remote.is_empty() {
                "origin".to_string()
            } else {
                remote_status.remote.clone()
            };
            let expected_tracking_branch = format!("{}/{}", push_remote, branch);

            // New branches need -u, and existing branches need it when tracking is missing or points at a
            // different remote ref than the current branch.
            let needs_upstream = do_push
                && (created_branch
                    || remote_status.tracking_branch.is_empty()
                    || remote_status.tracking_branch != expected_tracking_branch);

            let path_clone = path.clone();
            let msg = commit_message.clone();
            let created_branch_for_log = created_branch;
            let (commit_step, head_subject, head_body) = tokio::task::spawn_blocking(move || {
                let repo = open_repository(&path_clone).map_err(|e| e.to_string())?;
                let has_staged = has_staged_changes(&repo)?;

                tracing::info!(
                    has_staged = has_staged,
                    created_branch = created_branch_for_log,
                    "Stacked action commit step"
                );

                if has_staged && msg.trim().is_empty() {
                    return Err("Commit message required when there are staged changes".to_string());
                }

                let (status, commit_sha, subject) = if has_staged {
                    let res = do_commit(&path_clone, msg.trim())?;
                    let subject = repo
                        .head()
                        .map_err(|e| e.to_string())?
                        .peel_to_commit()
                        .map_err(|e| e.to_string())?
                        .message()
                        .unwrap_or("")
                        .lines()
                        .next()
                        .unwrap_or("")
                        .to_string();
                    ("created".to_string(), Some(res.sha), Some(subject))
                } else {
                    let subject = repo
                        .head()
                        .ok()
                        .and_then(|h| h.peel_to_commit().ok())
                        .and_then(|c| {
                            c.message()
                                .map(|s| s.lines().next().unwrap_or("").to_string())
                        });
                    ("skipped_no_changes".to_string(), None, subject)
                };

                let body = repo
                    .head()
                    .ok()
                    .and_then(|h| h.peel_to_commit().ok())
                    .and_then(|c| {
                        c.message().map(|s| {
                            let lines: Vec<&str> = s.lines().collect();
                            if lines.len() > 1 {
                                Some(lines[1..].join("\n"))
                            } else {
                                None
                            }
                        })
                    })
                    .flatten();

                let head_subject = subject.as_deref().unwrap_or("Update").to_string();

                Ok::<_, String>((
                    GitStackedCommitStep {
                        status,
                        commit_sha,
                        subject,
                    },
                    head_subject,
                    body,
                ))
            })
            .await
            .map_err(|e| format!("Task join error: {}", e))??;

            // If we auto-created a branch but there's nothing to commit, switch back and abort
            if created_branch && commit_step.status == "skipped_no_changes" {
                // Switch back to the original default branch
                let default_branch = gh_pr::get_default_branch(&path)
                    .await?
                    .unwrap_or_else(|| "main".to_string());
                let _ = run_git_command(&path, &["checkout", &default_branch]).await;
                let _ = run_git_command(&path, &["branch", "-d", &branch]).await;
                return Err(
                    "No changes to commit. The modified files match what's already committed."
                        .to_string(),
                );
            }

            let push_step = if do_push {
                let push_args: Vec<&str> = if needs_upstream {
                    vec!["push", "--no-verify", "-u", push_remote.as_str(), &branch]
                } else {
                    vec!["push", "--no-verify"]
                };
                timeout(Duration::from_secs(90), run_git_command(&path, &push_args))
                    .await
                    .map_err(|_| "Push timed out".to_string())??;
                let upstream = if needs_upstream {
                    expected_tracking_branch.clone()
                } else {
                    remote_status.tracking_branch
                };
                GitStackedPushStep {
                    status: "pushed".to_string(),
                    branch: Some(branch.clone()),
                    upstream_branch: Some(upstream),
                }
            } else {
                GitStackedPushStep {
                    status: "skipped_not_requested".to_string(),
                    branch: None,
                    upstream_branch: None,
                }
            };

            let pr_step = if action == "commit_push_pr" {
                let (base_result, open_pr_result) = tokio::join!(
                    gh_pr::get_default_branch(&path),
                    gh_pr::get_open_pr_for_branch_inner(&path, &branch),
                );
                let base_branch = base_result?.unwrap_or_else(|| "main".to_string());
                let open_pr = open_pr_result?;

                if let Some(ref open_pr) = open_pr {
                    pr_step_from_open_pr("opened_existing", open_pr, &base_branch, &branch)
                } else {
                    let title = pr_title.as_deref().unwrap_or(&head_subject);
                    let body_content = pr_body.as_deref().or(head_body.as_deref());
                    let pr_body_with_footer = gh_pr::pr_body_with_acepe_footer(body_content);
                    gh_pr::create_pull_request(
                        &path,
                        &base_branch,
                        &branch,
                        title,
                        Some(pr_body_with_footer.as_str()),
                    )
                    .await?;

                    let open_pr = gh_pr::get_open_pr_for_branch_inner(&path, &branch)
                        .await?
                        .ok_or("PR created but could not retrieve URL")?;

                    pr_step_from_open_pr("created", &open_pr, &base_branch, &branch)
                }
            } else {
                GitStackedPrStep {
                    status: "skipped_not_requested".to_string(),
                    url: None,
                    number: None,
                    title: None,
                    base_branch: None,
                    head_branch: None,
                }
            };

            Ok(GitStackedActionResult {
                action,
                commit: commit_step,
                push: push_step,
                pr: pr_step,
            })
        }
        .await,
    )
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;
    use std::process::Command;

    use git2::IndexAddOption;
    use tempfile::TempDir;

    use crate::file_index::git::open_repository;

    use super::{
        do_commit, git_panel_status, git_run_stacked_action, git_stage_files, has_staged_changes,
    };

    /// Create a new git repo in a temp dir with user config set (required for commits).
    fn init_repo_with_config() -> (TempDir, git2::Repository) {
        let dir = TempDir::new().expect("temp dir");
        let repo = git2::Repository::init(dir.path()).expect("init repo");
        let mut config = repo.config().expect("config");
        config
            .set_str("user.name", "Test User")
            .expect("set user.name");
        config
            .set_str("user.email", "test@example.com")
            .expect("set user.email");
        (dir, repo)
    }

    fn run_test_git(dir: &Path, args: &[&str]) -> String {
        let output = Command::new("git")
            .args(args)
            .current_dir(dir)
            .output()
            .expect("run git");
        assert!(
            output.status.success(),
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }

    #[test]
    fn has_staged_changes_false_when_index_empty_no_head() {
        let (dir, repo) = init_repo_with_config();
        let staged = has_staged_changes(&repo).expect("has_staged_changes");
        assert!(
            !staged,
            "new repo with empty index should have no staged changes"
        );
        drop(repo);
        drop(dir);
    }

    #[test]
    fn has_staged_changes_true_when_file_staged_no_head() {
        let (dir, repo) = init_repo_with_config();
        let path = dir.path().join("file.txt");
        fs::write(&path, "hello").expect("write file");
        let mut index = repo.index().expect("index");
        index.add_path(Path::new("file.txt")).expect("add path");
        index.write().expect("write index");
        let staged = has_staged_changes(&repo).expect("has_staged_changes");
        assert!(
            staged,
            "staged file with no HEAD should report staged changes"
        );
        drop(repo);
        drop(dir);
    }

    #[test]
    fn has_staged_changes_true_when_staged_then_false_after_commit() {
        let (dir, repo) = init_repo_with_config();
        let path = dir.path().join("file.txt");
        fs::write(&path, "hello").expect("write file");
        let mut index = repo.index().expect("index");
        index.add_path(Path::new("file.txt")).expect("add path");
        index.write().expect("write index");
        assert!(
            has_staged_changes(&repo).expect("has_staged_changes"),
            "should have staged changes before commit"
        );
        do_commit(dir.path(), "Initial commit").expect("do_commit");
        let repo2 = open_repository(dir.path()).expect("reopen repo");
        assert!(
            !has_staged_changes(&repo2).expect("has_staged_changes"),
            "should have no staged changes after commit"
        );
        drop(repo);
        drop(dir);
    }

    #[test]
    fn has_staged_changes_false_after_unstage() {
        let (dir, repo) = init_repo_with_config();
        let path = dir.path().join("file.txt");
        fs::write(&path, "hello").expect("write file");
        let mut index = repo.index().expect("index");
        index.add_path(Path::new("file.txt")).expect("add path");
        index.write().expect("write index");
        do_commit(dir.path(), "First").expect("do_commit");
        fs::write(&path, "modified").expect("write again");
        let mut index = repo.index().expect("index");
        index.add_path(Path::new("file.txt")).expect("add path");
        index.write().expect("write index");
        assert!(
            has_staged_changes(&repo).expect("has_staged_changes"),
            "should have staged changes before unstage"
        );
        {
            let head = repo.head().expect("head").peel_to_commit().expect("commit");
            let head_tree = head.tree().expect("tree");
            let mut index = repo.index().expect("index");
            index.read_tree(&head_tree).expect("read_tree");
            index.write().expect("write index");
        }
        assert!(
            !has_staged_changes(&repo).expect("has_staged_changes"),
            "should have no staged changes after unstage"
        );
        drop(repo);
        drop(dir);
    }

    #[test]
    fn do_commit_creates_commit_with_message() {
        let (dir, repo) = init_repo_with_config();
        let path = dir.path().join("file.txt");
        fs::write(&path, "content").expect("write file");
        let mut index = repo.index().expect("index");
        index
            .add_all(["*"].iter(), IndexAddOption::DEFAULT, None)
            .expect("add all");
        index.write().expect("write index");
        let res = do_commit(dir.path(), "Test commit message").expect("do_commit");
        assert!(!res.sha.is_empty());
        assert!(!res.short_sha.is_empty());
        let repo2 = open_repository(dir.path()).expect("reopen repo");
        let head = repo2
            .head()
            .expect("head")
            .peel_to_commit()
            .expect("commit");
        let message = head.message().expect("message").to_string();
        assert_eq!(
            message.trim(),
            "Test commit message",
            "HEAD commit message should match"
        );
        drop(repo);
        drop(dir);
    }

    #[tokio::test]
    async fn git_stage_files_ignores_absolute_paths_outside_worktree() {
        let (dir, repo) = init_repo_with_config();
        let tracked_path = dir.path().join("tracked.txt");
        fs::write(&tracked_path, "tracked content").expect("write tracked file");
        let outside_dir = TempDir::new().expect("outside temp dir");
        let outside_path = outside_dir.path().join("video-progress-review.json");
        fs::write(&outside_path, "{}").expect("write outside file");

        let result = git_stage_files(
            dir.path().display().to_string(),
            vec![
                "tracked.txt".to_string(),
                outside_path.display().to_string(),
            ],
        )
        .await;

        assert!(
            result.is_ok(),
            "staging should ignore outside-worktree files instead of failing: {result:?}"
        );

        let index = repo.index().expect("index");
        assert!(
            index.get_path(Path::new("tracked.txt"), 0).is_some(),
            "tracked file should still be staged"
        );
        assert!(
            index
                .get_path(Path::new("video-progress-review.json"), 0)
                .is_none(),
            "outside-worktree file should not be added to the index"
        );

        drop(repo);
        drop(outside_dir);
        drop(dir);
    }

    #[tokio::test]
    async fn git_panel_status_reports_per_file_insertions_and_deletions() {
        let (dir, repo) = init_repo_with_config();

        let tracked_path = dir.path().join("tracked.txt");
        fs::write(&tracked_path, "one\n").expect("write tracked baseline");
        run_test_git(dir.path(), &["add", "tracked.txt"]);
        do_commit(dir.path(), "initial tracked file").expect("commit tracked baseline");

        fs::write(&tracked_path, "one\ntwo\n").expect("update tracked file");
        let untracked_path = dir.path().join("new-file.txt");
        fs::write(&untracked_path, "draft\nnotes\n").expect("write untracked file");

        let statuses = git_panel_status(dir.path().display().to_string())
            .await
            .expect("git panel status");

        let tracked = statuses
            .iter()
            .find(|status| status.path == "tracked.txt")
            .expect("tracked status");
        assert_eq!(tracked.worktree_insertions, 1);
        assert_eq!(tracked.worktree_deletions, 0);

        let untracked = statuses
            .iter()
            .find(|status| status.path == "new-file.txt")
            .expect("untracked status");
        assert_eq!(untracked.worktree_status.as_deref(), Some("untracked"));
        assert_eq!(untracked.worktree_insertions, 2);
        assert_eq!(untracked.worktree_deletions, 0);

        drop(repo);
        drop(dir);
    }

    #[tokio::test]
    async fn git_run_stacked_action_repoints_mismatched_upstream_before_push() {
        let remote_dir = TempDir::new().expect("remote dir");
        run_test_git(remote_dir.path(), &["init", "--bare"]);

        let (dir, repo) = init_repo_with_config();
        run_test_git(dir.path(), &["checkout", "-b", "main"]);

        let file_path = dir.path().join("file.txt");
        fs::write(&file_path, "initial").expect("write initial file");
        run_test_git(dir.path(), &["add", "file.txt"]);
        do_commit(dir.path(), "Initial commit").expect("initial commit");

        let remote_path = remote_dir.path().to_string_lossy().into_owned();
        run_test_git(
            dir.path(),
            &["remote", "add", "origin", remote_path.as_str()],
        );
        run_test_git(dir.path(), &["push", "-u", "origin", "main"]);

        run_test_git(dir.path(), &["checkout", "-b", "acepe/bright-falcon"]);
        run_test_git(
            dir.path(),
            &[
                "branch",
                "--set-upstream-to=origin/main",
                "acepe/bright-falcon",
            ],
        );
        run_test_git(dir.path(), &["config", "push.default", "simple"]);

        fs::write(&file_path, "feature").expect("write feature file");
        run_test_git(dir.path(), &["add", "file.txt"]);

        let result = git_run_stacked_action(
            dir.path().display().to_string(),
            "commit_push".to_string(),
            "Update feature branch".to_string(),
            None,
            None,
        )
        .await;

        assert!(
            result.is_ok(),
            "expected stacked push to repair mismatched upstream, got: {result:?}"
        );

        let result = result.expect("stacked action result");
        assert_eq!(result.push.branch.as_deref(), Some("acepe/bright-falcon"));
        assert_eq!(
            result.push.upstream_branch.as_deref(),
            Some("origin/acepe/bright-falcon")
        );
        assert_eq!(
            run_test_git(
                dir.path(),
                &[
                    "rev-parse",
                    "--abbrev-ref",
                    "--symbolic-full-name",
                    "@{upstream}"
                ],
            ),
            "origin/acepe/bright-falcon"
        );
        assert!(
            run_test_git(
                remote_dir.path(),
                &["for-each-ref", "--format=%(refname:short)", "refs/heads"],
            )
            .lines()
            .any(|branch| branch == "acepe/bright-falcon"),
            "expected remote to contain pushed feature branch"
        );

        drop(repo);
        drop(dir);
        drop(remote_dir);
    }
}
