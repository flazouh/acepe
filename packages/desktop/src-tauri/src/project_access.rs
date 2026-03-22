use crate::path_safety::ProjectPathSafetyError;
use crate::path_safety::{classify_legacy_unsafe_project_root_lexical, validate_project_directory};
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::{Condvar, Mutex, OnceLock};

const MAX_PARALLEL_PROBES: usize = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ProjectAccessReason {
    StartupPreflight,
    SessionResume,
    FileIndex,
    ProjectImport,
    Other,
}

impl ProjectAccessReason {
    fn subsystem(self) -> &'static str {
        match self {
            Self::StartupPreflight => "startup",
            Self::SessionResume => "acp-resume",
            Self::FileIndex => "file-index",
            Self::ProjectImport => "project-import",
            Self::Other => "other",
        }
    }

    fn startup_phase(self) -> &'static str {
        match self {
            Self::StartupPreflight => "startup-preflight",
            Self::SessionResume => "startup-resume",
            Self::FileIndex => "runtime-file-index",
            Self::ProjectImport => "runtime-import",
            Self::Other => "runtime-other",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum ProtectedParentKind {
    Documents,
    Desktop,
    Downloads,
}

impl ProtectedParentKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Documents => "Documents",
            Self::Desktop => "Desktop",
            Self::Downloads => "Downloads",
        }
    }
}

#[derive(Debug, Clone, Default)]
struct ProjectAccessMetrics {
    total_requests: u64,
    cache_hits: u64,
    cache_misses: u64,
    singleflight_waiters: u64,
    concurrency_waiters: u64,
    lexical_rejections: u64,
    fs_validate_probes: u64,
    protected_parent_probe_hits: u64,
    protected_parent_probe_misses: u64,
    startup_preflight_requests: u64,
    session_resume_requests: u64,
    project_import_requests: u64,
    file_index_requests: u64,
    other_requests: u64,
    resume_attempts_by_project_hash: HashMap<String, u64>,
}

#[derive(Debug, Clone)]
pub struct ProjectAccessSummary {
    pub total_requests: u64,
    pub cache_hits: u64,
    pub cache_misses: u64,
    pub singleflight_waiters: u64,
    pub concurrency_waiters: u64,
    pub lexical_rejections: u64,
    pub fs_validate_probes: u64,
    pub protected_parent_probe_hits: u64,
    pub protected_parent_probe_misses: u64,
    pub startup_preflight_requests: u64,
    pub session_resume_requests: u64,
    pub project_import_requests: u64,
    pub file_index_requests: u64,
    pub other_requests: u64,
    pub resume_attempts_by_project_hash: Vec<(String, u64)>,
}

impl From<&ProjectAccessMetrics> for ProjectAccessSummary {
    fn from(value: &ProjectAccessMetrics) -> Self {
        let mut resume_attempts_by_project_hash = value
            .resume_attempts_by_project_hash
            .iter()
            .map(|(k, v)| (k.clone(), *v))
            .collect::<Vec<_>>();
        resume_attempts_by_project_hash.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));

        Self {
            total_requests: value.total_requests,
            cache_hits: value.cache_hits,
            cache_misses: value.cache_misses,
            singleflight_waiters: value.singleflight_waiters,
            concurrency_waiters: value.concurrency_waiters,
            lexical_rejections: value.lexical_rejections,
            fs_validate_probes: value.fs_validate_probes,
            protected_parent_probe_hits: value.protected_parent_probe_hits,
            protected_parent_probe_misses: value.protected_parent_probe_misses,
            startup_preflight_requests: value.startup_preflight_requests,
            session_resume_requests: value.session_resume_requests,
            project_import_requests: value.project_import_requests,
            file_index_requests: value.file_index_requests,
            other_requests: value.other_requests,
            resume_attempts_by_project_hash,
        }
    }
}

#[derive(Default)]
struct BrokerState {
    cache: HashMap<PathBuf, Result<PathBuf, ProjectPathSafetyError>>,
    inflight: HashSet<PathBuf>,
    active_probes: usize,
    protected_parent_probed: HashSet<PathBuf>,
    metrics: ProjectAccessMetrics,
}

struct ProjectAccessBroker {
    state: Mutex<BrokerState>,
    condvar: Condvar,
    max_parallel_probes: usize,
}

impl ProjectAccessBroker {
    fn new(max_parallel_probes: usize) -> Self {
        Self {
            state: Mutex::new(BrokerState::default()),
            condvar: Condvar::new(),
            max_parallel_probes,
        }
    }

    fn validate_project_directory_for_reason(
        &self,
        path: &Path,
        reason: ProjectAccessReason,
    ) -> Result<PathBuf, ProjectPathSafetyError> {
        let path_key = normalize_cache_key(path);
        let project_path_hash = hash_path(&path_key);

        self.record_request(reason, &project_path_hash);

        let result = self.run_singleflight(&path_key, || {
            if let Some(error) = classify_legacy_unsafe_project_root_lexical(&path_key) {
                self.record_lexical_rejection();
                tracing::debug!(
                    startup_phase = reason.startup_phase(),
                    subsystem = reason.subsystem(),
                    project_path_hash = %project_path_hash,
                    probe_kind = "lexical",
                    cache_hit = false,
                    singleflight_waiter = false,
                    "Project access rejected lexically"
                );
                return Err(error);
            }

            self.prewarm_protected_parent_for_path(&path_key, reason, &project_path_hash);

            self.record_fs_validate_probe();
            let probe_result = validate_project_directory(&path_key);
            tracing::debug!(
                startup_phase = reason.startup_phase(),
                subsystem = reason.subsystem(),
                project_path_hash = %project_path_hash,
                probe_kind = "fs-validate",
                cache_hit = false,
                singleflight_waiter = false,
                "Project access filesystem validation complete"
            );
            probe_result
        });

        if result.1 {
            tracing::debug!(
                startup_phase = reason.startup_phase(),
                subsystem = reason.subsystem(),
                project_path_hash = %project_path_hash,
                probe_kind = "broker-cache",
                cache_hit = true,
                singleflight_waiter = false,
                "Project access cache hit"
            );
        } else if result.2 {
            tracing::debug!(
                startup_phase = reason.startup_phase(),
                subsystem = reason.subsystem(),
                project_path_hash = %project_path_hash,
                probe_kind = "singleflight-wait",
                cache_hit = false,
                singleflight_waiter = true,
                "Project access reused in-flight validation"
            );
        }

        result.0
    }

    fn prewarm_protected_parents_for_projects(
        &self,
        project_paths: &[PathBuf],
        startup_phase: &str,
    ) {
        for path in project_paths {
            let normalized = normalize_cache_key(path);
            let project_path_hash = hash_path(&normalized);
            self.prewarm_protected_parent_for_path_with_phase(
                &normalized,
                startup_phase,
                "startup",
                "startup-parent-prewarm",
                &project_path_hash,
            );
        }
    }

    fn log_summary(&self, startup_phase: &str) {
        let summary = {
            let state = self
                .state
                .lock()
                .expect("project access state lock poisoned");
            ProjectAccessSummary::from(&state.metrics)
        };

        let resume_attempts_preview = summary
            .resume_attempts_by_project_hash
            .iter()
            .take(10)
            .map(|(hash, count)| format!("{hash}:{count}"))
            .collect::<Vec<_>>()
            .join(",");

        tracing::info!(
            startup_phase = startup_phase,
            subsystem = "project-access",
            total_requests = summary.total_requests,
            cache_hits = summary.cache_hits,
            cache_misses = summary.cache_misses,
            singleflight_waiters = summary.singleflight_waiters,
            concurrency_waiters = summary.concurrency_waiters,
            lexical_rejections = summary.lexical_rejections,
            fs_validate_probes = summary.fs_validate_probes,
            protected_parent_probe_hits = summary.protected_parent_probe_hits,
            protected_parent_probe_misses = summary.protected_parent_probe_misses,
            startup_preflight_requests = summary.startup_preflight_requests,
            session_resume_requests = summary.session_resume_requests,
            project_import_requests = summary.project_import_requests,
            file_index_requests = summary.file_index_requests,
            other_requests = summary.other_requests,
            resume_attempts_by_project_hash = %resume_attempts_preview,
            "Project access startup summary"
        );
    }

    fn run_singleflight<F>(
        &self,
        cache_key: &Path,
        probe: F,
    ) -> (Result<PathBuf, ProjectPathSafetyError>, bool, bool)
    where
        F: FnOnce() -> Result<PathBuf, ProjectPathSafetyError>,
    {
        let mut waited_for_inflight = false;

        loop {
            let mut state = self
                .state
                .lock()
                .expect("project access state lock poisoned");

            if let Some(cached) = state.cache.get(cache_key).cloned() {
                state.metrics.cache_hits += 1;
                return (cached, true, waited_for_inflight);
            }

            if state.inflight.contains(cache_key) {
                state.metrics.singleflight_waiters += 1;
                waited_for_inflight = true;
                state = self
                    .condvar
                    .wait(state)
                    .expect("project access condvar wait poisoned");
                drop(state);
                continue;
            }

            if state.active_probes >= self.max_parallel_probes {
                state.metrics.concurrency_waiters += 1;
                state = self
                    .condvar
                    .wait(state)
                    .expect("project access condvar wait poisoned");

                if let Some(cached) = state.cache.get(cache_key).cloned() {
                    state.metrics.cache_hits += 1;
                    return (cached, true, waited_for_inflight);
                }
                if state.inflight.contains(cache_key) {
                    state.metrics.singleflight_waiters += 1;
                    waited_for_inflight = true;
                    state = self
                        .condvar
                        .wait(state)
                        .expect("project access condvar wait poisoned");
                    drop(state);
                    continue;
                }

                drop(state);
                continue;
            }

            state.metrics.cache_misses += 1;
            state.inflight.insert(cache_key.to_path_buf());
            state.active_probes += 1;
            drop(state);
            break;
        }

        let result = probe();

        let mut state = self
            .state
            .lock()
            .expect("project access state lock poisoned");
        state.cache.insert(cache_key.to_path_buf(), result.clone());
        state.inflight.remove(cache_key);
        state.active_probes = state.active_probes.saturating_sub(1);
        self.condvar.notify_all();

        (result, false, waited_for_inflight)
    }

    fn record_request(&self, reason: ProjectAccessReason, path_hash: &str) {
        let mut state = self
            .state
            .lock()
            .expect("project access state lock poisoned");
        state.metrics.total_requests += 1;
        match reason {
            ProjectAccessReason::StartupPreflight => state.metrics.startup_preflight_requests += 1,
            ProjectAccessReason::SessionResume => {
                state.metrics.session_resume_requests += 1;
                let count = state
                    .metrics
                    .resume_attempts_by_project_hash
                    .entry(path_hash.to_string())
                    .or_insert(0);
                *count += 1;
            }
            ProjectAccessReason::FileIndex => state.metrics.file_index_requests += 1,
            ProjectAccessReason::ProjectImport => state.metrics.project_import_requests += 1,
            ProjectAccessReason::Other => state.metrics.other_requests += 1,
        }
    }

    fn record_lexical_rejection(&self) {
        let mut state = self
            .state
            .lock()
            .expect("project access state lock poisoned");
        state.metrics.lexical_rejections += 1;
    }

    fn record_fs_validate_probe(&self) {
        let mut state = self
            .state
            .lock()
            .expect("project access state lock poisoned");
        state.metrics.fs_validate_probes += 1;
    }

    fn prewarm_protected_parent_for_path(
        &self,
        path: &Path,
        reason: ProjectAccessReason,
        project_path_hash: &str,
    ) {
        self.prewarm_protected_parent_for_path_with_phase(
            path,
            reason.startup_phase(),
            reason.subsystem(),
            "protected-parent-prewarm",
            project_path_hash,
        );
    }

    fn prewarm_protected_parent_for_path_with_phase(
        &self,
        path: &Path,
        startup_phase: &str,
        subsystem: &str,
        probe_kind: &str,
        project_path_hash: &str,
    ) {
        let Some((kind, parent_dir)) = protected_parent_for_path(path) else {
            return;
        };

        let should_probe = {
            let mut state = self
                .state
                .lock()
                .expect("project access state lock poisoned");
            if state.protected_parent_probed.contains(&parent_dir) {
                state.metrics.protected_parent_probe_hits += 1;
                false
            } else {
                state.protected_parent_probed.insert(parent_dir.clone());
                state.metrics.protected_parent_probe_misses += 1;
                true
            }
        };

        if !should_probe {
            tracing::debug!(
                startup_phase = startup_phase,
                subsystem = subsystem,
                project_path_hash = %project_path_hash,
                protected_parent = kind.as_str(),
                probe_kind = probe_kind,
                cache_hit = true,
                singleflight_waiter = false,
                "Protected parent probe deduped"
            );
            return;
        }

        let _ = std::fs::metadata(&parent_dir);

        tracing::debug!(
            startup_phase = startup_phase,
            subsystem = subsystem,
            project_path_hash = %project_path_hash,
            protected_parent = kind.as_str(),
            probe_kind = probe_kind,
            cache_hit = false,
            singleflight_waiter = false,
            "Protected parent probe performed"
        );
    }
}

fn normalize_cache_key(path: &Path) -> PathBuf {
    let raw = path.as_os_str().to_string_lossy();
    #[cfg(windows)]
    let trimmed = raw.trim_end_matches(['/', '\\']);
    #[cfg(not(windows))]
    let trimmed = raw.trim_end_matches('/');

    if trimmed.is_empty() {
        PathBuf::from("/")
    } else {
        PathBuf::from(trimmed)
    }
}

fn protected_parent_for_path(path: &Path) -> Option<(ProtectedParentKind, PathBuf)> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        None
    }

    #[cfg(target_os = "macos")]
    {
        let home = dirs::home_dir()?;
        let documents = home.join("Documents");
        if path.starts_with(&documents) {
            return Some((ProtectedParentKind::Documents, documents));
        }

        let desktop = home.join("Desktop");
        if path.starts_with(&desktop) {
            return Some((ProtectedParentKind::Desktop, desktop));
        }

        let downloads = home.join("Downloads");
        if path.starts_with(&downloads) {
            return Some((ProtectedParentKind::Downloads, downloads));
        }

        None
    }
}

fn hash_path(path: &Path) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    path.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn broker() -> &'static ProjectAccessBroker {
    static BROKER: OnceLock<ProjectAccessBroker> = OnceLock::new();
    BROKER.get_or_init(|| ProjectAccessBroker::new(MAX_PARALLEL_PROBES))
}

pub fn validate_project_directory_brokered(
    path: &Path,
    reason: ProjectAccessReason,
) -> Result<PathBuf, ProjectPathSafetyError> {
    broker().validate_project_directory_for_reason(path, reason)
}

pub fn pre_warm_protected_parents_for_projects(project_paths: &[PathBuf], startup_phase: &str) {
    broker().prewarm_protected_parents_for_projects(project_paths, startup_phase);
}

pub fn log_startup_summary(startup_phase: &str) {
    broker().log_summary(startup_phase);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::thread;
    use std::time::Duration;

    #[test]
    fn normalize_cache_key_trims_trailing_separators() {
        assert_eq!(
            normalize_cache_key(Path::new("/tmp/demo/")),
            PathBuf::from("/tmp/demo")
        );
        assert_eq!(normalize_cache_key(Path::new("/")), PathBuf::from("/"));
    }

    #[test]
    fn broker_caches_successful_probe_results() {
        let broker = ProjectAccessBroker::new(1);
        let probe_count = Arc::new(AtomicUsize::new(0));
        let path = PathBuf::from("/tmp/project-access-cache");
        let path_for_first_probe = path.clone();

        let first_counter = Arc::clone(&probe_count);
        let first = broker.run_singleflight(&path, move || {
            first_counter.fetch_add(1, Ordering::SeqCst);
            Ok(path_for_first_probe.clone())
        });

        let second_counter = Arc::clone(&probe_count);
        let second = broker.run_singleflight(&path, move || {
            second_counter.fetch_add(1, Ordering::SeqCst);
            Ok(PathBuf::from("/tmp/should-not-run"))
        });

        assert_eq!(first.0, Ok(PathBuf::from("/tmp/project-access-cache")));
        assert_eq!(second.0, Ok(PathBuf::from("/tmp/project-access-cache")));
        assert_eq!(probe_count.load(Ordering::SeqCst), 1);
        assert!(second.1, "second call should be cache hit");
    }

    #[test]
    fn broker_singleflight_dedupes_concurrent_same_path_probes() {
        let broker = Arc::new(ProjectAccessBroker::new(2));
        let probe_count = Arc::new(AtomicUsize::new(0));
        let path = PathBuf::from("/tmp/project-access-singleflight");

        let handles = (0..2)
            .map(|_| {
                let broker = Arc::clone(&broker);
                let probe_count = Arc::clone(&probe_count);
                let path = path.clone();
                thread::spawn(move || {
                    let probe_path = path.clone();
                    broker.run_singleflight(&path, move || {
                        probe_count.fetch_add(1, Ordering::SeqCst);
                        thread::sleep(Duration::from_millis(50));
                        Ok(probe_path.clone())
                    })
                })
            })
            .collect::<Vec<_>>();

        let results = handles
            .into_iter()
            .map(|handle| handle.join().expect("thread join"))
            .collect::<Vec<_>>();

        assert_eq!(probe_count.load(Ordering::SeqCst), 1);
        assert!(
            results.iter().any(|r| r.2),
            "one thread should wait for inflight probe"
        );
        assert!(results
            .iter()
            .all(|r| r.0 == Ok(PathBuf::from("/tmp/project-access-singleflight"))));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn protected_parent_classification_works() {
        let home = dirs::home_dir().expect("home");
        let documents_project = home.join("Documents").join("acepe");
        let desktop_project = home.join("Desktop").join("acepe");
        let downloads_project = home.join("Downloads").join("acepe");

        assert_eq!(
            protected_parent_for_path(&documents_project).map(|(kind, _)| kind),
            Some(ProtectedParentKind::Documents)
        );
        assert_eq!(
            protected_parent_for_path(&desktop_project).map(|(kind, _)| kind),
            Some(ProtectedParentKind::Desktop)
        );
        assert_eq!(
            protected_parent_for_path(&downloads_project).map(|(kind, _)| kind),
            Some(ProtectedParentKind::Downloads)
        );
    }
}
