//! Git status extraction using the `git2` crate.

use std::ffi::OsStr;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use git2::{DiffOptions, ErrorCode, Repository, StatusOptions};
use tracing::debug;

use super::types::{FileGitStatus, ProjectGitOverview};

/// Get git status for all modified files in a repository.
///
/// Returns a list of files with their status (M/A/D/?) and line change counts.
pub fn get_git_status(project_path: &Path) -> Result<Vec<FileGitStatus>> {
    get_git_status_with_mode(project_path, DiffStatsMode::PerFile, true)
}

/// Get git status for all modified files in a repository without diff stats.
///
/// This is intentionally TCC-safe for metadata surfaces (e.g. project cards):
/// status flags are collected, but file-content diffs are not computed.
pub fn get_git_status_summary(project_path: &Path) -> Result<Vec<FileGitStatus>> {
    // Summary mode is intentionally conservative to avoid TCC prompt bursts:
    // skip untracked traversal and diff-stat computation.
    get_git_status_with_mode(project_path, DiffStatsMode::None, false)
}

#[derive(Clone, Copy)]
enum DiffStatsMode {
    PerFile,
    None,
}

fn get_git_status_with_mode(
    project_path: &Path,
    diff_stats_mode: DiffStatsMode,
    include_untracked: bool,
) -> Result<Vec<FileGitStatus>> {
    let repo = match open_repository(project_path) {
        Ok(repo) => repo,
        Err(error) if is_missing_repository_error(&error) => return Ok(Vec::new()),
        Err(error) => return Err(error),
    };
    get_git_status_with_repo(&repo, project_path, diff_stats_mode, include_untracked)
}

fn is_missing_repository_error(error: &anyhow::Error) -> bool {
    error
        .chain()
        .filter_map(|cause| cause.downcast_ref::<git2::Error>())
        .any(|git_error| git_error.code() == ErrorCode::NotFound)
}

fn get_git_status_with_repo(
    repo: &Repository,
    project_path: &Path,
    diff_stats_mode: DiffStatsMode,
    include_untracked: bool,
) -> Result<Vec<FileGitStatus>> {
    let mut opts = StatusOptions::new();
    opts.include_untracked(include_untracked)
        // Avoid deep recursive traversal of untracked trees.
        // This keeps project-card metadata probing TCC-safe on macOS.
        .recurse_untracked_dirs(false)
        .include_ignored(false)
        .exclude_submodules(true);

    if let Some(pathspec) = build_repo_scope_pathspec(repo, project_path) {
        opts.pathspec(pathspec);
    }

    let statuses = repo
        .statuses(Some(&mut opts))
        .context("Failed to get repository status")?;

    let mut results = Vec::new();

    for entry in statuses.iter() {
        let status = entry.status();
        let path = entry.path().unwrap_or("").to_string();

        // Skip empty paths
        if path.is_empty() {
            continue;
        }

        let status_char = get_status_char(status);

        // Only compute diff stats for tracked file updates.
        // Avoid probing untracked/new paths and directory markers to stay TCC-safe.
        let (insertions, deletions) = match diff_stats_mode {
            DiffStatsMode::PerFile if should_compute_diff_stats(status, &path) => {
                get_diff_stats(repo, &path).unwrap_or((0, 0))
            }
            _ => (0, 0),
        };

        results.push(FileGitStatus {
            path,
            status: status_char.to_string(),
            insertions,
            deletions,
        });
    }

    Ok(results)
}

/// Get branch + git status summary in a single repository probe.
///
/// This is designed for project-card metadata loading so UI can render branch
/// and change counts without issuing multiple git/filesystem passes.
pub fn get_git_overview_summary(project_path: &Path) -> Result<ProjectGitOverview> {
    let repo = open_repository(project_path)?;
    let branch = get_branch_name(&repo);
    let git_status = get_git_status_with_repo(&repo, project_path, DiffStatsMode::PerFile, true)?;

    Ok(ProjectGitOverview { branch, git_status })
}

pub(crate) fn get_branch_name(repo: &Repository) -> Option<String> {
    match repo.head() {
        Ok(head) => head.shorthand().map(ToOwned::to_owned),
        Err(e) if e.code() == git2::ErrorCode::UnbornBranch => {
            repo.find_reference("HEAD").ok().and_then(|r| {
                r.symbolic_target()
                    .map(|s| s.strip_prefix("refs/heads/").unwrap_or(s).to_owned())
            })
        }
        Err(_) => None,
    }
}

pub(crate) fn open_repository(project_path: &Path) -> Result<Repository> {
    if let Ok(repo) = Repository::open(project_path) {
        return Ok(repo);
    }

    let discovered_path = discover_repository_path(project_path)?;
    Repository::open(&discovered_path).with_context(|| {
        format!(
            "Failed to open discovered git repository at {}",
            discovered_path.display()
        )
    })
}

fn discover_repository_path(project_path: &Path) -> Result<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        if let Some(home_dir) = dirs::home_dir() {
            // Never climb all the way into $HOME during repo discovery on macOS.
            // This avoids accidental fallback to a broad home-level repo, which can
            // trigger TCC prompts when metadata surfaces ask for git status.
            return Repository::discover_path(project_path, [home_dir.as_os_str()])
                .context("Failed to discover git repository");
        }
    }

    Repository::discover_path(project_path, std::iter::empty::<&OsStr>())
        .context("Failed to discover git repository")
}

fn build_repo_scope_pathspec(repo: &Repository, project_path: &Path) -> Option<String> {
    let workdir = repo.workdir()?;

    if project_path == workdir {
        return None;
    }

    if let Ok(relative) = project_path.strip_prefix(workdir) {
        return path_to_git_pathspec(relative);
    }

    let workdir_canonical = std::fs::canonicalize(workdir).ok()?;
    let project_canonical = std::fs::canonicalize(project_path).ok()?;
    if project_canonical == workdir_canonical {
        return None;
    }

    project_canonical
        .strip_prefix(workdir_canonical)
        .ok()
        .and_then(path_to_git_pathspec)
}

fn path_to_git_pathspec(relative: &Path) -> Option<String> {
    if relative.as_os_str().is_empty() {
        return None;
    }

    let normalized = relative.to_string_lossy().replace('\\', "/");
    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

fn should_compute_diff_stats(status: git2::Status, path: &str) -> bool {
    if path.ends_with('/') {
        return false;
    }

    if status.is_wt_new() || status.is_index_new() {
        return false;
    }

    true
}

/// Convert git2 status flags to a single character status code.
fn get_status_char(status: git2::Status) -> &'static str {
    if status.is_index_new() || status.is_wt_new() {
        "A"
    } else if status.is_index_modified() || status.is_wt_modified() {
        "M"
    } else if status.is_index_deleted() || status.is_wt_deleted() {
        "D"
    } else if status.is_index_renamed() || status.is_wt_renamed() {
        "R"
    } else if status.is_conflicted() {
        "U"
    } else {
        "?"
    }
}

/// Get file content from HEAD commit.
///
/// Returns None if the file doesn't exist in HEAD (new file).
pub fn get_file_content_from_head(project_path: &Path, file_path: &str) -> Result<Option<String>> {
    let repo = open_repository(project_path)?;

    let head = match repo.head() {
        Ok(head) => head,
        Err(_) => return Ok(None), // No HEAD (empty repo)
    };

    let head_tree = head.peel_to_tree().context("Failed to peel HEAD to tree")?;

    let candidates = build_head_lookup_candidates(&repo, project_path, file_path);
    debug!(
        project_path = %project_path.display(),
        file_path,
        candidates = ?candidates,
        "Looking up file content from HEAD"
    );

    let entry = match candidates
        .iter()
        .find_map(|candidate| head_tree.get_path(candidate).ok())
    {
        Some(entry) => entry,
        None => {
            debug!(
                project_path = %project_path.display(),
                file_path,
                "No HEAD entry found for file path candidates"
            );
            return Ok(None);
        } // File doesn't exist in HEAD (new file)
    };

    let object = entry
        .to_object(&repo)
        .context("Failed to get tree entry object")?;

    let blob = object.as_blob().context("Tree entry is not a blob")?;

    let content = std::str::from_utf8(blob.content())
        .context("File content is not valid UTF-8")?
        .to_string();

    Ok(Some(content))
}

fn build_head_lookup_candidates(
    repo: &Repository,
    project_path: &Path,
    file_path: &str,
) -> Vec<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    let input_path = Path::new(file_path);

    if input_path.is_relative() {
        candidates.push(input_path.to_path_buf());
    }

    if let Some(workdir) = repo.workdir() {
        if input_path.is_absolute() {
            if let Some(relative) = strip_path_prefix_with_canonical_fallback(input_path, workdir) {
                candidates.push(relative.to_path_buf());
            }
        } else {
            let from_project = project_path.join(input_path);
            if let Some(relative) =
                strip_path_prefix_with_canonical_fallback(from_project.as_path(), workdir)
            {
                candidates.push(relative.to_path_buf());
            }
        }
    }

    let mut deduped: Vec<PathBuf> = Vec::new();
    for candidate in candidates {
        if !candidate.as_os_str().is_empty() && !deduped.contains(&candidate) {
            deduped.push(candidate);
        }
    }

    deduped
}

fn strip_path_prefix_with_canonical_fallback<'a>(
    path: &'a Path,
    prefix: &'a Path,
) -> Option<PathBuf> {
    if let Ok(relative) = path.strip_prefix(prefix) {
        return Some(relative.to_path_buf());
    }

    let canonical_path = std::fs::canonicalize(path).ok()?;
    let canonical_prefix = std::fs::canonicalize(prefix).ok()?;
    canonical_path
        .strip_prefix(canonical_prefix)
        .ok()
        .map(|relative| relative.to_path_buf())
}

/// Get diff stats (insertions/deletions) for a specific file.
fn get_diff_stats(repo: &Repository, path: &str) -> Result<(u64, u64)> {
    // Get HEAD tree for comparison
    let head = match repo.head() {
        Ok(head) => head,
        Err(_) => {
            // No HEAD (empty repo or initial commit)
            return Ok((0, 0));
        }
    };

    let head_tree = head.peel_to_tree().context("Failed to peel HEAD to tree")?;

    let mut opts = DiffOptions::new();
    opts.pathspec(path);

    let diff = repo
        .diff_tree_to_workdir_with_index(Some(&head_tree), Some(&mut opts))
        .context("Failed to create diff")?;

    let stats = diff.stats().context("Failed to get diff stats")?;

    Ok((stats.insertions() as u64, stats.deletions() as u64))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::process::Command;
    use tempfile::TempDir;

    fn init_git_repo(dir: &Path) {
        Command::new("git")
            .args(["init"])
            .current_dir(dir)
            .output()
            .expect("Failed to init git repo");

        Command::new("git")
            .args(["config", "user.email", "test@test.com"])
            .current_dir(dir)
            .output()
            .expect("Failed to set git email");

        Command::new("git")
            .args(["config", "user.name", "Test"])
            .current_dir(dir)
            .output()
            .expect("Failed to set git name");

        Command::new("git")
            .args(["config", "commit.gpgsign", "false"])
            .current_dir(dir)
            .output()
            .expect("Failed to disable commit signing");
    }

    #[test]
    fn test_get_git_status_new_file() {
        let dir = TempDir::new().unwrap();
        init_git_repo(dir.path());

        // Create a new untracked file
        fs::write(dir.path().join("new_file.txt"), "hello\nworld\n").unwrap();

        let status = get_git_status(dir.path()).unwrap();

        assert_eq!(status.len(), 1);
        assert_eq!(status[0].path, "new_file.txt");
        assert_eq!(status[0].status, "A");
    }

    #[test]
    fn test_get_git_status_modified_file() {
        let dir = TempDir::new().unwrap();
        init_git_repo(dir.path());

        // Create and commit a file
        fs::write(dir.path().join("file.txt"), "original\n").unwrap();

        Command::new("git")
            .args(["add", "file.txt"])
            .current_dir(dir.path())
            .output()
            .expect("Failed to add file");

        Command::new("git")
            .args(["commit", "-m", "initial"])
            .current_dir(dir.path())
            .output()
            .expect("Failed to commit");

        // Modify the file
        fs::write(dir.path().join("file.txt"), "modified\nwith\nnew\nlines\n").unwrap();

        let status = get_git_status(dir.path()).unwrap();

        assert_eq!(status.len(), 1);
        assert_eq!(status[0].path, "file.txt");
        assert_eq!(status[0].status, "M");
        // Should have insertions (new lines) and deletions (removed original)
        assert!(status[0].insertions > 0 || status[0].deletions > 0);
    }

    #[test]
    fn test_get_git_status_summary_skips_per_file_diff_stats() {
        let dir = TempDir::new().unwrap();
        init_git_repo(dir.path());

        // Create and commit a file
        fs::write(dir.path().join("file.txt"), "original\n").unwrap();

        Command::new("git")
            .args(["add", "file.txt"])
            .current_dir(dir.path())
            .output()
            .expect("Failed to add file");

        Command::new("git")
            .args(["commit", "-m", "initial"])
            .current_dir(dir.path())
            .output()
            .expect("Failed to commit");

        // Modify the file
        fs::write(dir.path().join("file.txt"), "modified\nwith\nnew\nlines\n").unwrap();

        let status = get_git_status_summary(dir.path()).unwrap();

        assert_eq!(status.len(), 1);
        assert_eq!(status[0].path, "file.txt");
        assert_eq!(status[0].status, "M");
        assert_eq!(status[0].insertions, 0);
        assert_eq!(status[0].deletions, 0);
    }

    #[test]
    fn test_get_git_status_supports_nested_project_path() {
        let dir = TempDir::new().unwrap();
        init_git_repo(dir.path());

        let nested_dir = dir.path().join("nested");
        fs::create_dir_all(&nested_dir).unwrap();
        fs::write(nested_dir.join("file.txt"), "hello\n").unwrap();

        Command::new("git")
            .args(["add", "nested/file.txt"])
            .current_dir(dir.path())
            .output()
            .expect("Failed to add file");

        Command::new("git")
            .args(["commit", "-m", "initial"])
            .current_dir(dir.path())
            .output()
            .expect("Failed to commit");

        fs::write(nested_dir.join("file.txt"), "hello\nworld\n").unwrap();

        let status = get_git_status(&nested_dir).unwrap();
        assert_eq!(status.len(), 1);
        assert_eq!(status[0].path, "nested/file.txt");
        assert_eq!(status[0].status, "M");
    }

    #[test]
    fn test_get_file_content_from_head_handles_nested_project_relative_and_absolute_paths() {
        let dir = TempDir::new().unwrap();
        init_git_repo(dir.path());

        let nested_dir = dir.path().join("nested");
        fs::create_dir_all(&nested_dir).unwrap();
        let nested_file = nested_dir.join("file.txt");
        fs::write(&nested_file, "hello\n").unwrap();

        Command::new("git")
            .args(["add", "nested/file.txt"])
            .current_dir(dir.path())
            .output()
            .expect("Failed to add file");

        Command::new("git")
            .args(["commit", "-m", "initial"])
            .current_dir(dir.path())
            .output()
            .expect("Failed to commit");

        fs::write(&nested_file, "hello\nworld\n").unwrap();

        let relative_from_project = get_file_content_from_head(&nested_dir, "file.txt").unwrap();
        assert_eq!(relative_from_project.as_deref(), Some("hello\n"));

        let absolute = nested_file.to_string_lossy().to_string();
        let absolute_result = get_file_content_from_head(&nested_dir, &absolute).unwrap();
        assert_eq!(absolute_result.as_deref(), Some("hello\n"));
    }

    #[test]
    fn test_get_git_overview_summary_uses_nested_project_path_and_branch() {
        let dir = TempDir::new().unwrap();
        init_git_repo(dir.path());

        let nested_dir = dir.path().join("nested");
        fs::create_dir_all(&nested_dir).unwrap();
        fs::write(nested_dir.join("file.txt"), "hello\n").unwrap();

        Command::new("git")
            .args(["add", "nested/file.txt"])
            .current_dir(dir.path())
            .output()
            .expect("Failed to add file");

        Command::new("git")
            .args(["commit", "-m", "initial"])
            .current_dir(dir.path())
            .output()
            .expect("Failed to commit");

        fs::write(nested_dir.join("file.txt"), "hello\nworld\n").unwrap();

        let overview = get_git_overview_summary(&nested_dir).unwrap();
        let branch = overview.branch.expect("branch should be present");
        assert!(
            branch == "main" || branch == "master",
            "expected main/master branch, got {branch}"
        );
        assert_eq!(overview.git_status.len(), 1);
        assert_eq!(overview.git_status[0].path, "nested/file.txt");
        assert_eq!(overview.git_status[0].status, "M");
    }

    #[test]
    fn test_get_git_overview_summary_scopes_status_to_nested_project_path() {
        let dir = TempDir::new().unwrap();
        init_git_repo(dir.path());

        let nested_dir = dir.path().join("nested");
        fs::create_dir_all(&nested_dir).unwrap();
        fs::write(nested_dir.join("scoped.txt"), "hello\n").unwrap();
        fs::write(dir.path().join("outside.txt"), "outside\n").unwrap();

        Command::new("git")
            .args(["add", "nested/scoped.txt", "outside.txt"])
            .current_dir(dir.path())
            .output()
            .expect("Failed to add files");

        Command::new("git")
            .args(["commit", "-m", "initial"])
            .current_dir(dir.path())
            .output()
            .expect("Failed to commit");

        fs::write(nested_dir.join("scoped.txt"), "hello\nchanged\n").unwrap();
        fs::write(dir.path().join("outside.txt"), "outside\nchanged\n").unwrap();

        let overview = get_git_overview_summary(&nested_dir).unwrap();
        let changed_paths = overview
            .git_status
            .iter()
            .map(|status| status.path.as_str())
            .collect::<Vec<_>>();

        assert_eq!(changed_paths, vec!["nested/scoped.txt"]);
    }

    #[test]
    fn test_get_git_status_does_not_recurse_untracked_directories() {
        let dir = TempDir::new().unwrap();
        init_git_repo(dir.path());

        let nested_dir = dir.path().join("nested");
        fs::create_dir_all(&nested_dir).unwrap();
        fs::write(nested_dir.join("child.txt"), "hello").unwrap();

        let status = get_git_status(dir.path()).unwrap();

        assert!(
            status.iter().all(|entry| entry.path != "nested/child.txt"),
            "git status should not recurse into untracked directories"
        );
    }

    #[test]
    fn test_get_git_status_returns_empty_for_non_repo_directory() {
        let dir = TempDir::new().unwrap();

        let status = get_git_status(dir.path()).unwrap();

        assert!(status.is_empty());
    }

    #[test]
    fn test_should_compute_diff_stats_for_modified_file() {
        let status = git2::Status::WT_MODIFIED;
        assert!(should_compute_diff_stats(status, "src/main.rs"));
    }

    #[test]
    fn test_should_not_compute_diff_stats_for_untracked_file() {
        let status = git2::Status::WT_NEW;
        assert!(!should_compute_diff_stats(status, "tmp/new.txt"));
    }

    #[test]
    fn test_should_not_compute_diff_stats_for_directory_marker() {
        let status = git2::Status::WT_NEW;
        assert!(!should_compute_diff_stats(status, "tmp/"));
    }
}
