//! GitHub PR helpers for stacked action: default branch, open PR for branch, create PR.
//! Runs `gh` CLI with project_path as cwd; uses tokio for async and timeout.

use serde::{Deserialize, Serialize};

/// Markdown footer appended to PRs created from Acepe (badge + link). No LLM; static attribution.
const ACEPE_PR_FOOTER: &str = "\n\n---\n\n[![Created with Acepe](https://img.shields.io/badge/Created_with-Acepe-6366f1)](https://acepe.dev)";

/// Build PR body with Acepe attribution footer. If user_body is present and non-empty, appends footer after it.
pub fn pr_body_with_acepe_footer(user_body: Option<&str>) -> String {
    let user = user_body.map(|s| s.trim()).unwrap_or("");
    if user.is_empty() {
        ACEPE_PR_FOOTER.trim_start_matches("\n\n").to_string()
    } else {
        format!("{}{}", user, ACEPE_PR_FOOTER)
    }
}
use std::path::Path;
use tokio::process::Command;
use tokio::time::{timeout, Duration};
use tracing::{info, warn};

const GH_TIMEOUT: Duration = Duration::from_secs(30);
const GH_BINARY_OVERRIDE_ENV: &str = "ACEPE_GH_BIN";
const GIT_BINARY_OVERRIDE_ENV: &str = "ACEPE_GIT_BIN";

fn gh_program() -> String {
    match std::env::var(GH_BINARY_OVERRIDE_ENV) {
        Ok(path) if !path.trim().is_empty() => path,
        _ => "gh".to_string(),
    }
}

fn git_program() -> String {
    match std::env::var(GIT_BINARY_OVERRIDE_ENV) {
        Ok(path) if !path.trim().is_empty() => path,
        _ => "git".to_string(),
    }
}

/// Open PR summary for a branch (from `gh pr list` or after create).
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct OpenPrInfo {
    pub number: i32,
    pub title: String,
    pub url: String,
}

/// Run `gh` with args in project_path; return stdout on success, stderr on failure.
pub async fn run_gh_command(project_path: &Path, args: &[&str]) -> Result<String, String> {
    let program = gh_program();
    info!(
        "Running gh command: gh {} in {}",
        args.join(" "),
        project_path.display()
    );
    let output = timeout(
        GH_TIMEOUT,
        Command::new(&program)
            .args(args)
            .current_dir(project_path)
            .output(),
    )
    .await
    .map_err(|_| "gh command timed out".to_string())?
    .map_err(|e| format!("Failed to run gh: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        warn!(
            "gh command failed: gh {} — stderr: {}",
            args.join(" "),
            stderr
        );
        return Err(if stderr.is_empty() {
            format!(
                "gh {} failed with exit code {:?}",
                args[0],
                output.status.code()
            )
        } else {
            map_gh_stderr(&stderr)
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Map common gh stderr to user-facing messages.
fn map_gh_stderr(stderr: &str) -> String {
    let s = stderr.to_lowercase();
    if s.contains("not logged in")
        || s.contains("authentication required")
        || s.contains("gh auth login")
    {
        return "GitHub CLI not signed in. Run: gh auth login".to_string();
    }
    if s.contains("no upstream") || s.contains("push your branch") {
        return "No upstream branch set. Push once with: git push -u origin <branch>".to_string();
    }
    // Pass through actual stderr (truncated if very long) so the user sees the real error
    if stderr.len() > 300 {
        format!("{}...", stderr.chars().take(300).collect::<String>())
    } else {
        stderr.to_string()
    }
}

/// Run `git` with args in project_path; return stdout on success, stderr on failure.
async fn run_git_command(project_path: &Path, args: &[&str]) -> Result<String, String> {
    let program = git_program();
    let output = timeout(
        GH_TIMEOUT,
        Command::new(&program)
            .args(args)
            .current_dir(project_path)
            .output(),
    )
    .await
    .map_err(|_| "git command timed out".to_string())?
    .map_err(|e| format!("Failed to run git: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stderr_lower = stderr.to_lowercase();
        if stderr_lower.contains("remote ref does not exist")
            || stderr_lower.contains("unable to delete")
        {
            return Ok(String::new());
        }
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

/// Get default branch of the repo (e.g. main). Returns None for forks when defaultBranchRef is null.
pub async fn get_default_branch(project_path: &Path) -> Result<Option<String>, String> {
    let out = run_gh_command(
        project_path,
        &[
            "repo",
            "view",
            "--json",
            "defaultBranchRef",
            "--jq",
            ".defaultBranchRef.name",
        ],
    )
    .await?;

    let name = out.trim();
    if name.is_empty() || name == "null" {
        return Ok(None);
    }
    Ok(Some(name.to_string()))
}

/// List open PR for the given branch; returns at most one (number, title, url).
pub async fn get_open_pr_for_branch_inner(
    project_path: &Path,
    branch: &str,
) -> Result<Option<OpenPrInfo>, String> {
    let out = run_gh_command(
        project_path,
        &[
            "pr",
            "list",
            "--head",
            branch,
            "--state",
            "open",
            "--limit",
            "1",
            "--json",
            "number,title,url",
        ],
    )
    .await?;

    let arr: Vec<serde_json::Value> =
        serde_json::from_str(&out).map_err(|e| format!("Failed to parse gh pr list: {}", e))?;

    let pr = match arr.first() {
        Some(p) => p,
        None => return Ok(None),
    };

    let number = pr["number"].as_i64().ok_or("Missing number")? as i32;
    let title = pr["title"].as_str().ok_or("Missing title")?.to_string();
    let url = pr["url"].as_str().ok_or("Missing url")?.to_string();

    Ok(Some(OpenPrInfo { number, title, url }))
}

/// Create a PR with gh; does not return PR details (caller should use get_open_pr_for_branch_inner after).
/// body: optional raw body from commit message; Acepe footer (badge) is appended in the stacked action when creating from app.
pub async fn create_pull_request(
    project_path: &Path,
    base_branch: &str,
    head_branch: &str,
    title: &str,
    body: Option<&str>,
) -> Result<(), String> {
    let mut args = vec![
        "pr",
        "create",
        "--base",
        base_branch,
        "--head",
        head_branch,
        "--title",
        title,
    ];

    if let Some(b) = body {
        if !b.is_empty() {
            args.push("--body");
            args.push(b);
        }
    }

    run_gh_command(project_path, &args).await?;
    Ok(())
}

/// Pull request state as reported by GitHub.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PrState {
    #[default]
    Open,
    Closed,
    Merged,
}

/// Merge strategy for pull requests.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum MergeStrategy {
    Squash,
    Merge,
    Rebase,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PrMergeRecoveryInfo {
    #[serde(default)]
    state: PrState,
    merged_at: Option<String>,
    #[serde(default)]
    head_ref_name: String,
    #[serde(default)]
    is_cross_repository: bool,
}

impl PrMergeRecoveryInfo {
    fn is_merged(&self) -> bool {
        self.merged_at.is_some() || matches!(self.state, PrState::Merged)
    }

    fn remote_branch_to_delete(&self) -> Option<&str> {
        if self.is_cross_repository {
            return None;
        }

        let branch = self.head_ref_name.trim();
        if branch.is_empty() {
            None
        } else {
            Some(branch)
        }
    }
}

async fn get_pr_merge_recovery_info(
    project_path: &Path,
    pr_number: i32,
) -> Result<PrMergeRecoveryInfo, String> {
    let number_str = pr_number.to_string();
    let out = run_gh_command(
        project_path,
        &[
            "pr",
            "view",
            &number_str,
            "--json",
            "state,mergedAt,headRefName,isCrossRepository",
        ],
    )
    .await?;

    serde_json::from_str::<PrMergeRecoveryInfo>(&out)
        .map_err(|e| format!("Failed to parse gh pr view merge recovery info: {}", e))
}

async fn delete_remote_branch(project_path: &Path, branch: &str) -> Result<(), String> {
    run_git_command(project_path, &["push", "origin", "--delete", branch]).await?;
    Ok(())
}

/// Merge a PR by number using `gh pr merge --delete-branch`.
pub async fn merge_pull_request(
    project_path: &Path,
    pr_number: i32,
    strategy: MergeStrategy,
) -> Result<(), String> {
    let number_str = pr_number.to_string();
    let strategy_flag = match strategy {
        MergeStrategy::Squash => "--squash",
        MergeStrategy::Merge => "--merge",
        MergeStrategy::Rebase => "--rebase",
    };
    match run_gh_command(
        project_path,
        &["pr", "merge", &number_str, strategy_flag, "--delete-branch"],
    )
    .await
    {
        Ok(_) => Ok(()),
        Err(merge_error) => {
            let recovery_info = match get_pr_merge_recovery_info(project_path, pr_number).await {
                Ok(info) => info,
                Err(recovery_error) => {
                    warn!(
                        pr_number,
                        merge_error = %merge_error,
                        recovery_error = %recovery_error,
                        "Failed to confirm PR state after gh merge error"
                    );
                    return Err(merge_error);
                }
            };

            if !recovery_info.is_merged() {
                return Err(merge_error);
            }

            warn!(
                pr_number,
                merge_error = %merge_error,
                branch = recovery_info.head_ref_name,
                "gh reported a merge failure after the PR was already merged; treating as success"
            );

            if let Some(branch) = recovery_info.remote_branch_to_delete() {
                if let Err(delete_error) = delete_remote_branch(project_path, branch).await {
                    warn!(
                        pr_number,
                        branch,
                        delete_error = %delete_error,
                        "Failed to delete remote branch after successful PR merge recovery"
                    );
                }
            }

            Ok(())
        }
    }
}

/// Tauri command: merge a PR by number with a chosen strategy.
#[tauri::command]
#[specta::specta]
pub async fn git_merge_pr(
    project_path: String,
    pr_number: i32,
    strategy: MergeStrategy,
) -> Result<(), String> {
    let path = crate::path_safety::validate_project_directory_from_str(&project_path)
        .map_err(|e| e.message_for(Path::new(project_path.trim())))?;
    merge_pull_request(&path, pr_number, strategy).await
}

/// A single commit in a PR (from `gh pr view --json commits`).
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PrCommit {
    #[serde(default)]
    pub oid: String,
    #[serde(rename = "messageHeadline", default)]
    pub message_headline: String,
    #[serde(default)]
    pub additions: i64,
    #[serde(default)]
    pub deletions: i64,
}

/// Full PR details fetched from GitHub via `gh pr view --json`.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PrDetails {
    #[serde(default)]
    pub number: i32,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub state: PrState,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub is_draft: bool,
    #[serde(default)]
    pub additions: i64,
    #[serde(default)]
    pub deletions: i64,
    #[serde(default)]
    pub commits: Vec<PrCommit>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawPrDetails {
    #[serde(default)]
    number: i32,
    #[serde(default)]
    title: String,
    #[serde(default)]
    body: String,
    #[serde(default)]
    state: PrState,
    #[serde(default)]
    url: String,
    #[serde(default)]
    is_draft: bool,
    #[serde(default)]
    additions: i64,
    #[serde(default)]
    deletions: i64,
    #[serde(default)]
    commits: Vec<PrCommit>,
    merged_at: Option<String>,
}

fn parse_pr_details(output: &str) -> Result<PrDetails, String> {
    let raw = serde_json::from_str::<RawPrDetails>(output)
        .map_err(|e| format!("Failed to parse gh pr view: {}", e))?;

    let state = if raw.merged_at.is_some() {
        PrState::Merged
    } else {
        raw.state
    };

    Ok(PrDetails {
        number: raw.number,
        title: raw.title,
        body: raw.body,
        state,
        url: raw.url,
        is_draft: raw.is_draft,
        additions: raw.additions,
        deletions: raw.deletions,
        commits: raw.commits,
    })
}

/// Fetch PR details by number using direct serde deserialization.
pub async fn get_pr_details(project_path: &Path, pr_number: i32) -> Result<PrDetails, String> {
    if pr_number <= 0 {
        return Err(format!("Invalid PR number: {}", pr_number));
    }
    let number_str = pr_number.to_string();
    let out = run_gh_command(
        project_path,
        &[
            "pr",
            "view",
            &number_str,
            "--json",
            "number,title,body,state,url,isDraft,additions,deletions,commits,mergedAt",
        ],
    )
    .await?;

    info!("gh pr view output: {}", out);
    parse_pr_details(&out)
}

/// Tauri command: fetch PR details by number.
#[tauri::command]
#[specta::specta]
pub async fn git_pr_details(project_path: String, pr_number: i32) -> Result<PrDetails, String> {
    let path = crate::path_safety::validate_project_directory_from_str(&project_path)
        .map_err(|e| e.message_for(Path::new(project_path.trim())))?;
    get_pr_details(&path, pr_number).await
}

/// Tauri command: get open PR for the current branch (for "View PR" in Git panel).
#[tauri::command]
#[specta::specta]
pub async fn get_open_pr_for_branch(project_path: String) -> Result<Option<OpenPrInfo>, String> {
    let path = crate::path_safety::validate_project_directory_from_str(&project_path)
        .map_err(|e| e.message_for(Path::new(project_path.trim())))?;

    let branch =
        crate::git::worktree::git_current_branch(path.to_string_lossy().into_owned()).await?;
    get_open_pr_for_branch_inner(&path, &branch).await
}

#[cfg(test)]
mod tests {
    #[cfg(unix)]
    use std::fs;
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;
    #[cfg(unix)]
    use std::path::PathBuf;
    #[cfg(unix)]
    use std::sync::OnceLock;
    use tokio::sync::Mutex;

    #[cfg(unix)]
    use tempfile::TempDir;

    #[cfg(unix)]
    use super::{merge_pull_request, MergeStrategy};
    use super::{parse_pr_details, PrState};

    #[cfg(unix)]
    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    #[cfg(unix)]
    struct EnvVarGuard {
        key: &'static str,
        original_value: Option<std::ffi::OsString>,
    }

    #[cfg(unix)]
    impl EnvVarGuard {
        fn set_path_like(key: &'static str, value: &std::path::Path) -> Self {
            let original_value = std::env::var_os(key);
            std::env::set_var(key, value);
            Self {
                key,
                original_value,
            }
        }
    }

    #[cfg(unix)]
    impl Drop for EnvVarGuard {
        fn drop(&mut self) {
            match &self.original_value {
                Some(value) => std::env::set_var(self.key, value),
                None => std::env::remove_var(self.key),
            }
        }
    }

    #[cfg(unix)]
    fn write_executable_script(bin_dir: &std::path::Path, name: &str, body: &str) -> PathBuf {
        let path = bin_dir.join(name);
        fs::write(&path, body).expect("write script");
        let mut permissions = fs::metadata(&path).expect("metadata").permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&path, permissions).expect("set permissions");
        path
    }

    #[cfg(unix)]
    fn setup_fake_binaries(gh_script: &str, git_script: &str) -> (TempDir, TempDir) {
        let repo_dir = TempDir::new().expect("repo dir");
        let bin_dir = TempDir::new().expect("bin dir");
        write_executable_script(bin_dir.path(), "gh", gh_script);
        write_executable_script(bin_dir.path(), "git", git_script);
        (repo_dir, bin_dir)
    }

    #[test]
    fn parse_pr_details_marks_merged_prs_as_merged() {
        let json = r#"{
            "number": 83,
            "title": "Fix badge state",
            "body": "",
            "state": "CLOSED",
            "url": "https://github.com/acme/repo/pull/83",
            "isDraft": false,
            "additions": 10,
            "deletions": 2,
            "commits": [],
            "mergedAt": "2026-03-19T09:00:00Z"
        }"#;

        let details = parse_pr_details(json).expect("expected merged PR payload to parse");

        assert!(matches!(details.state, PrState::Merged));
    }

    #[test]
    fn parse_pr_details_keeps_closed_prs_closed_when_not_merged() {
        let json = r#"{
            "number": 84,
            "title": "Close without merge",
            "body": "",
            "state": "CLOSED",
            "url": "https://github.com/acme/repo/pull/84",
            "isDraft": false,
            "additions": 3,
            "deletions": 1,
            "commits": [],
            "mergedAt": null
        }"#;

        let details = parse_pr_details(json).expect("expected closed PR payload to parse");

        assert!(matches!(details.state, PrState::Closed));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn merge_pull_request_treats_worktree_cleanup_failure_as_success_when_pr_is_merged() {
        let _env_guard = env_lock().lock().await;
        let (repo_dir, bin_dir) = setup_fake_binaries(
            r#"#!/bin/sh
if [ "$1" = "pr" ] && [ "$2" = "merge" ]; then
  echo "failed to run git: fatal: 'main' is already used by worktree at '/Users/example/Documents/acepe'" >&2
  exit 1
fi
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  printf '%s' '{"state":"MERGED","mergedAt":"2026-03-19T21:53:00Z","headRefName":"acepe/bright-willow","isCrossRepository":false}'
  exit 0
fi
echo "unexpected gh args: $@" >&2
exit 1
"#,
            r#"#!/bin/sh
echo "$@" >> "$TEST_LOG_DIR/git.log"
exit 0
"#,
        );

        let _gh_bin_guard = EnvVarGuard::set_path_like("ACEPE_GH_BIN", &bin_dir.path().join("gh"));
        let _git_bin_guard =
            EnvVarGuard::set_path_like("ACEPE_GIT_BIN", &bin_dir.path().join("git"));
        let _test_log_guard = EnvVarGuard::set_path_like("TEST_LOG_DIR", repo_dir.path());

        let result = merge_pull_request(repo_dir.path(), 90, MergeStrategy::Squash).await;

        assert!(
            result.is_ok(),
            "expected merged PR cleanup failure to be treated as success"
        );

        let git_log = fs::read_to_string(repo_dir.path().join("git.log")).expect("read git log");
        assert!(
            git_log.contains("push origin --delete acepe/bright-willow"),
            "expected remote branch cleanup after merge recovery, got: {}",
            git_log
        );
    }
}
