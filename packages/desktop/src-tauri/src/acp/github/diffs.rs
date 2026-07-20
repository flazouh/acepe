use std::path::Path;
use std::process::Command;

use super::repo_context::get_repo_context;
use super::types::{CommitDiff, FileDiff, RepoContext};

/// Parses git show output to extract individual file diffs with statistics.
pub fn parse_git_diff(diff_text: &str) -> Vec<FileDiff> {
    let mut files = Vec::new();
    let mut current_file: Option<FileDiff> = None;
    let mut patch_content = String::new();
    let mut in_patch_section = false;

    for line in diff_text.lines() {
        if line.starts_with("diff --git") {
            if let Some(mut file) = current_file.take() {
                file.patch = patch_content.trim().to_string();
                files.push(file);
                patch_content.clear();
            }

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
            } else if line.starts_with("@@")
                || line.starts_with("---")
                || line.starts_with("+++")
                || (!line.starts_with("index ") && !line.is_empty() && !patch_content.is_empty())
            {
                patch_content.push_str(line);
                patch_content.push('\n');
            }
        }
    }

    if let Some(mut file) = current_file.take() {
        file.patch = patch_content.trim().to_string();
        files.push(file);
    }

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

pub fn fetch_working_file_diff(
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

fn fetch_commit_diff_via_git(sha: &str, project_path: &Path) -> Result<CommitDiff, String> {
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

fn fetch_commit_diff_via_gh(sha: &str, owner: &str, repo: &str) -> Result<CommitDiff, String> {
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

pub fn fetch_commit_diff(
    sha: &str,
    project_path: &Path,
    repo_context: Option<&RepoContext>,
) -> Result<CommitDiff, String> {
    if let Ok(diff) = fetch_commit_diff_via_git(sha, project_path) {
        return Ok(diff);
    }

    if let Some(context) = repo_context {
        fetch_commit_diff_via_gh(sha, &context.owner, &context.repo)
    } else {
        Err("Could not fetch commit diff with git or gh CLI".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::{fetch_working_file_diff, parse_git_diff};
    use crate::acp::github::repo_context::get_repo_context;
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

        let diff = fetch_working_file_diff(path, "tracked.txt", false, "modified", 1, 0)
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

        let diff = fetch_working_file_diff(path, "staged.txt", true, "added", 2, 0)
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

        let diff = fetch_working_file_diff(path, "notes.txt", false, "added", 1, 0)
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
            &[
                "remote",
                "add",
                "fork",
                "git@github.com:flazouh/forgecode.git",
            ],
        );
        git(
            path,
            &[
                "remote",
                "add",
                "origin",
                "git@github.com:flazouh/acepe.git",
            ],
        );

        let context = get_repo_context(path).expect("repo context should resolve from origin");

        assert_eq!(context.owner, "flazouh");
        assert_eq!(context.repo, "acepe");
        assert_eq!(context.remote_url, "git@github.com:flazouh/acepe.git");
    }

    #[test]
    fn parse_git_diff_extracts_file_statuses() {
        let diff_text = "diff --git a/a.txt b/a.txt\nnew file mode 100644\n--- /dev/null\n+++ b/a.txt\n@@\n+hello\n";
        let files = parse_git_diff(diff_text);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].status, "added");
        assert_eq!(files[0].path, "a.txt");
    }
}
