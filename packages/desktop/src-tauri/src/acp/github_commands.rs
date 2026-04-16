#![allow(clippy::result_large_err)]
/**
 * GitHub integration commands for Tauri.
 * Handles fetching commit/PR diffs via git and gh CLI.
 */
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::process::{Command, Output};

use crate::commands::observability::{
    CommandResult, SerializableCommandError, capture_unexpected_command_error,
    unexpected_command_result,
};
use crate::path_safety::validate_project_directory_from_str;

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

fn gh_api_output_is_not_found(output: &Output) -> bool {
    String::from_utf8_lossy(&output.stderr).contains("HTTP 404")
}

fn gh_api_output_summary(action: &str, output: &Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr);
    let trimmed = stderr.trim();
    if trimmed.is_empty() {
        format!("{action} failed with status {}", output.status)
    } else {
        format!("{action} failed: {trimmed}")
    }
}

/// Extracts the GitHub repository context from .git/config
/// Returns (owner, repo) tuple from the remote URL
fn parse_github_remote(remote_url: &str) -> Option<(String, String)> {
    // Match patterns like:
    // - https://github.com/owner/repo.git
    // - git@github.com:owner/repo.git
    // - https://github.com/owner/repo
    // - git@github.com:owner/repo

    if let Some(start) = remote_url.find("github.com") {
        let after_github = &remote_url[start + 10..];

        let path = if after_github.starts_with(':') || after_github.starts_with('/') {
            &after_github[1..]
        } else {
            return None;
        };

        let path = path.trim_end_matches('/').trim_end_matches(".git");
        let parts: Vec<&str> = path.split('/').collect();

        if parts.len() >= 2 {
            return Some((parts[0].to_string(), parts[1].to_string()));
        }
    }

    None
}

fn extract_named_remote_url(config_content: &str, remote_name: &str) -> Option<String> {
    let target_section = format!(r#"[remote "{}"]"#, remote_name);
    let mut in_target_section = false;

    for line in config_content.lines() {
        let trimmed = line.trim();

        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            in_target_section = trimmed == target_section;
            continue;
        }

        if !in_target_section {
            continue;
        }

        let (key, value) = trimmed.split_once('=')?;
        if key.trim() == "url" {
            return Some(value.trim().to_string());
        }
    }

    None
}

/// Reads .git/config and extracts the GitHub remote URL
fn get_repo_context(project_path: &Path) -> Result<RepoContext, String> {
    let git_config_path = project_path.join(".git").join("config");

    if !git_config_path.exists() {
        return Err("Not a git repository".to_string());
    }

    let config_content = fs::read_to_string(&git_config_path)
        .map_err(|e| format!("Failed to read .git/config: {}", e))?;

    let remote_url = extract_named_remote_url(&config_content, "origin")
        .ok_or("Could not find remote.origin.url in .git/config")?;

    let (owner, repo) = parse_github_remote(&remote_url)
        .ok_or("Could not parse GitHub repository from remote URL")?;

    Ok(RepoContext {
        owner,
        repo,
        remote_url,
    })
}

/// Parses git show output to extract individual file diffs with statistics
fn parse_git_diff(diff_text: &str) -> Vec<FileDiff> {
    let mut files = Vec::new();
    let mut current_file: Option<FileDiff> = None;
    let mut patch_content = String::new();
    let mut in_patch_section = false;

    for line in diff_text.lines() {
        // Check for start of a new file diff
        if line.starts_with("diff --git") {
            // Save previous file if exists
            if let Some(mut file) = current_file.take() {
                file.patch = patch_content.trim().to_string();
                files.push(file);
                patch_content.clear();
            }

            // Parse new file diff: "diff --git a/path b/path"
            let parts: Vec<&str> = line.split(' ').collect();
            if parts.len() >= 4 {
                let path = parts[3].strip_prefix("b/").unwrap_or(parts[3]);
                current_file = Some(FileDiff {
                    path: path.to_string(),
                    status: "modified".to_string(),
                    additions: 0,
                    deletions: 0,
                    patch: String::new(),
                });
            }
            in_patch_section = true;
        } else if in_patch_section {
            // Check for file status (new file, deleted, etc.)
            if line.starts_with("new file mode") {
                if let Some(file) = current_file.as_mut() {
                    file.status = "added".to_string();
                }
            } else if line.starts_with("deleted file mode") {
                if let Some(file) = current_file.as_mut() {
                    file.status = "deleted".to_string();
                }
            } else if line.starts_with("similarity index") || line.starts_with("rename from") {
                if let Some(file) = current_file.as_mut() {
                    file.status = "renamed".to_string();
                }
            } else if line.starts_with("@@") {
                // Start of actual patch content
                patch_content.push_str(line);
                patch_content.push('\n');
            } else if !line.starts_with("index ")
                && !line.starts_with("---")
                && !line.starts_with("+++")
                && !line.is_empty()
                && !patch_content.is_empty()
            {
                // Add to patch content
                patch_content.push_str(line);
                patch_content.push('\n');
            } else if line.starts_with("---") || line.starts_with("+++") {
                patch_content.push_str(line);
                patch_content.push('\n');
            }
        }
    }

    // Save last file if exists
    if let Some(mut file) = current_file.take() {
        file.patch = patch_content.trim().to_string();
        files.push(file);
    }

    // If no files were parsed, return a placeholder
    if files.is_empty() {
        vec![FileDiff {
            path: "changes".to_string(),
            status: "modified".to_string(),
            additions: 0,
            deletions: 0,
            patch: diff_text.to_string(),
        }]
    } else {
        files
    }
}

fn run_git_from_project(
    project_path: &Path,
    args: &[&str],
    allow_diff_exit: bool,
) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(project_path)
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;

    if !(output.status.success() || allow_diff_exit && output.status.code() == Some(1)) {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "Git command failed".to_string()
        } else {
            stderr
        });
    }

    String::from_utf8(output.stdout).map_err(|e| format!("Invalid UTF-8 in git output: {}", e))
}

fn fetch_working_file_diff_impl(
    project_path: &Path,
    file_path: &str,
    staged: bool,
    status: &str,
    additions: i32,
    deletions: i32,
) -> Result<FileDiff, String> {
    let is_untracked = !staged && status == "added";

    let diff_args = if is_untracked {
        vec![
            "diff",
            "--no-index",
            "--patch",
            "--",
            "/dev/null",
            file_path,
        ]
    } else if staged {
        vec!["diff", "--cached", "--patch", "--", file_path]
    } else {
        vec!["diff", "--patch", "--", file_path]
    };
    let diff_text = run_git_from_project(project_path, &diff_args, is_untracked)?;
    let mut file_diff = parse_git_diff(&diff_text)
        .into_iter()
        .next()
        .unwrap_or(FileDiff {
            path: file_path.to_string(),
            status: status.to_string(),
            additions,
            deletions,
            patch: diff_text.trim().to_string(),
        });

    file_diff.path = file_path.to_string();
    file_diff.status = status.to_string();
    file_diff.additions = additions;
    file_diff.deletions = deletions;

    Ok(file_diff)
}

/// Fetches commit diff using git show command
fn fetch_commit_diff_via_git(sha: &str, project_path: &Path) -> Result<CommitDiff, String> {
    // Get commit metadata
    let metadata_output = Command::new("git")
        .args([
            "-C",
            project_path.to_str().ok_or("Invalid project path")?,
            "log",
            sha,
            "-1",
            "--format=%H%n%an%n%ae%n%aI%n%s%n%b",
        ])
        .output()
        .map_err(|e| format!("Failed to run git log: {}", e))?;

    if !metadata_output.status.success() {
        return Err("Commit not found".to_string());
    }

    let metadata_str = String::from_utf8(metadata_output.stdout)
        .map_err(|e| format!("Invalid UTF-8 in git output: {}", e))?;

    let lines: Vec<&str> = metadata_str.lines().collect();
    if lines.len() < 5 {
        return Err("Unexpected git output format".to_string());
    }

    let full_sha = lines[0].to_string();
    let author = lines[1].to_string();
    let author_email = lines[2].to_string();
    let date = lines[3].to_string();
    let message = lines[4].to_string();
    let message_body = if lines.len() > 5 {
        Some(lines[5..].join("\n"))
    } else {
        None
    };

    let short_sha = full_sha.chars().take(7).collect();

    // Get diff with stats
    let diff_output = Command::new("git")
        .args([
            "-C",
            project_path.to_str().ok_or("Invalid project path")?,
            "show",
            "--stat",
            "--patch",
            &full_sha,
        ])
        .output()
        .map_err(|e| format!("Failed to run git show: {}", e))?;

    if !diff_output.status.success() {
        return Err("Failed to get commit diff".to_string());
    }

    let diff_text = String::from_utf8(diff_output.stdout)
        .map_err(|e| format!("Invalid UTF-8 in git output: {}", e))?;

    // Parse diff to extract individual files
    let files = parse_git_diff(&diff_text);

    let repo_context = get_repo_context(project_path).ok();

    Ok(CommitDiff {
        sha: full_sha,
        short_sha,
        message,
        message_body,
        author,
        author_email,
        date,
        files,
        repo_context,
    })
}

/// Fetches commit diff using gh CLI (GitHub API)
fn fetch_commit_diff_via_gh(sha: &str, owner: &str, repo: &str) -> Result<CommitDiff, String> {
    // Get commit details
    let commit_output = Command::new("gh")
        .args(["api", &format!("repos/{}/{}/commits/{}", owner, repo, sha)])
        .output()
        .map_err(|e| format!("Failed to run gh api: {}", e))?;

    if !commit_output.status.success() {
        let stderr = String::from_utf8_lossy(&commit_output.stderr);
        if stderr.contains("not found") || stderr.contains("Not Found") {
            return Err("Commit not found on GitHub".to_string());
        }
        return Err(format!("gh api failed: {}", stderr));
    }

    let commit_json: serde_json::Value = serde_json::from_slice(&commit_output.stdout)
        .map_err(|e| format!("Failed to parse gh response: {}", e))?;

    let full_sha = commit_json["sha"]
        .as_str()
        .ok_or("Missing SHA in response")?
        .to_string();
    let short_sha = full_sha.chars().take(7).collect();
    let message = commit_json["commit"]["message"]
        .as_str()
        .ok_or("Missing message in response")?
        .to_string();
    let author = commit_json["commit"]["author"]["name"]
        .as_str()
        .ok_or("Missing author in response")?
        .to_string();
    let author_email = commit_json["commit"]["author"]["email"]
        .as_str()
        .ok_or("Missing author email in response")?
        .to_string();
    let date = commit_json["commit"]["author"]["date"]
        .as_str()
        .ok_or("Missing date in response")?
        .to_string();

    // Split message into summary and body
    let message_lines: Vec<&str> = message.lines().collect();
    let summary = message_lines
        .first()
        .map(|s| s.to_string())
        .unwrap_or_default();
    let body = if message_lines.len() > 1 {
        Some(message_lines[1..].join("\n"))
    } else {
        None
    };

    // Get file changes (simplified - just store the summary)
    let files = vec![FileDiff {
        path: "Commit files".to_string(),
        status: "modified".to_string(),
        additions: 0,
        deletions: 0,
        patch: format!(
            "{} files changed",
            commit_json["files"]
                .as_array()
                .map(|a| a.len())
                .unwrap_or(0)
        ),
    }];

    Ok(CommitDiff {
        sha: full_sha,
        short_sha,
        message: summary,
        message_body: body,
        author,
        author_email,
        date,
        files,
        repo_context: Some(RepoContext {
            owner: owner.to_string(),
            repo: repo.to_string(),
            remote_url: format!("https://github.com/{}/{}", owner, repo),
        }),
    })
}

/// Tauri command: Get repository context from .git/config
#[tauri::command]
#[specta::specta]
pub fn get_github_repo_context(project_path: String) -> CommandResult<RepoContext> {
    unexpected_command_result("get_github_repo_context", "Failed to get GitHub repository context", get_repo_context(Path::new(&project_path)))
}

/// Tauri command: Fetch commit diff (tries git first, then gh CLI)
#[tauri::command]
#[specta::specta]
pub fn fetch_commit_diff(
    sha: String,
    project_path: String,
    repo_context: Option<RepoContext>,
) -> CommandResult<CommitDiff> {
    unexpected_command_result("fetch_commit_diff", "Failed to fetch commit diff", (|| {
        // Try git first
        if let Ok(diff) = fetch_commit_diff_via_git(&sha, Path::new(&project_path)) {
            return Ok(diff);
        }

        // Fall back to gh CLI if repo context provided
        if let Some(context) = repo_context {
            fetch_commit_diff_via_gh(&sha, &context.owner, &context.repo)
        } else {
            Err("Could not fetch commit diff with git or gh CLI".to_string())
        }
    })())
}

/// Tauri command: Fetch the current working-tree diff for a single file.
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
    unexpected_command_result("git_working_file_diff", "Failed to fetch working file diff", (|| {
        let project_path = validate_project_directory_from_str(&project_path)
            .map_err(|error| error.message_for(Path::new(&project_path)))?;
        fetch_working_file_diff_impl(
            &project_path,
            &file_path,
            staged,
            &status,
            additions,
            deletions,
        )
    })())
}

/// Tauri command: Fetch PR diff
/// Runs both gh API calls (metadata + files) in parallel via threads.
#[tauri::command]
#[specta::specta]
pub fn fetch_pr_diff(owner: String, repo: String, pr_number: i32) -> CommandResult<PrDiff> {
    let (pr_output, files_output) =
        unexpected_command_result("fetch_pr_diff", "Failed to fetch PR diff", (|| {
        // Spawn both gh API calls in parallel
        let meta_owner = owner.clone();
        let meta_repo = repo.clone();
        let meta_handle = std::thread::spawn(move || {
            Command::new("gh")
                .args([
                    "api",
                    &format!("repos/{}/{}/pulls/{}", meta_owner, meta_repo, pr_number),
                ])
                .output()
        });

        let files_owner = owner.clone();
        let files_repo = repo.clone();
        let files_handle = std::thread::spawn(move || {
            Command::new("gh")
                .args([
                    "api",
                    &format!(
                        "repos/{}/{}/pulls/{}/files",
                        files_owner, files_repo, pr_number
                    ),
                ])
                .output()
        });

        let pr_output = meta_handle
            .join()
            .map_err(|_| "PR metadata thread panicked".to_string())?
            .map_err(|e| format!("Failed to fetch PR: {}", e))?;
        let files_output = files_handle
            .join()
            .map_err(|_| "PR files thread panicked".to_string())?
            .map_err(|e| format!("Failed to fetch PR files: {}", e))?;

        Ok((pr_output, files_output))
    })())?;

    if !pr_output.status.success() {
        if !gh_api_output_is_not_found(&pr_output) {
            return Err(capture_unexpected_command_error(
                "fetch_pr_diff",
                "Failed to fetch PR diff",
                gh_api_output_summary("Failed to fetch PR metadata", &pr_output),
            ));
        }

        return Err(SerializableCommandError::expected(
            "fetch_pr_diff",
            "PR not found",
        ));
    }

    unexpected_command_result("fetch_pr_diff", "Failed to fetch PR diff", (|| {
        let pr_json: serde_json::Value = serde_json::from_slice(&pr_output.stdout)
            .map_err(|e| format!("Failed to parse PR response: {}", e))?;

        let title = pr_json["title"]
            .as_str()
            .ok_or("Missing PR title")?
            .to_string();
        let author = pr_json["user"]["login"]
            .as_str()
            .ok_or("Missing PR author")?
            .to_string();
        let state = match pr_json["state"].as_str() {
            Some("open") => "open".to_string(),
            Some("closed") => {
                if pr_json["merged"].as_bool().unwrap_or(false) {
                    "merged".to_string()
                } else {
                    "closed".to_string()
                }
            }
            _ => "closed".to_string(),
        };
        let description = pr_json["body"].as_str().map(|s| s.to_string());

        let pr_metadata = PrMetadata {
            number: pr_number,
            title,
            author,
            state,
            description,
        };

        let files = if files_output.status.success() {
            if let Ok(files_json) = serde_json::from_slice::<serde_json::Value>(&files_output.stdout) {
                if let Some(files_array) = files_json.as_array() {
                    files_array
                        .iter()
                        .filter_map(|f| {
                            Some(FileDiff {
                                path: f["filename"].as_str()?.to_string(),
                                status: f["status"].as_str()?.to_string(),
                                additions: f["additions"].as_i64()? as i32,
                                deletions: f["deletions"].as_i64()? as i32,
                                patch: f["patch"].as_str()?.to_string(),
                            })
                        })
                        .collect()
                } else {
                    vec![]
                }
            } else {
                vec![]
            }
        } else {
            vec![]
        };

        Ok(PrDiff {
            pr: pr_metadata,
            files,
            repo_context: RepoContext {
                owner: owner.clone(),
                repo: repo.clone(),
                remote_url: format!("https://github.com/{}/{}", owner, repo),
            },
        })
    })())
}

/// Tauri command: List pull requests for a repository via gh CLI
#[tauri::command]
#[specta::specta]
pub fn list_pull_requests(
    owner: String,
    repo: String,
    state: String,
    limit: i32,
) -> CommandResult<Vec<PrListItem>> {
    unexpected_command_result("list_pull_requests", "Failed to list pull requests", (|| {
        let gh_state = match state.as_str() {
            "open" => "open",
            "closed" => "closed",
            "all" => "all",
            _ => "open",
        };

        let output = Command::new("gh")
            .args([
                "api",
                &format!(
                    "repos/{}/{}/pulls?state={}&per_page={}&sort=updated&direction=desc",
                    owner, repo, gh_state, limit
                ),
            ])
            .output()
            .map_err(|e| format!("Failed to run gh api: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Failed to list pull requests: {}", stderr));
        }

        let json: serde_json::Value = serde_json::from_slice(&output.stdout)
            .map_err(|e| format!("Failed to parse PR list response: {}", e))?;

        let prs = json
            .as_array()
            .ok_or("Expected array response from GitHub API")?;

        let items: Vec<PrListItem> = prs
            .iter()
            .filter_map(|pr| {
                let state_str = match pr["state"].as_str()? {
                    "open" => "open",
                    "closed" if pr["merged_at"].is_string() => "merged",
                    "closed" => "closed",
                    _ => "closed",
                };

                Some(PrListItem {
                    number: pr["number"].as_i64()? as i32,
                    title: pr["title"].as_str()?.to_string(),
                    author: pr["user"]["login"].as_str()?.to_string(),
                    state: state_str.to_string(),
                    head_ref: pr["head"]["ref"].as_str()?.to_string(),
                    base_ref: pr["base"]["ref"].as_str()?.to_string(),
                    updated_at: pr["updated_at"].as_str()?.to_string(),
                    additions: pr["additions"].as_i64().unwrap_or(0) as i32,
                    deletions: pr["deletions"].as_i64().unwrap_or(0) as i32,
                    changed_files: pr["changed_files"].as_i64().unwrap_or(0) as i32,
                })
            })
            .collect();

        Ok(items)
    })())
}

#[cfg(test)]
mod tests {
    use super::{fetch_working_file_diff_impl, get_repo_context};
    use std::fs;
    use std::path::Path;
    use std::process::Command;
    use tempfile::TempDir;

    fn git(project_path: &Path, args: &[&str]) {
        let output = Command::new("git")
            .args(args)
            .current_dir(project_path)
            .output()
            .expect("git command should execute");

        assert!(
            output.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn init_repo() -> TempDir {
        let temp_dir = tempfile::tempdir().expect("temp dir should exist");
        let path = temp_dir.path();

        git(path, &["init"]);
        git(path, &["config", "user.name", "Acepe Test"]);
        git(path, &["config", "user.email", "test@example.com"]);

        fs::write(path.join("tracked.txt"), "one\n").expect("tracked file should be written");
        git(path, &["add", "tracked.txt"]);
        git(path, &["commit", "-m", "initial"]);

        temp_dir
    }

    #[test]
    fn fetches_unstaged_working_file_diff() {
        let temp_dir = init_repo();
        let path = temp_dir.path();

        fs::write(path.join("tracked.txt"), "one\ntwo\n").expect("tracked file should be updated");

        let diff = fetch_working_file_diff_impl(path, "tracked.txt", false, "modified", 1, 0)
            .expect("unstaged diff should be returned");

        assert_eq!(diff.path, "tracked.txt");
        assert_eq!(diff.status, "modified");
        assert_eq!(diff.additions, 1);
        assert_eq!(diff.deletions, 0);
        assert!(diff.patch.contains("+two"));
    }

    #[test]
    fn fetches_staged_working_file_diff() {
        let temp_dir = init_repo();
        let path = temp_dir.path();

        fs::write(path.join("staged.txt"), "hello\nworld\n")
            .expect("staged file should be written");
        git(path, &["add", "staged.txt"]);

        let diff = fetch_working_file_diff_impl(path, "staged.txt", true, "added", 2, 0)
            .expect("staged diff should be returned");

        assert_eq!(diff.path, "staged.txt");
        assert_eq!(diff.status, "added");
        assert_eq!(diff.additions, 2);
        assert_eq!(diff.deletions, 0);
        assert!(diff.patch.contains("+hello"));
    }

    #[test]
    fn fetches_untracked_file_diff() {
        let temp_dir = init_repo();
        let path = temp_dir.path();

        fs::write(path.join("notes.txt"), "draft\n").expect("untracked file should be written");

        let diff = fetch_working_file_diff_impl(path, "notes.txt", false, "added", 1, 0)
            .expect("untracked diff should be returned");

        assert_eq!(diff.path, "notes.txt");
        assert_eq!(diff.status, "added");
        assert_eq!(diff.additions, 1);
        assert_eq!(diff.deletions, 0);
        assert!(diff.patch.contains("+draft"));
    }

    #[test]
    fn repo_context_uses_origin_even_when_other_remotes_appear_first() {
        let temp_dir = init_repo();
        let path = temp_dir.path();

        git(
            path,
            &["remote", "add", "fork", "git@github.com:flazouh/forgecode.git"],
        );
        git(
            path,
            &["remote", "add", "origin", "git@github.com:flazouh/acepe.git"],
        );

        let context = get_repo_context(path).expect("repo context should resolve from origin");

        assert_eq!(context.owner, "flazouh");
        assert_eq!(context.repo, "acepe");
        assert_eq!(context.remote_url, "git@github.com:flazouh/acepe.git");
    }
}
