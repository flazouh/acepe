use super::copilot::{discover_copilot_history_models, CopilotProvider};
use crate::acp::agent_installer;
use crate::acp::client::{AcpClient, AvailableModel};
use crate::acp::provider::AgentProvider;
use crate::acp::types::CanonicalAgentId;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tokio::sync::{broadcast, Mutex};

const SNAPSHOT_DIR_NAME: &str = "catalogs";
const SNAPSHOT_FILE_NAME: &str = "copilot-model-catalog.json";
const SNAPSHOT_TEMP_FILE_NAME: &str = "copilot-model-catalog.json.tmp";
const CATALOG_FRESH_WINDOW_MS: u64 = 4 * 60 * 60 * 1000;
const CATALOG_MAX_STALE_WINDOW_MS: u64 = 48 * 60 * 60 * 1000;
const CATALOG_FETCH_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CopilotCatalogSnapshot {
    pub fetched_at_ms: u64,
    pub runtime_version: String,
    #[serde(default = "default_catalog_kind")]
    pub catalog_kind: CopilotCatalogSnapshotKind,
    pub models: Vec<AvailableModel>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum CopilotCatalogSnapshotKind {
    Authoritative,
    HistorySalvage,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CopilotCatalogFreshness {
    Fresh,
    Stale,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CopilotCatalogSource {
    None,
    Memory,
    Disk,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CopilotCatalogRefreshReason {
    Missing,
    Stale,
    Expired,
    RuntimeVersionMismatch,
    SnapshotReadFailed,
}

#[derive(Debug, Clone)]
pub(crate) struct CopilotCatalogReadResult {
    pub snapshot: Option<CopilotCatalogSnapshot>,
    pub freshness: Option<CopilotCatalogFreshness>,
    pub source: CopilotCatalogSource,
    pub refresh_reason: Option<CopilotCatalogRefreshReason>,
}

#[derive(Debug, Clone)]
struct AuthoritativeCatalogPayload {
    models: Vec<AvailableModel>,
}

#[derive(Debug, Default)]
struct CopilotCatalogCache {
    entries: Mutex<HashMap<String, CopilotCatalogSnapshot>>,
    in_flight: Mutex<HashMap<String, broadcast::Sender<Result<CopilotCatalogSnapshot, String>>>>,
}

#[derive(Debug, Deserialize)]
struct RawModelList {
    models: Vec<RawModel>,
}

#[derive(Debug, Deserialize)]
struct RawModel {
    id: String,
    name: String,
}

static COPILOT_CATALOG_CACHE: OnceLock<CopilotCatalogCache> = OnceLock::new();

fn catalog_cache() -> &'static CopilotCatalogCache {
    COPILOT_CATALOG_CACHE.get_or_init(CopilotCatalogCache::default)
}

impl CopilotCatalogCache {
    async fn get(&self, key: &str) -> Option<CopilotCatalogSnapshot> {
        self.entries.lock().await.get(key).cloned()
    }

    async fn put(&self, key: String, snapshot: CopilotCatalogSnapshot) {
        self.entries.lock().await.insert(key, snapshot);
    }

    async fn remove(&self, key: &str) {
        self.entries.lock().await.remove(key);
    }

    async fn refresh_with<F, Fut>(
        &self,
        key: String,
        snapshot_path: PathBuf,
        runtime_version: String,
        fetch: F,
    ) -> Result<CopilotCatalogSnapshot, String>
    where
        F: FnOnce() -> Fut + Send + 'static,
        Fut: std::future::Future<Output = Result<AuthoritativeCatalogPayload, String>>
            + Send
            + 'static,
    {
        let subscribe = {
            let mut in_flight = self.in_flight.lock().await;
            if let Some(sender) = in_flight.get(&key) {
                Some(sender.subscribe())
            } else {
                let (sender, _rx) = broadcast::channel(1);
                in_flight.insert(key.clone(), sender);
                None
            }
        };

        match subscribe {
            Some(mut receiver) => receiver
                .recv()
                .await
                .map_err(|error| format!("Catalog refresh waiter failed: {error}"))?,
            None => {
                let fetch_task = tokio::spawn(fetch());
                let result = match fetch_task.await {
                    Ok(Ok(payload)) => {
                        let snapshot = CopilotCatalogSnapshot {
                            fetched_at_ms: now_ms(),
                            runtime_version,
                            catalog_kind: CopilotCatalogSnapshotKind::Authoritative,
                            models: payload.models,
                        };
                        match write_snapshot(&snapshot_path, &snapshot) {
                            Ok(()) => {
                                self.put(key.clone(), snapshot.clone()).await;
                                Ok(snapshot)
                            }
                            Err(error) => Err(error),
                        }
                    }
                    Ok(Err(error)) => Err(error),
                    Err(error) => Err(format!("Copilot catalog refresh panicked: {error}")),
                };

                let sender = {
                    let mut in_flight = self.in_flight.lock().await;
                    in_flight.remove(&key)
                };
                if let Some(sender) = sender {
                    let _ = sender.send(result.clone());
                }
                result
            }
        }
    }
}

pub(crate) fn snapshot_path_for_app(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;
    Ok(snapshot_path_from_app_data_dir(&app_data_dir))
}

pub(crate) async fn read_catalog_snapshot_for_app(app: &AppHandle) -> CopilotCatalogReadResult {
    let snapshot_path = match snapshot_path_for_app(app) {
        Ok(path) => path,
        Err(error) => {
            tracing::warn!(error = %error, "Copilot catalog snapshot path unavailable");
            return CopilotCatalogReadResult {
                snapshot: None,
                freshness: None,
                source: CopilotCatalogSource::None,
                refresh_reason: Some(CopilotCatalogRefreshReason::Missing),
            };
        }
    };

    read_catalog_snapshot_from_path(&snapshot_path).await
}

pub(crate) async fn read_catalog_snapshot_from_path(
    snapshot_path: &Path,
) -> CopilotCatalogReadResult {
    let Some(runtime_version) = current_copilot_runtime_version() else {
        return CopilotCatalogReadResult {
            snapshot: None,
            freshness: None,
            source: CopilotCatalogSource::None,
            refresh_reason: Some(CopilotCatalogRefreshReason::Missing),
        };
    };

    let key = snapshot_key(snapshot_path);

    if let Some(snapshot) = catalog_cache().get(&key).await {
        return classify_snapshot(
            snapshot_path,
            &key,
            snapshot,
            runtime_version,
            CopilotCatalogSource::Memory,
        )
        .await;
    }

    match load_snapshot(snapshot_path) {
        Ok(Some(snapshot)) => {
            let result = classify_snapshot(
                snapshot_path,
                &key,
                snapshot.clone(),
                runtime_version,
                CopilotCatalogSource::Disk,
            )
            .await;

            if result.snapshot.is_some() {
                catalog_cache().put(key, snapshot).await;
            }

            result
        }
        Ok(None) => CopilotCatalogReadResult {
            snapshot: None,
            freshness: None,
            source: CopilotCatalogSource::None,
            refresh_reason: Some(CopilotCatalogRefreshReason::Missing),
        },
        Err(error) => {
            tracing::warn!(
                path = %snapshot_path.display(),
                error = %error,
                "Failed reading Copilot catalog snapshot"
            );
            CopilotCatalogReadResult {
                snapshot: None,
                freshness: None,
                source: CopilotCatalogSource::None,
                refresh_reason: Some(CopilotCatalogRefreshReason::SnapshotReadFailed),
            }
        }
    }
}

pub(crate) async fn refresh_catalog_for_app(
    app: &AppHandle,
    cwd: &Path,
) -> Result<CopilotCatalogSnapshot, String> {
    let snapshot_path = snapshot_path_for_app(app)?;
    refresh_catalog_from_path(&snapshot_path, cwd).await
}

pub(crate) async fn refresh_catalog_from_path(
    snapshot_path: &Path,
    cwd: &Path,
) -> Result<CopilotCatalogSnapshot, String> {
    let runtime_version = current_copilot_runtime_version()
        .ok_or_else(|| "Copilot runtime version unavailable".to_string())?;
    let key = snapshot_key(snapshot_path);
    let cwd = cwd.to_path_buf();
    let snapshot_path = snapshot_path.to_path_buf();

    catalog_cache()
        .refresh_with(key, snapshot_path, runtime_version, move || async move {
            fetch_authoritative_catalog(&cwd).await
        })
        .await
}

pub(crate) async fn invalidate_catalog_snapshot_for_app(app: &AppHandle) -> Result<(), String> {
    let snapshot_path = snapshot_path_for_app(app)?;
    invalidate_catalog_snapshot(&snapshot_path).await
}

pub(crate) async fn invalidate_catalog_snapshot(snapshot_path: &Path) -> Result<(), String> {
    let key = snapshot_key(snapshot_path);
    catalog_cache().remove(&key).await;
    if snapshot_path.exists() {
        std::fs::remove_file(snapshot_path).map_err(|error| {
            format!(
                "Failed to remove Copilot catalog snapshot at {}: {error}",
                snapshot_path.display()
            )
        })?;
    }
    Ok(())
}

pub(crate) fn spawn_catalog_refresh(
    app: AppHandle,
    cwd: PathBuf,
    reason: CopilotCatalogRefreshReason,
) {
    tracing::info!(?reason, cwd = %cwd.display(), "Refreshing Copilot catalog in background");
    tauri::async_runtime::spawn(async move {
        if let Err(error) = refresh_catalog_for_app(&app, &cwd).await {
            tracing::warn!(
                ?reason,
                cwd = %cwd.display(),
                error = %error,
                "Copilot catalog refresh failed"
            );

            if reason != CopilotCatalogRefreshReason::Stale {
                match snapshot_path_for_app(&app) {
                    Ok(snapshot_path) => {
                        if let Err(salvage_error) =
                            persist_history_salvage_snapshot(&snapshot_path).await
                        {
                            tracing::warn!(
                                ?reason,
                                cwd = %cwd.display(),
                                error = %salvage_error,
                                "Copilot history salvage fallback failed"
                            );
                        }
                    }
                    Err(path_error) => {
                        tracing::warn!(
                            ?reason,
                            cwd = %cwd.display(),
                            error = %path_error,
                            "Copilot history salvage skipped because snapshot path is unavailable"
                        );
                    }
                }
            }
        }
    });
}

pub(crate) fn warm_catalog_in_background(app: AppHandle, cwd: PathBuf) {
    tauri::async_runtime::spawn(async move {
        let read_result = read_catalog_snapshot_for_app(&app).await;
        if let Some(reason) = read_result.refresh_reason {
            spawn_catalog_refresh(app, cwd, reason);
        }
    });
}

fn snapshot_path_from_app_data_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir
        .join(SNAPSHOT_DIR_NAME)
        .join(SNAPSHOT_FILE_NAME)
}

fn default_catalog_kind() -> CopilotCatalogSnapshotKind {
    CopilotCatalogSnapshotKind::Authoritative
}

async fn classify_snapshot(
    snapshot_path: &Path,
    key: &str,
    snapshot: CopilotCatalogSnapshot,
    runtime_version: String,
    source: CopilotCatalogSource,
) -> CopilotCatalogReadResult {
    match snapshot_freshness(&snapshot, &runtime_version) {
        Ok(CopilotCatalogFreshness::Fresh) => {
            let refresh_reason =
                if snapshot.catalog_kind == CopilotCatalogSnapshotKind::HistorySalvage {
                    Some(CopilotCatalogRefreshReason::Stale)
                } else {
                    None
                };

            CopilotCatalogReadResult {
                snapshot: Some(snapshot),
                freshness: Some(CopilotCatalogFreshness::Fresh),
                source,
                refresh_reason,
            }
        }
        Ok(CopilotCatalogFreshness::Stale) => CopilotCatalogReadResult {
            snapshot: Some(snapshot),
            freshness: Some(CopilotCatalogFreshness::Stale),
            source,
            refresh_reason: Some(CopilotCatalogRefreshReason::Stale),
        },
        Err(reason) => {
            catalog_cache().remove(key).await;
            tracing::info!(
                ?reason,
                path = %snapshot_path.display(),
                "Copilot catalog snapshot is not usable"
            );
            CopilotCatalogReadResult {
                snapshot: None,
                freshness: None,
                source: CopilotCatalogSource::None,
                refresh_reason: Some(reason),
            }
        }
    }
}

fn snapshot_freshness(
    snapshot: &CopilotCatalogSnapshot,
    runtime_version: &str,
) -> Result<CopilotCatalogFreshness, CopilotCatalogRefreshReason> {
    if snapshot.runtime_version != runtime_version {
        return Err(CopilotCatalogRefreshReason::RuntimeVersionMismatch);
    }

    let age_ms = now_ms().saturating_sub(snapshot.fetched_at_ms);
    if age_ms <= CATALOG_FRESH_WINDOW_MS {
        return Ok(CopilotCatalogFreshness::Fresh);
    }
    if age_ms <= CATALOG_MAX_STALE_WINDOW_MS {
        return Ok(CopilotCatalogFreshness::Stale);
    }

    Err(CopilotCatalogRefreshReason::Expired)
}

fn current_copilot_runtime_version() -> Option<String> {
    agent_installer::get_cached_version(&CanonicalAgentId::Copilot)
}

fn snapshot_key(snapshot_path: &Path) -> String {
    snapshot_path.to_string_lossy().to_string()
}

fn load_snapshot(snapshot_path: &Path) -> Result<Option<CopilotCatalogSnapshot>, String> {
    if !snapshot_path.exists() {
        return Ok(None);
    }

    let raw = std::fs::read_to_string(snapshot_path).map_err(|error| {
        format!(
            "Failed reading Copilot catalog snapshot at {}: {error}",
            snapshot_path.display()
        )
    })?;
    let snapshot = serde_json::from_str::<CopilotCatalogSnapshot>(&raw).map_err(|error| {
        format!(
            "Failed parsing Copilot catalog snapshot at {}: {error}",
            snapshot_path.display()
        )
    })?;
    Ok(Some(snapshot))
}

fn write_snapshot(snapshot_path: &Path, snapshot: &CopilotCatalogSnapshot) -> Result<(), String> {
    let parent = snapshot_path.parent().ok_or_else(|| {
        format!(
            "Copilot catalog snapshot path has no parent directory: {}",
            snapshot_path.display()
        )
    })?;
    std::fs::create_dir_all(parent).map_err(|error| {
        format!(
            "Failed creating Copilot catalog snapshot directory {}: {error}",
            parent.display()
        )
    })?;

    let temp_path = parent.join(SNAPSHOT_TEMP_FILE_NAME);
    let serialized = serde_json::to_string_pretty(snapshot)
        .map_err(|error| format!("Failed serializing Copilot catalog snapshot: {error}"))?;
    let content = format!("{serialized}\n");

    let mut file = std::fs::File::create(&temp_path).map_err(|error| {
        format!(
            "Failed creating Copilot catalog temp snapshot at {}: {error}",
            temp_path.display()
        )
    })?;
    file.write_all(content.as_bytes()).map_err(|error| {
        format!(
            "Failed writing Copilot catalog temp snapshot at {}: {error}",
            temp_path.display()
        )
    })?;
    file.sync_all().map_err(|error| {
        format!(
            "Failed syncing Copilot catalog temp snapshot at {}: {error}",
            temp_path.display()
        )
    })?;
    drop(file);

    std::fs::rename(&temp_path, snapshot_path).map_err(|error| {
        format!(
            "Failed finalizing Copilot catalog snapshot at {}: {error}",
            snapshot_path.display()
        )
    })?;

    Ok(())
}

async fn persist_history_salvage_snapshot(snapshot_path: &Path) -> Result<(), String> {
    let models = discover_copilot_history_models(dirs::home_dir().as_deref());
    if models.is_empty() {
        return Err("Copilot history salvage found no models".to_string());
    }

    let runtime_version = current_copilot_runtime_version()
        .ok_or_else(|| "Copilot runtime version unavailable for history salvage".to_string())?;
    let snapshot = CopilotCatalogSnapshot {
        fetched_at_ms: now_ms(),
        runtime_version,
        catalog_kind: CopilotCatalogSnapshotKind::HistorySalvage,
        models,
    };
    write_snapshot(snapshot_path, &snapshot)?;
    catalog_cache()
        .put(snapshot_key(snapshot_path), snapshot)
        .await;
    Ok(())
}

async fn fetch_authoritative_catalog(cwd: &Path) -> Result<AuthoritativeCatalogPayload, String> {
    let provider: Arc<dyn AgentProvider> = Arc::new(CopilotProvider);
    let mut client = AcpClient::new_with_provider(provider, None, cwd.to_path_buf())
        .map_err(|error| format!("Failed creating Copilot ACP client: {error}"))?;

    let result = tokio::time::timeout(CATALOG_FETCH_TIMEOUT, async {
        client
            .start()
            .await
            .map_err(|error| format!("Failed starting Copilot ACP client: {error}"))?;
        client
            .initialize()
            .await
            .map_err(|error| format!("Failed initializing Copilot ACP client: {error}"))?;

        let raw_models = client
            .send_request("models.list", json!({}))
            .await
            .map_err(|error| format!("Copilot models.list failed: {error}"))?;
        let model_list = serde_json::from_value::<RawModelList>(raw_models)
            .map_err(|error| format!("Invalid Copilot models.list response: {error}"))?;
        let models = normalize_authoritative_models(model_list);
        let usable_model_count = models
            .iter()
            .filter(|model| !is_default_choice_model_id(&model.model_id))
            .count();
        if usable_model_count == 0 {
            return Err("Copilot authoritative catalog returned no usable models".to_string());
        }

        Ok(AuthoritativeCatalogPayload { models })
    })
    .await;

    client.stop();

    match result {
        Ok(inner) => inner,
        Err(_) => Err(format!(
            "Copilot authoritative catalog fetch timed out after {:?}",
            CATALOG_FETCH_TIMEOUT
        )),
    }
}

fn normalize_authoritative_models(model_list: RawModelList) -> Vec<AvailableModel> {
    let mut seen = HashSet::new();
    let mut models = model_list
        .models
        .into_iter()
        .filter_map(|raw_model| {
            let model_id = normalize_model_token(&raw_model.id)?;
            if !seen.insert(model_id.clone()) {
                return None;
            }

            let name = normalize_model_token(&raw_model.name).unwrap_or_else(|| model_id.clone());
            Some(AvailableModel {
                model_id,
                name,
                description: None,
            })
        })
        .collect::<Vec<_>>();

    models.sort_by(|left, right| {
        model_sort_rank(&left.model_id)
            .cmp(&model_sort_rank(&right.model_id))
            .then_with(|| {
                left.name
                    .to_ascii_lowercase()
                    .cmp(&right.name.to_ascii_lowercase())
            })
            .then_with(|| left.model_id.cmp(&right.model_id))
    });
    models
}

fn model_sort_rank(model_id: &str) -> u8 {
    if is_default_choice_model_id(model_id) {
        0
    } else {
        1
    }
}

fn normalize_model_token(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    Some(trimmed.to_string())
}

fn is_default_choice_model_id(model_id: &str) -> bool {
    matches!(model_id.trim(), "auto" | "default")
}

fn now_ms() -> u64 {
    Utc::now().timestamp_millis().max(0) as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};
    use tempfile::tempdir;

    fn snapshot_with_age(age_ms: u64, runtime_version: &str) -> CopilotCatalogSnapshot {
        CopilotCatalogSnapshot {
            fetched_at_ms: now_ms().saturating_sub(age_ms),
            runtime_version: runtime_version.to_string(),
            catalog_kind: CopilotCatalogSnapshotKind::Authoritative,
            models: vec![AvailableModel {
                model_id: "gpt-5.4".to_string(),
                name: "GPT-5.4".to_string(),
                description: None,
            }],
        }
    }

    #[test]
    fn snapshot_freshness_distinguishes_fresh_stale_and_expired() {
        let fresh = snapshot_with_age(CATALOG_FRESH_WINDOW_MS.saturating_sub(1), "1.0.14");
        let stale = snapshot_with_age(CATALOG_FRESH_WINDOW_MS + 1, "1.0.14");
        let expired = snapshot_with_age(CATALOG_MAX_STALE_WINDOW_MS + 1, "1.0.14");

        assert_eq!(
            snapshot_freshness(&fresh, "1.0.14").expect("fresh snapshot"),
            CopilotCatalogFreshness::Fresh
        );
        assert_eq!(
            snapshot_freshness(&stale, "1.0.14").expect("stale snapshot"),
            CopilotCatalogFreshness::Stale
        );
        assert_eq!(
            snapshot_freshness(&expired, "1.0.14").expect_err("expired snapshot"),
            CopilotCatalogRefreshReason::Expired
        );
    }

    #[test]
    fn snapshot_freshness_rejects_runtime_version_mismatch() {
        let snapshot = snapshot_with_age(1, "1.0.14");

        assert_eq!(
            snapshot_freshness(&snapshot, "1.0.15").expect_err("mismatch should fail"),
            CopilotCatalogRefreshReason::RuntimeVersionMismatch
        );
    }

    #[test]
    fn normalize_authoritative_models_dedupes_and_orders_auto_first() {
        let models = normalize_authoritative_models(RawModelList {
            models: vec![
                RawModel {
                    id: "gpt-5.4".to_string(),
                    name: "GPT-5.4".to_string(),
                },
                RawModel {
                    id: "auto".to_string(),
                    name: "Auto".to_string(),
                },
                RawModel {
                    id: "gpt-5.4".to_string(),
                    name: "GPT-5.4".to_string(),
                },
                RawModel {
                    id: "claude-opus-4.7".to_string(),
                    name: "Claude Opus 4.7".to_string(),
                },
            ],
        });

        let model_ids = models
            .iter()
            .map(|model| model.model_id.as_str())
            .collect::<Vec<_>>();

        assert_eq!(model_ids, vec!["auto", "claude-opus-4.7", "gpt-5.4"]);
    }

    #[tokio::test]
    async fn history_salvage_snapshot_still_requests_background_refresh() {
        let temp = tempdir().expect("tempdir");
        let snapshot_path = temp.path().join("catalogs").join(SNAPSHOT_FILE_NAME);
        let key = snapshot_key(&snapshot_path);
        let snapshot = CopilotCatalogSnapshot {
            fetched_at_ms: now_ms(),
            runtime_version: "1.0.14".to_string(),
            catalog_kind: CopilotCatalogSnapshotKind::HistorySalvage,
            models: vec![AvailableModel {
                model_id: "gpt-5.4".to_string(),
                name: "GPT-5.4".to_string(),
                description: None,
            }],
        };

        let result = classify_snapshot(
            &snapshot_path,
            &key,
            snapshot,
            "1.0.14".to_string(),
            CopilotCatalogSource::Disk,
        )
        .await;

        assert!(result.snapshot.is_some());
        assert_eq!(result.freshness, Some(CopilotCatalogFreshness::Fresh));
        assert_eq!(
            result.refresh_reason,
            Some(CopilotCatalogRefreshReason::Stale)
        );
    }

    #[tokio::test]
    async fn refresh_with_dedupes_concurrent_fetches_and_persists_snapshot() {
        let temp = tempdir().expect("tempdir");
        let snapshot_path = temp.path().join("catalogs").join(SNAPSHOT_FILE_NAME);
        let cache = CopilotCatalogCache::default();
        let fetch_count = Arc::new(AtomicU32::new(0));

        let first = cache.refresh_with(
            "test-key".to_string(),
            snapshot_path.clone(),
            "1.0.14".to_string(),
            {
                let fetch_count = fetch_count.clone();
                move || async move {
                    tokio::time::sleep(Duration::from_millis(20)).await;
                    fetch_count.fetch_add(1, Ordering::SeqCst);
                    Ok(AuthoritativeCatalogPayload {
                        models: vec![AvailableModel {
                            model_id: "gpt-5.4".to_string(),
                            name: "GPT-5.4".to_string(),
                            description: None,
                        }],
                    })
                }
            },
        );
        let second = cache.refresh_with(
            "test-key".to_string(),
            snapshot_path.clone(),
            "1.0.14".to_string(),
            {
                let fetch_count = fetch_count.clone();
                move || async move {
                    fetch_count.fetch_add(1, Ordering::SeqCst);
                    Ok(AuthoritativeCatalogPayload {
                        models: vec![AvailableModel {
                            model_id: "gpt-4.1".to_string(),
                            name: "GPT-4.1".to_string(),
                            description: None,
                        }],
                    })
                }
            },
        );

        let (first, second) = tokio::join!(first, second);
        let first = first.expect("first refresh");
        let second = second.expect("second refresh");

        assert_eq!(fetch_count.load(Ordering::SeqCst), 1);
        assert_eq!(first.models[0].model_id, "gpt-5.4");
        assert_eq!(second.models[0].model_id, "gpt-5.4");

        let persisted = load_snapshot(&snapshot_path)
            .expect("read snapshot")
            .expect("snapshot exists");
        assert_eq!(persisted.models[0].model_id, "gpt-5.4");
    }
}
