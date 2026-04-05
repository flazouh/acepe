//! Resolves the effective OpenCode runtime root from an arbitrary input directory.
//!
//! The resolver canonicalizes the input path, walks upward to detect git repo
//! roots and worktree roots, and returns a [`ResolvedOpenCodeRoot`] that
//! uniquely identifies the OpenCode runtime ownership boundary.
//!
//! This module is the single source of truth for runtime root derivation.
//! All call sites that need to key the manager registry, bind the HTTP client,
//! or persist session metadata should use [`resolve`] instead of ad-hoc
//! `.git` detection or manual canonicalization.

use std::path::{Path, PathBuf};

/// The resolved OpenCode runtime root — a backend-only helper, not persisted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedOpenCodeRoot {
    /// The directory that owns the OpenCode manager registry entry and is
    /// posted as the HTTP `directory` parameter.
    pub runtime_root: PathBuf,
    /// The canonical main repo root, used for project grouping and metadata
    /// persistence.
    pub project_root: PathBuf,
    /// Present only when the effective runtime root is a git worktree.
    pub worktree_root: Option<PathBuf>,
}

/// Errors that can occur during runtime root resolution.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResolveError {
    /// The input path does not exist on disk.
    PathNotFound(PathBuf),
    /// The input path is not a directory.
    NotDirectory(PathBuf),
    /// The input path is empty.
    EmptyPath,
}

impl std::fmt::Display for ResolveError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::PathNotFound(p) => write!(f, "path not found: {}", p.display()),
            Self::NotDirectory(p) => write!(f, "not a directory: {}", p.display()),
            Self::EmptyPath => write!(f, "empty path"),
        }
    }
}

impl std::error::Error for ResolveError {}

/// Resolve an arbitrary input directory to its effective OpenCode runtime root.
///
/// Resolution rules (in order):
///
/// 1. Canonicalize the input (resolves symlinks and case on macOS).
/// 2. Walk upward from the canonical path looking for a `.git` entry.
///    - If `.git` is a **file** (git worktree), parse it to find the main
///      repo. `runtime_root` = worktree root, `project_root` = main repo,
///      `worktree_root` = worktree root.
///    - If `.git` is a **directory** (normal repo), `runtime_root` =
///      `project_root` = that directory's parent, `worktree_root` = None.
/// 3. If no `.git` is found in any ancestor, `runtime_root` =
///    `project_root` = the canonical input, `worktree_root` = None.
pub fn resolve(input: &Path) -> Result<ResolvedOpenCodeRoot, ResolveError> {
    if input.as_os_str().is_empty() {
        return Err(ResolveError::EmptyPath);
    }

    let canonical = std::fs::canonicalize(input)
        .map_err(|_| ResolveError::PathNotFound(input.to_path_buf()))?;

    if !canonical.is_dir() {
        return Err(ResolveError::NotDirectory(canonical));
    }

    // Walk upward looking for a .git entry.
    let mut current = canonical.as_path();
    loop {
        let dot_git = current.join(".git");
        if dot_git.is_file() {
            // This is a git worktree. Parse .git file to find main repo.
            if let Some(main_repo) = parse_gitfile_to_main_repo(&dot_git) {
                let canonical_main =
                    std::fs::canonicalize(&main_repo).unwrap_or(main_repo);
                return Ok(ResolvedOpenCodeRoot {
                    runtime_root: current.to_path_buf(),
                    project_root: canonical_main,
                    worktree_root: Some(current.to_path_buf()),
                });
            }
            // If .git file is malformed, treat as no-git and keep walking.
        } else if dot_git.is_dir() {
            // Normal git repo root.
            return Ok(ResolvedOpenCodeRoot {
                runtime_root: current.to_path_buf(),
                project_root: current.to_path_buf(),
                worktree_root: None,
            });
        }

        match current.parent() {
            Some(parent) if parent != current => current = parent,
            _ => break,
        }
    }

    // No git root found — use the canonical input as-is.
    Ok(ResolvedOpenCodeRoot {
        runtime_root: canonical.clone(),
        project_root: canonical,
        worktree_root: None,
    })
}

/// Produce the normalized registry key string for a resolved root.
///
/// On case-insensitive filesystems (macOS), `std::fs::canonicalize` already
/// returns the on-disk casing, so two differently-cased inputs that refer to
/// the same directory produce identical keys.
pub fn registry_key(resolved: &ResolvedOpenCodeRoot) -> String {
    resolved.runtime_root.to_string_lossy().to_string()
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Parse a `.git` *file* (as found in worktrees) to derive the main repo root.
///
/// The file contains `gitdir: <path>` pointing into the main repo's
/// `.git/worktrees/<name>` directory.  We walk three parents up from that
/// resolved path to reach the main repo root:
///
///   <main-repo>/.git/worktrees/<name>
///   └── parent³ = <main-repo>
fn parse_gitfile_to_main_repo(dot_git_file: &Path) -> Option<PathBuf> {
    let content = std::fs::read_to_string(dot_git_file).ok()?;
    let gitdir_str = content.strip_prefix("gitdir: ")?.trim();
    let gitdir = Path::new(gitdir_str);

    // Resolve relative gitdir paths against the worktree directory.
    let resolved = if gitdir.is_absolute() {
        gitdir.to_path_buf()
    } else {
        dot_git_file.parent()?.join(gitdir)
    };

    // <main-repo>/.git/worktrees/<name> → 3 parents up → <main-repo>
    resolved
        .parent()
        .and_then(Path::parent)
        .and_then(Path::parent)
        .map(Path::to_path_buf)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::process::Command;
    use tempfile::TempDir;

    // -----------------------------------------------------------------------
    // Test helpers — mirror the patterns in git/worktree.rs tests
    // -----------------------------------------------------------------------

    fn run_git(cwd: &Path, args: &[&str]) -> std::process::Output {
        Command::new("git")
            .args(args)
            .current_dir(cwd)
            .env_remove("GIT_DIR")
            .env_remove("GIT_WORK_TREE")
            .output()
            .expect("git command should execute")
    }

    fn run_git_with_env(
        cwd: &Path,
        args: &[&str],
        extra_env: &[(&str, &str)],
    ) -> std::process::Output {
        let mut cmd = Command::new("git");
        cmd.args(args)
            .current_dir(cwd)
            .env_remove("GIT_DIR")
            .env_remove("GIT_WORK_TREE");
        for (key, value) in extra_env {
            cmd.env(key, value);
        }
        cmd.output().expect("git command should execute")
    }

    fn init_repo(dir: &Path) {
        let out = run_git(dir, &["init"]);
        assert!(out.status.success(), "git init failed");
        let out = run_git(dir, &["symbolic-ref", "HEAD", "refs/heads/main"]);
        assert!(out.status.success(), "set HEAD to main failed");
    }

    fn commit_file(dir: &Path, name: &str, content: &str, msg: &str) {
        fs::write(dir.join(name), content).expect("write file");
        let out = run_git(dir, &["add", "-A"]);
        assert!(out.status.success(), "git add failed");
        let out = run_git_with_env(
            dir,
            &["commit", "-m", msg],
            &[
                ("GIT_AUTHOR_NAME", "Test"),
                ("GIT_AUTHOR_EMAIL", "test@test"),
                ("GIT_COMMITTER_NAME", "Test"),
                ("GIT_COMMITTER_EMAIL", "test@test"),
            ],
        );
        assert!(
            out.status.success(),
            "git commit failed: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    }

    fn create_worktree(main_repo: &Path, worktree_dir: &Path, branch: &str) {
        let out = run_git(
            main_repo,
            &[
                "worktree",
                "add",
                "-b",
                branch,
                &worktree_dir.to_string_lossy(),
            ],
        );
        assert!(
            out.status.success(),
            "git worktree add failed: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    }

    // -----------------------------------------------------------------------
    // Phase 1a tests: resolver correctness
    // -----------------------------------------------------------------------

    #[test]
    fn subdirectory_resolves_to_repo_root() {
        let temp = TempDir::new().unwrap();
        let repo = temp.path().join("repo");
        fs::create_dir_all(&repo).unwrap();
        init_repo(&repo);
        commit_file(&repo, "README.md", "hello", "init");

        let sub = repo.join("src").join("lib");
        fs::create_dir_all(&sub).unwrap();

        let resolved = resolve(&sub).expect("resolve should succeed");

        let canonical_repo = fs::canonicalize(&repo).unwrap();
        assert_eq!(resolved.runtime_root, canonical_repo);
        assert_eq!(resolved.project_root, canonical_repo);
        assert_eq!(resolved.worktree_root, None);
    }

    #[test]
    fn repo_root_resolves_to_itself() {
        let temp = TempDir::new().unwrap();
        let repo = temp.path().join("repo");
        fs::create_dir_all(&repo).unwrap();
        init_repo(&repo);
        commit_file(&repo, "README.md", "hello", "init");

        let resolved = resolve(&repo).expect("resolve should succeed");

        let canonical_repo = fs::canonicalize(&repo).unwrap();
        assert_eq!(resolved.runtime_root, canonical_repo);
        assert_eq!(resolved.project_root, canonical_repo);
        assert_eq!(resolved.worktree_root, None);
    }

    #[test]
    fn worktree_root_resolves_correctly() {
        let temp = TempDir::new().unwrap();
        let main_repo = temp.path().join("main");
        let wt_dir = temp.path().join("worktree-a");
        fs::create_dir_all(&main_repo).unwrap();
        init_repo(&main_repo);
        commit_file(&main_repo, "README.md", "hello", "init");
        create_worktree(&main_repo, &wt_dir, "acepe/test-wt");

        let resolved = resolve(&wt_dir).expect("resolve should succeed");

        let canonical_main = fs::canonicalize(&main_repo).unwrap();
        let canonical_wt = fs::canonicalize(&wt_dir).unwrap();

        assert_eq!(
            resolved.runtime_root, canonical_wt,
            "runtime_root should be the worktree itself"
        );
        assert_eq!(
            resolved.project_root, canonical_main,
            "project_root should be the main repo"
        );
        assert_eq!(
            resolved.worktree_root,
            Some(canonical_wt),
            "worktree_root should be set"
        );
    }

    #[test]
    fn worktree_subdirectory_resolves_to_worktree_root() {
        let temp = TempDir::new().unwrap();
        let main_repo = temp.path().join("main");
        let wt_dir = temp.path().join("wt-sub");
        fs::create_dir_all(&main_repo).unwrap();
        init_repo(&main_repo);
        commit_file(&main_repo, "README.md", "hello", "init");
        create_worktree(&main_repo, &wt_dir, "acepe/sub-test");

        let sub = wt_dir.join("deep").join("nested");
        fs::create_dir_all(&sub).unwrap();

        let resolved = resolve(&sub).expect("resolve should succeed");

        let canonical_wt = fs::canonicalize(&wt_dir).unwrap();
        let canonical_main = fs::canonicalize(&main_repo).unwrap();

        assert_eq!(resolved.runtime_root, canonical_wt);
        assert_eq!(resolved.project_root, canonical_main);
        assert_eq!(resolved.worktree_root, Some(canonical_wt));
    }

    #[test]
    fn non_git_directory_resolves_to_itself() {
        let temp = TempDir::new().unwrap();
        let dir = temp.path().join("plain-dir");
        fs::create_dir_all(&dir).unwrap();

        let resolved = resolve(&dir).expect("resolve should succeed");

        let canonical = fs::canonicalize(&dir).unwrap();
        assert_eq!(resolved.runtime_root, canonical);
        assert_eq!(resolved.project_root, canonical);
        assert_eq!(resolved.worktree_root, None);
    }

    #[test]
    fn symlinked_path_resolves_to_same_root_as_real_path() {
        let temp = TempDir::new().unwrap();
        let repo = temp.path().join("real-repo");
        fs::create_dir_all(&repo).unwrap();
        init_repo(&repo);
        commit_file(&repo, "README.md", "hello", "init");

        let symlink = temp.path().join("link-repo");
        #[cfg(unix)]
        std::os::unix::fs::symlink(&repo, &symlink).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_dir(&repo, &symlink).unwrap();

        let from_real = resolve(&repo).expect("resolve from real path");
        let from_link = resolve(&symlink).expect("resolve from symlink");

        assert_eq!(
            from_real.runtime_root, from_link.runtime_root,
            "symlink and real path should resolve to the same runtime root"
        );
        assert_eq!(
            registry_key(&from_real),
            registry_key(&from_link),
            "registry keys should match"
        );
    }

    #[test]
    fn distinct_repo_and_worktree_produce_different_keys() {
        let temp = TempDir::new().unwrap();
        let main_repo = temp.path().join("main");
        let wt_dir = temp.path().join("wt-distinct");
        fs::create_dir_all(&main_repo).unwrap();
        init_repo(&main_repo);
        commit_file(&main_repo, "README.md", "hello", "init");
        create_worktree(&main_repo, &wt_dir, "acepe/distinct-test");

        let from_main = resolve(&main_repo).expect("resolve main repo");
        let from_wt = resolve(&wt_dir).expect("resolve worktree");

        assert_ne!(
            registry_key(&from_main),
            registry_key(&from_wt),
            "main repo and worktree should have different registry keys"
        );
    }

    #[test]
    fn nonexistent_path_returns_error() {
        let result = resolve(Path::new("/tmp/acepe-test-absolutely-does-not-exist-xyz"));
        assert!(
            matches!(result, Err(ResolveError::PathNotFound(_))),
            "nonexistent path should return PathNotFound"
        );
    }

    #[test]
    fn file_path_returns_error() {
        let temp = TempDir::new().unwrap();
        let file = temp.path().join("file.txt");
        fs::write(&file, "content").unwrap();

        let result = resolve(&file);
        assert!(
            matches!(result, Err(ResolveError::NotDirectory(_))),
            "file path should return NotDirectory"
        );
    }

    #[test]
    fn empty_path_returns_error() {
        let result = resolve(Path::new(""));
        assert!(
            matches!(result, Err(ResolveError::EmptyPath)),
            "empty path should return EmptyPath"
        );
    }

    #[test]
    fn registry_key_is_deterministic() {
        let temp = TempDir::new().unwrap();
        let repo = temp.path().join("repo");
        fs::create_dir_all(&repo).unwrap();
        init_repo(&repo);
        commit_file(&repo, "README.md", "hello", "init");

        let r1 = resolve(&repo).unwrap();
        let r2 = resolve(&repo).unwrap();
        assert_eq!(registry_key(&r1), registry_key(&r2));
    }

    /// Equivalent differently-cased paths should resolve to the same key on
    /// case-insensitive filesystems (macOS). On case-sensitive filesystems
    /// this test is effectively a no-op because the alternate casing won't
    /// exist.
    #[test]
    fn case_variant_paths_resolve_to_same_key_on_case_insensitive_fs() {
        let temp = TempDir::new().unwrap();
        let repo = temp.path().join("MyRepo");
        fs::create_dir_all(&repo).unwrap();
        init_repo(&repo);
        commit_file(&repo, "README.md", "hello", "init");

        // Construct an alternate-cased path.
        let alt_case = temp.path().join("myrepo");

        // On case-insensitive FS (macOS default), the alt path exists and
        // canonicalizes to the same on-disk path.
        if alt_case.exists() {
            let from_original = resolve(&repo).unwrap();
            let from_alt = resolve(&alt_case).unwrap();
            assert_eq!(
                registry_key(&from_original),
                registry_key(&from_alt),
                "case variants should produce the same registry key on case-insensitive FS"
            );
        }
        // On case-sensitive FS, alt_case simply doesn't exist — nothing to assert.
    }

    #[test]
    fn two_worktrees_from_same_repo_produce_distinct_keys() {
        let temp = TempDir::new().unwrap();
        let main_repo = temp.path().join("main");
        let wt_a = temp.path().join("wt-a");
        let wt_b = temp.path().join("wt-b");
        fs::create_dir_all(&main_repo).unwrap();
        init_repo(&main_repo);
        commit_file(&main_repo, "README.md", "hello", "init");
        create_worktree(&main_repo, &wt_a, "acepe/wt-a");
        create_worktree(&main_repo, &wt_b, "acepe/wt-b");

        let resolved_a = resolve(&wt_a).unwrap();
        let resolved_b = resolve(&wt_b).unwrap();

        // Both share the same project root.
        assert_eq!(resolved_a.project_root, resolved_b.project_root);

        // But have distinct runtime roots / registry keys.
        assert_ne!(registry_key(&resolved_a), registry_key(&resolved_b));
    }
}
