//! Git HEAD file watcher for detecting external branch changes.
//!
//! Watches `.git/HEAD` for each active project using the `notify` crate.
//! When the branch changes (e.g., via terminal `git checkout`), emits a
//! `"git:head-changed"` Tauri event so frontend widgets can refresh.
//!
//! Limitation: only detects branch *name* changes. Operations that update
//! the current branch's commit without changing HEAD (e.g., `git pull`
//! fast-forward) are NOT detected — those are handled by in-app refresh.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use notify_debouncer_mini::{new_debouncer, Debouncer};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use crate::commands::observability::{CommandResult, SerializableCommandError, unexpected_command_result};

const GIT_HEAD_CHANGED_EVENT: &str = "git:head-changed";
const DEBOUNCE_DURATION: Duration = Duration::from_millis(300);

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GitHeadChangedPayload {
    pub project_path: String,
    pub branch: Option<String>,
}

struct WatcherEntry {
    _debouncer: Debouncer<notify::RecommendedWatcher>,
}

pub struct GitHeadWatcher {
    watchers: Mutex<HashMap<PathBuf, WatcherEntry>>,
}

impl Default for GitHeadWatcher {
    fn default() -> Self {
        Self::new()
    }
}

impl GitHeadWatcher {
    pub fn new() -> Self {
        Self {
            watchers: Mutex::new(HashMap::new()),
        }
    }

    /// Start watching `.git/HEAD` for a project path. Idempotent — does nothing
    /// if already watched. Skips bare repos silently.
    pub fn watch(&self, app_handle: AppHandle, project_path: PathBuf) -> Result<(), String> {
        // Check if already watched
        {
            let watchers = self.watchers.lock().map_err(|e| e.to_string())?;
            if watchers.contains_key(&project_path) {
                return Ok(());
            }
        }

        // Open repo and resolve HEAD file path
        let repo =
            git2::Repository::open(&project_path).map_err(|e| format!("Not a git repo: {}", e))?;

        if repo.is_bare() {
            tracing::debug!(
                project_path = %project_path.display(),
                "Skipping HEAD watcher for bare repository"
            );
            return Ok(());
        }

        // repo.path() returns the .git directory (or worktree gitdir for worktrees)
        let head_file = repo.path().join("HEAD");
        let watch_dir = repo.path().to_path_buf();

        // Read initial branch
        let initial_branch = read_branch_from_repo(&project_path);

        // State shared with the debounce callback
        let project_path_for_cb = project_path.clone();
        let app_for_cb = app_handle.clone();
        let last_branch: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(initial_branch.clone()));

        let mut debouncer = new_debouncer(
            DEBOUNCE_DURATION,
            move |events: Result<Vec<notify_debouncer_mini::DebouncedEvent>, notify::Error>| {
                let events = match events {
                    Ok(events) => events,
                    Err(e) => {
                        tracing::warn!(error = %e, "File watcher error");
                        return;
                    }
                };

                // Only react to changes involving the HEAD file
                let head_changed = events.iter().any(|e| e.path == head_file);
                if !head_changed {
                    return;
                }

                // 1. Read branch via git2 (no lock held)
                let new_branch = read_branch_from_repo(&project_path_for_cb);

                // 2. Compare with last known (acquire lock briefly)
                let changed = {
                    let mut last = match last_branch.lock() {
                        Ok(guard) => guard,
                        Err(e) => {
                            tracing::warn!(error = %e, "Failed to acquire last_branch lock");
                            return;
                        }
                    };
                    if *last == new_branch {
                        false
                    } else {
                        *last = new_branch.clone();
                        true
                    }
                };
                // Lock is released here

                // 3. Emit event if changed (no lock held)
                if changed {
                    let payload = GitHeadChangedPayload {
                        project_path: project_path_for_cb.to_string_lossy().to_string(),
                        branch: new_branch,
                    };
                    if let Err(e) = app_for_cb.emit(GIT_HEAD_CHANGED_EVENT, &payload) {
                        tracing::warn!(error = %e, "Failed to emit git:head-changed event");
                    }
                }
            },
        )
        .map_err(|e| format!("Failed to create file watcher: {}", e))?;

        // Watch the .git directory (contains HEAD file)
        debouncer
            .watcher()
            .watch(&watch_dir, notify::RecursiveMode::NonRecursive)
            .map_err(|e| format!("Failed to watch {}: {}", watch_dir.display(), e))?;

        // Store the watcher
        let entry = WatcherEntry {
            _debouncer: debouncer,
        };

        let mut watchers = self.watchers.lock().map_err(|e| e.to_string())?;
        watchers.insert(project_path, entry);

        Ok(())
    }

    /// Remove all watchers. Called on app shutdown.
    pub fn unwatch_all(&self) {
        if let Ok(mut watchers) = self.watchers.lock() {
            let count = watchers.len();
            watchers.clear();
            if count > 0 {
                tracing::info!(count, "Cleared all git HEAD watchers");
            }
        }
    }
}

/// Read the current branch name using git2. Returns `None` for detached HEAD
/// or if the repo cannot be opened (e.g., deleted/corrupted).
pub(super) fn read_branch_from_repo(project_path: &Path) -> Option<String> {
    let repo = match git2::Repository::open(project_path) {
        Ok(repo) => repo,
        Err(e) => {
            tracing::warn!(
                project_path = %project_path.display(),
                error = %e,
                "Failed to open repo for branch read"
            );
            return None;
        }
    };

    let head = match repo.head() {
        Ok(head) => head,
        Err(_) => return None,
    };

    // Detached HEAD → None
    if !head.is_branch() {
        return None;
    }

    head.shorthand().map(ToOwned::to_owned)
}

// ─── Tauri Command ──────────────────────────────────────────────────────────

/// Start watching `.git/HEAD` for a project. Idempotent.
#[tauri::command]
#[specta::specta]
pub async fn git_watch_head(
    watcher: State<'_, Arc<GitHeadWatcher>>,
    app: AppHandle,
    project_path: String,
) -> CommandResult<()>  {
    let path = PathBuf::from(&project_path);
    if !path.exists() {
        return Err(SerializableCommandError::expected(
            "git_watch_head",
            format!("Path does not exist: {}", project_path),
        ));
    }

    unexpected_command_result("git_watch_head", "Failed to watch git HEAD", async {
        watcher.watch(app, path)

    }.await)
}
