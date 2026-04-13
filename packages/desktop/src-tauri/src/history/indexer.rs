//! Background indexer for session metadata using the Actor pattern.
//!
//! The indexer maintains a SQLite index of session metadata, enabling
//! fast O(1) lookups instead of O(files * lines) file scanning.
//!
//! ## Actor Pattern
//!
//! The indexer uses a message-driven actor pattern:
//! - Single receiver processes messages sequentially (no race conditions)
//! - File watcher events, manual triggers, and status queries go through one channel
//! - Bounded channel provides natural backpressure
//!
//! ## Architecture
//!
//! ```text
//! ┌──────────────────┐     ┌─────────────────┐
//! │   File Watcher   │────▶│                 │
//! └──────────────────┘     │                 │
//! ┌──────────────────┐     │  IndexerActor   │────▶ SQLite
//! │ Manual Commands  │────▶│   (receiver)    │
//! └──────────────────┘     │                 │
//! ┌──────────────────┐     │                 │
//! │  Status Queries  │────▶│                 │
//! └──────────────────┘     └─────────────────┘
//! ```

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use chrono::Utc;
use sea_orm::DbConn;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::SystemTime;
use tokio::sync::{mpsc, oneshot, RwLock};

use crate::codex_history::scanner as codex_scanner;
use crate::copilot_history;
use crate::cursor_history::parser as cursor_parser;
use crate::db::repository::{
    AppSettingsRepository, SessionMetadataRecord, SessionMetadataRepository,
};
use crate::history::constants::MAX_SESSIONS_PER_PROJECT;
use crate::opencode_history::parser as opencode_parser;
use crate::session_jsonl::parser::{extract_thread_metadata, get_session_jsonl_root, path_to_slug};
use crate::session_jsonl::types::HistoryEntry;

const HISTORY_SYNC_STATE_KEY: &str = "history.sync_state.v1";
const SOURCE_CLAUDE: &str = "claude-code";
const SOURCE_COPILOT: &str = "copilot";
const SOURCE_CURSOR: &str = "cursor";
const SOURCE_OPENCODE: &str = "opencode";
const SOURCE_CODEX: &str = "codex";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct SourceSyncState {
    last_synced_at_ms: i64,
    last_duration_ms: u64,
    last_records_seen: usize,
    runs: u64,
}

type SyncStateMap = HashMap<String, SourceSyncState>;

#[derive(Debug)]
struct SourceDelta {
    records: Vec<SessionMetadataRecord>,
    live_session_ids: HashSet<String>,
    unchanged_count: usize,
    next_state: SourceSyncState,
}

#[async_trait]
trait SessionMetadataSource: Send + Sync {
    fn source_id(&self) -> &'static str;
    fn agent_id(&self) -> &'static str;
    async fn fetch(
        &self,
        db: &DbConn,
        project_paths: &[String],
        previous_state: Option<&SourceSyncState>,
    ) -> Result<SourceDelta>;
    async fn apply_tombstones(
        &self,
        db: &DbConn,
        project_paths: &[String],
        delta: &SourceDelta,
    ) -> Result<u64> {
        SessionMetadataRepository::delete_by_agent_for_projects_excluding_ids(
            db,
            self.agent_id(),
            project_paths,
            &delta.live_session_ids,
        )
        .await
    }
}

struct ClaudeSource;
struct CopilotSource;
struct CursorSource;
struct OpenCodeSource;
struct CodexSource;

fn history_entry_to_record_with_agent(
    entry: &HistoryEntry,
    agent_id: &str,
) -> SessionMetadataRecord {
    (
        entry.session_id.clone(),
        entry.display.clone(),
        entry.timestamp,
        entry.project.clone(),
        agent_id.to_string(),
        entry.source_path.clone().unwrap_or_default(),
        0, // provider snapshots are not per-file tracked
        0, // provider snapshots are not per-file tracked
    )
}

#[async_trait]
impl SessionMetadataSource for ClaudeSource {
    fn source_id(&self) -> &'static str {
        SOURCE_CLAUDE
    }

    fn agent_id(&self) -> &'static str {
        SOURCE_CLAUDE
    }

    async fn fetch(
        &self,
        db: &DbConn,
        project_paths: &[String],
        previous_state: Option<&SourceSyncState>,
    ) -> Result<SourceDelta> {
        let started = std::time::Instant::now();
        let jsonl_root = get_session_jsonl_root()?;
        let projects_dir = jsonl_root.join("projects");

        if !projects_dir.exists() {
            return Ok(SourceDelta {
                records: Vec::new(),
                live_session_ids: HashSet::new(),
                unchanged_count: 0,
                next_state: SourceSyncState {
                    last_synced_at_ms: Utc::now().timestamp_millis(),
                    last_duration_ms: started.elapsed().as_millis() as u64,
                    last_records_seen: 0,
                    runs: previous_state.map_or(1, |state| state.runs.saturating_add(1)),
                },
            });
        }

        let indexed_entries = SessionMetadataRepository::get_all_file_index_entries(db).await?;
        let indexed_map: HashMap<String, (String, i64, i64)> = indexed_entries
            .into_iter()
            .filter(|(_, _, mtime, _)| *mtime > 0)
            .map(|(session_id, path, mtime, size)| (path, (session_id, mtime, size)))
            .collect();

        let mut records: Vec<SessionMetadataRecord> = Vec::new();
        let mut live_session_ids: HashSet<String> = HashSet::new();
        let mut unchanged_count = 0usize;

        for project_path in project_paths {
            let slug = path_to_slug(project_path);
            let project_dir = projects_dir.join(&slug);
            if !tokio::fs::try_exists(&project_dir).await.unwrap_or(false) {
                continue;
            }

            let mut entries = match tokio::fs::read_dir(&project_dir).await {
                Ok(entries) => entries,
                Err(error) => {
                    tracing::warn!(
                        source = self.source_id(),
                        project_path = %project_path,
                        error = %error,
                        "Failed to read Claude project directory"
                    );
                    continue;
                }
            };

            while let Ok(Some(entry)) = entries.next_entry().await {
                let file_path = entry.path();
                if file_path.extension().is_none_or(|ext| ext != "jsonl") {
                    continue;
                }

                let relative_path = match claude_relative_path(&file_path) {
                    Ok(path) => path,
                    Err(_) => continue,
                };

                let metadata = match tokio::fs::metadata(&file_path).await {
                    Ok(metadata) => metadata,
                    Err(_) => continue,
                };
                let current_mtime = metadata
                    .modified()
                    .unwrap_or(SystemTime::UNIX_EPOCH)
                    .duration_since(SystemTime::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs() as i64;
                let current_size = metadata.len() as i64;

                if let Some((session_id, indexed_mtime, indexed_size)) =
                    indexed_map.get(&relative_path)
                {
                    live_session_ids.insert(session_id.clone());
                    if *indexed_mtime == current_mtime && *indexed_size == current_size {
                        unchanged_count += 1;
                        continue;
                    }
                }

                let extracted = extract_thread_metadata(&file_path).await?;
                let Some(entry) = extracted else {
                    continue;
                };
                let session_id = entry.session_id.clone();
                live_session_ids.insert(session_id.clone());
                records.push((
                    session_id,
                    entry.display,
                    entry.timestamp,
                    if entry.project.is_empty() {
                        project_path.to_string()
                    } else {
                        entry.project
                    },
                    entry.agent_id.to_string_with_prefix(),
                    relative_path,
                    current_mtime,
                    current_size,
                ));
            }
        }

        Ok(SourceDelta {
            next_state: SourceSyncState {
                last_synced_at_ms: Utc::now().timestamp_millis(),
                last_duration_ms: started.elapsed().as_millis() as u64,
                last_records_seen: live_session_ids.len(),
                runs: previous_state.map_or(1, |state| state.runs.saturating_add(1)),
            },
            records,
            live_session_ids,
            unchanged_count,
        })
    }
}

#[async_trait]
impl SessionMetadataSource for CopilotSource {
    fn source_id(&self) -> &'static str {
        SOURCE_COPILOT
    }

    fn agent_id(&self) -> &'static str {
        SOURCE_COPILOT
    }

    async fn fetch(
        &self,
        db: &DbConn,
        project_paths: &[String],
        previous_state: Option<&SourceSyncState>,
    ) -> Result<SourceDelta> {
        let started = std::time::Instant::now();
        let session_state_root = copilot_history::resolve_copilot_session_state_root()
            .map_err(|error| anyhow!(error))?;
        let sessions = copilot_history::list_workspace_sessions(project_paths)
            .await
            .map_err(|error| anyhow!(error))?;
        let session_ids = sessions
            .iter()
            .map(|session| session.session_id.clone())
            .collect::<Vec<_>>();
        let indexed_entries = SessionMetadataRepository::get_all_file_index_entries(db).await?;
        let indexed_map: HashMap<String, (String, i64, i64)> = indexed_entries
            .into_iter()
            .map(|(session_id, path, mtime, size)| (session_id, (path, mtime, size)))
            .collect();
        let existing_rows = SessionMetadataRepository::get_for_session_ids(db, &session_ids).await?;
        let mut existing_row_map = HashMap::new();
        for row in existing_rows {
            if let Some(provider_session_id) = row.provider_session_id.clone() {
                existing_row_map.insert(provider_session_id, row.clone());
            }
            existing_row_map.insert(row.id.clone(), row);
        }

        let mut records: Vec<SessionMetadataRecord> = Vec::with_capacity(sessions.len());
        let mut live_session_ids: HashSet<String> = HashSet::with_capacity(sessions.len());
        let mut unchanged_count = 0usize;

        for session in sessions {
            let session_id = session.session_id.clone();
            live_session_ids.insert(session_id.clone());

            if let Some(worktree_path) = session.worktree_path.as_deref() {
                SessionMetadataRepository::set_worktree_path(
                    db,
                    &session_id,
                    worktree_path,
                    Some(&session.project_path),
                    Some(self.agent_id()),
                )
                .await?;
            }

            let events_path =
                copilot_history::events_jsonl_path_for_session(&session_state_root, &session_id);
            let (file_path, file_mtime, file_size) = match tokio::fs::metadata(&events_path).await {
                Ok(metadata) => {
                    let modified = metadata
                        .modified()
                        .unwrap_or(SystemTime::UNIX_EPOCH)
                        .duration_since(SystemTime::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs() as i64;
                    (
                        events_path.to_string_lossy().into_owned(),
                        modified,
                        metadata.len() as i64,
                    )
                }
                Err(_) => (
                    copilot_history::missing_transcript_marker(&session_id),
                    0,
                    0,
                ),
            };

            if let Some((indexed_path, indexed_mtime, indexed_size)) = indexed_map.get(&session_id)
            {
                let title_refresh_needed = existing_row_map.get(&session_id).is_some_and(|row| {
                    !row.title_overridden
                        && SessionMetadataRepository::is_acepe_placeholder_display(
                            &row.id,
                            &row.display,
                        )
                        && !session.title.trim().is_empty()
                        && session.title != row.display
                });
                if indexed_path == &file_path
                    && indexed_mtime == &file_mtime
                    && indexed_size == &file_size
                    && !title_refresh_needed
                {
                    unchanged_count += 1;
                    continue;
                }
            }

            records.push((
                session_id.clone(),
                session.title,
                session.updated_at_ms,
                session.project_path,
                self.agent_id().to_string(),
                file_path,
                file_mtime,
                file_size,
            ));
        }

        Ok(SourceDelta {
            next_state: SourceSyncState {
                last_synced_at_ms: Utc::now().timestamp_millis(),
                last_duration_ms: started.elapsed().as_millis() as u64,
                last_records_seen: live_session_ids.len(),
                runs: previous_state.map_or(1, |state| state.runs.saturating_add(1)),
            },
            records,
            live_session_ids,
            unchanged_count,
        })
    }
}

#[async_trait]
impl SessionMetadataSource for CursorSource {
    fn source_id(&self) -> &'static str {
        SOURCE_CURSOR
    }

    fn agent_id(&self) -> &'static str {
        SOURCE_CURSOR
    }

    async fn fetch(
        &self,
        db: &DbConn,
        project_paths: &[String],
        previous_state: Option<&SourceSyncState>,
    ) -> Result<SourceDelta> {
        let _ = db;
        let _ = previous_state;
        let started = std::time::Instant::now();
        let entries = cursor_parser::discover_all_chats(project_paths).await?;
        let records: Vec<SessionMetadataRecord> = entries
            .iter()
            .map(cursor_parser::to_history_entry)
            .map(|entry| history_entry_to_record_with_agent(&entry, self.agent_id()))
            .collect();
        let live_session_ids = records
            .iter()
            .map(|record| record.0.clone())
            .collect::<HashSet<_>>();

        Ok(SourceDelta {
            next_state: SourceSyncState {
                last_synced_at_ms: Utc::now().timestamp_millis(),
                last_duration_ms: started.elapsed().as_millis() as u64,
                last_records_seen: records.len(),
                runs: previous_state.map_or(1, |state| state.runs.saturating_add(1)),
            },
            records,
            live_session_ids,
            unchanged_count: 0,
        })
    }
}

#[async_trait]
impl SessionMetadataSource for OpenCodeSource {
    fn source_id(&self) -> &'static str {
        SOURCE_OPENCODE
    }

    fn agent_id(&self) -> &'static str {
        SOURCE_OPENCODE
    }

    async fn fetch(
        &self,
        db: &DbConn,
        project_paths: &[String],
        previous_state: Option<&SourceSyncState>,
    ) -> Result<SourceDelta> {
        let _ = db;
        let started = std::time::Instant::now();
        let entries = opencode_parser::scan_sessions(project_paths).await?;
        let records: Vec<SessionMetadataRecord> = entries
            .iter()
            .map(|entry| history_entry_to_record_with_agent(entry, self.agent_id()))
            .collect();
        let live_session_ids = records
            .iter()
            .map(|record| record.0.clone())
            .collect::<HashSet<_>>();

        Ok(SourceDelta {
            next_state: SourceSyncState {
                last_synced_at_ms: Utc::now().timestamp_millis(),
                last_duration_ms: started.elapsed().as_millis() as u64,
                last_records_seen: records.len(),
                runs: previous_state.map_or(1, |state| state.runs.saturating_add(1)),
            },
            records,
            live_session_ids,
            unchanged_count: 0,
        })
    }
}

#[async_trait]
impl SessionMetadataSource for CodexSource {
    fn source_id(&self) -> &'static str {
        SOURCE_CODEX
    }

    fn agent_id(&self) -> &'static str {
        SOURCE_CODEX
    }

    async fn fetch(
        &self,
        db: &DbConn,
        project_paths: &[String],
        previous_state: Option<&SourceSyncState>,
    ) -> Result<SourceDelta> {
        let _ = db;
        let started = std::time::Instant::now();
        let entries = codex_scanner::scan_sessions_metadata_only(project_paths).await?;
        let records: Vec<SessionMetadataRecord> = entries
            .iter()
            .map(|entry| history_entry_to_record_with_agent(entry, self.agent_id()))
            .collect();
        let live_session_ids = records
            .iter()
            .map(|record| record.0.clone())
            .collect::<HashSet<_>>();

        Ok(SourceDelta {
            next_state: SourceSyncState {
                last_synced_at_ms: Utc::now().timestamp_millis(),
                last_duration_ms: started.elapsed().as_millis() as u64,
                last_records_seen: records.len(),
                runs: previous_state.map_or(1, |state| state.runs.saturating_add(1)),
            },
            records,
            live_session_ids,
            unchanged_count: 0,
        })
    }
}

async fn load_sync_state_map(db: &DbConn) -> Result<SyncStateMap> {
    let raw = AppSettingsRepository::get(db, HISTORY_SYNC_STATE_KEY).await?;
    match raw {
        Some(json) => Ok(serde_json::from_str(&json).unwrap_or_default()),
        None => Ok(HashMap::new()),
    }
}

async fn save_sync_state_map(db: &DbConn, state: &SyncStateMap) -> Result<()> {
    let json = serde_json::to_string(state)?;
    AppSettingsRepository::set(db, HISTORY_SYNC_STATE_KEY, &json).await
}

fn claude_relative_path(file_path: &Path) -> Result<String> {
    let jsonl_root = get_session_jsonl_root()?;
    let projects_dir = jsonl_root.join("projects");
    let relative = file_path
        .strip_prefix(&projects_dir)
        .map_err(|_| anyhow!("File not in Claude projects directory"))?;
    Ok(relative.to_string_lossy().to_string())
}

// ============================================================================
// Message Types (Actor Protocol)
// ============================================================================

/// Messages that can be sent to the indexer actor.
#[derive(Debug)]
pub enum IndexerMessage {
    /// Perform a full scan of all project directories.
    FullScan {
        project_paths: Vec<String>,
        reply: oneshot::Sender<Result<ScanResult>>,
    },
    /// Perform an incremental scan (check mtimes, only update changed files).
    IncrementalScan {
        project_paths: Vec<String>,
        reply: oneshot::Sender<Result<ScanResult>>,
    },
    /// Index a single file (from file watcher).
    IndexFile {
        file_path: PathBuf,
        reply: Option<oneshot::Sender<Result<bool>>>,
    },
    /// Delete a file from the index (from file watcher).
    DeleteFile {
        file_path: PathBuf,
        reply: Option<oneshot::Sender<Result<()>>>,
    },
    /// Get current indexing status.
    GetStatus { reply: oneshot::Sender<IndexStatus> },
    /// Shutdown the actor.
    Shutdown,
}

/// Result of a scan operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanResult {
    pub files_indexed: usize,
    pub files_unchanged: usize,
    pub files_deleted: usize,
    pub duration_ms: u64,
}

/// Current indexing status.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(tag = "status")]
pub enum IndexStatus {
    /// Indexer is idle, ready for queries.
    Idle,
    /// Currently indexing files.
    Indexing {
        progress: f32,
        files_processed: usize,
        total_files: usize,
    },
    /// Indexing complete, index is ready.
    Ready { session_count: u64 },
    /// An error occurred during indexing.
    Error { message: String },
}

// ============================================================================
// Indexer Handle (Client-side)
// ============================================================================

/// Handle to communicate with the indexer actor.
///
/// This is the client-side handle that can be cloned and shared.
/// All operations go through the message channel to the actor.
#[derive(Clone)]
pub struct IndexerHandle {
    sender: mpsc::Sender<IndexerMessage>,
}

impl IndexerHandle {
    /// Request a full scan of all project directories.
    pub async fn full_scan(&self, project_paths: Vec<String>) -> Result<ScanResult> {
        let (reply_tx, reply_rx) = oneshot::channel();
        self.sender
            .send(IndexerMessage::FullScan {
                project_paths,
                reply: reply_tx,
            })
            .await
            .map_err(|_| anyhow!("Indexer actor has shut down"))?;
        reply_rx
            .await
            .map_err(|_| anyhow!("Indexer actor dropped reply channel"))?
    }

    /// Request an incremental scan (check mtimes, only update changed files).
    pub async fn incremental_scan(&self, project_paths: Vec<String>) -> Result<ScanResult> {
        let (reply_tx, reply_rx) = oneshot::channel();
        self.sender
            .send(IndexerMessage::IncrementalScan {
                project_paths,
                reply: reply_tx,
            })
            .await
            .map_err(|_| anyhow!("Indexer actor has shut down"))?;
        reply_rx
            .await
            .map_err(|_| anyhow!("Indexer actor dropped reply channel"))?
    }

    /// Index a single file.
    pub async fn index_file(&self, file_path: PathBuf) -> Result<bool> {
        let (reply_tx, reply_rx) = oneshot::channel();
        self.sender
            .send(IndexerMessage::IndexFile {
                file_path,
                reply: Some(reply_tx),
            })
            .await
            .map_err(|_| anyhow!("Indexer actor has shut down"))?;
        reply_rx
            .await
            .map_err(|_| anyhow!("Indexer actor dropped reply channel"))?
    }

    /// Index a file without waiting for reply (fire-and-forget for file watcher).
    pub fn index_file_nowait(&self, file_path: PathBuf) {
        let _ = self.sender.try_send(IndexerMessage::IndexFile {
            file_path,
            reply: None,
        });
    }

    /// Delete a file from the index.
    pub async fn delete_file(&self, file_path: PathBuf) -> Result<()> {
        let (reply_tx, reply_rx) = oneshot::channel();
        self.sender
            .send(IndexerMessage::DeleteFile {
                file_path,
                reply: Some(reply_tx),
            })
            .await
            .map_err(|_| anyhow!("Indexer actor has shut down"))?;
        reply_rx
            .await
            .map_err(|_| anyhow!("Indexer actor dropped reply channel"))?
    }

    /// Delete a file without waiting for reply (fire-and-forget for file watcher).
    pub fn delete_file_nowait(&self, file_path: PathBuf) {
        let _ = self.sender.try_send(IndexerMessage::DeleteFile {
            file_path,
            reply: None,
        });
    }

    /// Get current indexing status.
    pub async fn get_status(&self) -> Result<IndexStatus> {
        let (reply_tx, reply_rx) = oneshot::channel();
        self.sender
            .send(IndexerMessage::GetStatus { reply: reply_tx })
            .await
            .map_err(|_| anyhow!("Indexer actor has shut down"))?;
        reply_rx
            .await
            .map_err(|_| anyhow!("Indexer actor dropped reply channel"))
    }

    /// Request the actor to shut down.
    pub async fn shutdown(&self) -> Result<()> {
        self.sender
            .send(IndexerMessage::Shutdown)
            .await
            .map_err(|_| anyhow!("Indexer actor already shut down"))?;
        Ok(())
    }
}

// ============================================================================
// Indexer Actor (Server-side)
// ============================================================================

/// The indexer actor that processes messages.
pub struct IndexerActor {
    db: Arc<DbConn>,
    receiver: mpsc::Receiver<IndexerMessage>,
    status: Arc<RwLock<IndexStatus>>,
    /// Batch size for transactions during full scan
    batch_size: usize,
}

impl IndexerActor {
    /// Create a new indexer actor and return the handle.
    pub fn spawn(db: Arc<DbConn>) -> IndexerHandle {
        let (sender, receiver) = mpsc::channel(100);
        let status = Arc::new(RwLock::new(IndexStatus::Idle));

        let actor = Self {
            db,
            receiver,
            status,
            batch_size: 50, // Batch 50 records per transaction
        };

        // Spawn the actor task using Tauri's async runtime
        // (tokio::spawn doesn't work here because the Tauri runtime isn't
        // available on the current thread context during setup)
        tauri::async_runtime::spawn(actor.run());

        IndexerHandle { sender }
    }

    /// Run the actor's message loop.
    async fn run(mut self) {
        tracing::info!("Session indexer actor started");

        while let Some(msg) = self.receiver.recv().await {
            match msg {
                IndexerMessage::FullScan {
                    project_paths,
                    reply,
                } => {
                    let result = self.handle_full_scan(&project_paths).await;
                    let _ = reply.send(result);
                }
                IndexerMessage::IncrementalScan {
                    project_paths,
                    reply,
                } => {
                    let result = self.handle_incremental_scan(&project_paths).await;
                    let _ = reply.send(result);
                }
                IndexerMessage::IndexFile { file_path, reply } => {
                    let result = self.handle_index_file(&file_path).await;
                    if let Some(reply) = reply {
                        let _ = reply.send(result);
                    }
                }
                IndexerMessage::DeleteFile { file_path, reply } => {
                    let result = self.handle_delete_file(&file_path).await;
                    if let Some(reply) = reply {
                        let _ = reply.send(result);
                    }
                }
                IndexerMessage::GetStatus { reply } => {
                    let status = self.status.read().await.clone();
                    let _ = reply.send(status);
                }
                IndexerMessage::Shutdown => {
                    tracing::info!("Session indexer actor shutting down");
                    break;
                }
            }
        }

        tracing::info!("Session indexer actor stopped");
    }

    /// Handle a full scan of all project directories.
    async fn handle_full_scan(&self, project_paths: &[String]) -> Result<ScanResult> {
        let start = std::time::Instant::now();

        let jsonl_root = get_session_jsonl_root()?;
        let projects_dir = jsonl_root.join("projects");

        if !projects_dir.exists() {
            *self.status.write().await = IndexStatus::Ready { session_count: 0 };
            return Ok(ScanResult {
                files_indexed: 0,
                files_unchanged: 0,
                files_deleted: 0,
                duration_ms: start.elapsed().as_millis() as u64,
            });
        }

        // Collect .jsonl files to process (with limit per project)
        let mut all_files: Vec<(PathBuf, String)> = Vec::new();
        for project_path in project_paths {
            let slug = path_to_slug(project_path);
            let project_dir = projects_dir.join(&slug);
            if !project_dir.exists() {
                continue;
            }

            let mut entries = match tokio::fs::read_dir(&project_dir).await {
                Ok(e) => e,
                Err(e) => {
                    tracing::warn!(project_path = %project_path, error = %e, "Failed to read project directory");
                    continue;
                }
            };

            // Collect files with modification times for sorting
            let mut files_with_mtime: Vec<(PathBuf, SystemTime)> = Vec::new();
            while let Ok(Some(entry)) = entries.next_entry().await {
                let path = entry.path();
                if path.extension().is_none_or(|ext| ext != "jsonl") {
                    continue;
                }

                if let Ok(metadata) = entry.metadata().await {
                    if let Ok(mtime) = metadata.modified() {
                        files_with_mtime.push((path, mtime));
                    }
                }
            }

            // Sort by modification time (most recent first) and limit
            files_with_mtime.sort_by(|a, b| b.1.cmp(&a.1));

            for (path, _) in files_with_mtime.into_iter().take(MAX_SESSIONS_PER_PROJECT) {
                all_files.push((path, project_path.clone()));
            }
        }

        let total_files = all_files.len();
        tracing::info!(total_files = total_files, "Starting full index scan");

        *self.status.write().await = IndexStatus::Indexing {
            progress: 0.0,
            files_processed: 0,
            total_files,
        };

        let mut files_indexed = 0usize;
        let mut files_unchanged = 0usize;
        let mut batch: Vec<SessionMetadataRecord> = Vec::with_capacity(self.batch_size);

        // Load all indexed entries upfront (1 query instead of N per-file queries)
        let existing: HashMap<String, (i64, i64)> =
            SessionMetadataRepository::get_all_file_paths_with_mtime(&self.db)
                .await
                .unwrap_or_default()
                .into_iter()
                .map(|(path, mtime, size)| (path, (mtime, size)))
                .collect();

        for (i, (file_path, project_path)) in all_files.iter().enumerate() {
            match self
                .extract_and_prepare_record(file_path, project_path, &existing)
                .await
            {
                Ok(Some(record)) => {
                    batch.push(record);

                    // Flush batch when full
                    if batch.len() >= self.batch_size {
                        match SessionMetadataRepository::batch_upsert(
                            &self.db,
                            std::mem::take(&mut batch),
                        )
                        .await
                        {
                            Ok(count) => files_indexed += count,
                            Err(e) => tracing::error!(error = %e, "Failed to batch upsert"),
                        }
                    }
                }
                Ok(None) => {
                    files_unchanged += 1;
                }
                Err(e) => {
                    tracing::warn!(file = %file_path.display(), error = %e, "Failed to index file");
                }
            }

            // Update progress every 10 files
            if i % 10 == 0 || i == total_files - 1 {
                *self.status.write().await = IndexStatus::Indexing {
                    progress: (i + 1) as f32 / total_files as f32,
                    files_processed: i + 1,
                    total_files,
                };
            }
        }

        // Flush remaining batch
        if !batch.is_empty() {
            match SessionMetadataRepository::batch_upsert(&self.db, batch).await {
                Ok(count) => files_indexed += count,
                Err(e) => tracing::error!(error = %e, "Failed to batch upsert remaining"),
            }
        }

        // Index other agents (Cursor, OpenCode, Codex) by calling their scanners
        let other_indexed = if project_paths.is_empty() {
            0
        } else {
            self.index_other_agents(project_paths).await
        };
        files_indexed += other_indexed;

        let session_count = SessionMetadataRepository::count(&self.db)
            .await
            .unwrap_or(0);
        *self.status.write().await = IndexStatus::Ready { session_count };

        let duration_ms = start.elapsed().as_millis() as u64;
        tracing::info!(
            files_indexed = files_indexed,
            files_unchanged = files_unchanged,
            other_agents_indexed = other_indexed,
            duration_ms = duration_ms,
            "Full index scan complete"
        );

        Ok(ScanResult {
            files_indexed,
            files_unchanged,
            files_deleted: 0,
            duration_ms,
        })
    }

    /// Provider-agnostic metadata synchronization for non-Claude sources.
    ///
    /// Flow per source:
    /// 1. Load previous sync state
    /// 2. Fetch source snapshot/delta
    /// 3. Batch upsert metadata
    /// 4. Tombstone stale rows by agent+project scope
    /// 5. Persist next sync state
    async fn index_other_agents(&self, project_paths: &[String]) -> usize {
        let mut sync_state = match load_sync_state_map(&self.db).await {
            Ok(state) => state,
            Err(error) => {
                tracing::warn!(error = %error, "Failed to load history sync state");
                HashMap::new()
            }
        };

        let sources: [Box<dyn SessionMetadataSource>; 4] = [
            Box::new(CopilotSource),
            Box::new(CursorSource),
            Box::new(OpenCodeSource),
            Box::new(CodexSource),
        ];

        let mut total_upserted = 0usize;

        for source in sources {
            let source_id = source.source_id();
            let previous = sync_state.get(source_id);
            let fetched = source.fetch(&self.db, project_paths, previous).await;

            let mut delta = match fetched {
                Ok(delta) => delta,
                Err(error) => {
                    tracing::warn!(
                        source = source_id,
                        error = %error,
                        "Source sync failed"
                    );
                    continue;
                }
            };

            let records = std::mem::take(&mut delta.records);
            if !records.is_empty() {
                match SessionMetadataRepository::batch_upsert(&self.db, records).await {
                    Ok(upserted) => {
                        total_upserted += upserted;
                        tracing::debug!(
                            source = source_id,
                            upserted = upserted,
                            "Source metadata upsert complete"
                        );
                    }
                    Err(error) => {
                        tracing::warn!(
                            source = source_id,
                            error = %error,
                            "Source metadata upsert failed"
                        );
                        continue;
                    }
                }
            }

            if let Err(error) = source
                .apply_tombstones(&self.db, project_paths, &delta)
                .await
            {
                tracing::warn!(
                    source = source_id,
                    error = %error,
                    "Source tombstone sync failed"
                );
            }

            sync_state.insert(source_id.to_string(), delta.next_state);
        }

        if let Err(error) = save_sync_state_map(&self.db, &sync_state).await {
            tracing::warn!(error = %error, "Failed to save history sync state");
        }

        total_upserted
    }

    /// Handle an incremental scan (check mtimes, only update changed files).
    async fn handle_incremental_scan(&self, project_paths: &[String]) -> Result<ScanResult> {
        let start = std::time::Instant::now();
        if project_paths.is_empty() {
            return Ok(ScanResult {
                files_indexed: 0,
                files_unchanged: 0,
                files_deleted: 0,
                duration_ms: start.elapsed().as_millis() as u64,
            });
        }

        let mut sync_state = match load_sync_state_map(&self.db).await {
            Ok(state) => state,
            Err(error) => {
                tracing::warn!(error = %error, "Failed to load history sync state");
                HashMap::new()
            }
        };

        let sources: [Box<dyn SessionMetadataSource>; 5] = [
            Box::new(ClaudeSource),
            Box::new(CopilotSource),
            Box::new(CursorSource),
            Box::new(OpenCodeSource),
            Box::new(CodexSource),
        ];

        let mut files_indexed = 0usize;
        let mut files_unchanged = 0usize;
        let mut files_deleted = 0usize;

        for source in sources {
            let source_id = source.source_id();
            let previous = sync_state.get(source_id);
            let fetched = source.fetch(&self.db, project_paths, previous).await;
            let mut delta = match fetched {
                Ok(delta) => delta,
                Err(error) => {
                    tracing::warn!(
                        source = source_id,
                        error = %error,
                        "Source sync failed during incremental scan"
                    );
                    continue;
                }
            };

            files_unchanged += delta.unchanged_count;

            let records = std::mem::take(&mut delta.records);
            if !records.is_empty() {
                match SessionMetadataRepository::batch_upsert(&self.db, records).await {
                    Ok(upserted) => files_indexed += upserted,
                    Err(error) => {
                        tracing::warn!(
                            source = source_id,
                            error = %error,
                            "Source upsert failed during incremental scan"
                        );
                        continue;
                    }
                }
            }

            match source
                .apply_tombstones(&self.db, project_paths, &delta)
                .await
            {
                Ok(deleted) => files_deleted += deleted as usize,
                Err(error) => {
                    tracing::warn!(
                        source = source_id,
                        error = %error,
                        "Source tombstone sync failed during incremental scan"
                    );
                }
            }

            sync_state.insert(source_id.to_string(), delta.next_state);
        }

        if let Err(error) = save_sync_state_map(&self.db, &sync_state).await {
            tracing::warn!(error = %error, "Failed to save history sync state");
        }

        let session_count = SessionMetadataRepository::count(&self.db)
            .await
            .unwrap_or(0);
        *self.status.write().await = IndexStatus::Ready { session_count };

        let duration_ms = start.elapsed().as_millis() as u64;
        tracing::info!(
            files_indexed = files_indexed,
            files_unchanged = files_unchanged,
            files_deleted = files_deleted,
            duration_ms = duration_ms,
            "Incremental scan complete"
        );

        Ok(ScanResult {
            files_indexed,
            files_unchanged,
            files_deleted,
            duration_ms,
        })
    }

    /// Handle indexing a single file.
    async fn handle_index_file(&self, file_path: &PathBuf) -> Result<bool> {
        if file_path.extension().is_none_or(|ext| ext != "jsonl") {
            return Ok(false);
        }

        if !file_path.exists() {
            // File was deleted, remove from index
            let relative_path = self.get_relative_path(file_path)?;
            SessionMetadataRepository::delete_by_file_path(&self.db, &relative_path).await?;
            return Ok(true);
        }

        // Extract project path from file path
        let project_path = self.extract_project_path(file_path)?;
        self.index_single_file(file_path, &project_path).await
    }

    /// Handle deleting a file from the index.
    async fn handle_delete_file(&self, file_path: &Path) -> Result<()> {
        let relative_path = self.get_relative_path(file_path)?;
        SessionMetadataRepository::delete_by_file_path(&self.db, &relative_path).await?;
        tracing::debug!(file_path = %file_path.display(), "Removed file from index");
        Ok(())
    }

    /// Index a single file and upsert to database.
    async fn index_single_file(&self, file_path: &PathBuf, project_path: &str) -> Result<bool> {
        let metadata = tokio::fs::metadata(file_path).await?;
        let mtime = metadata
            .modified()
            .unwrap_or(SystemTime::UNIX_EPOCH)
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        let size = metadata.len() as i64;

        // Extract metadata from file
        let entry = match extract_thread_metadata(file_path).await? {
            Some(entry) => entry,
            None => return Ok(false), // Skip invalid files
        };

        let relative_path = self.get_relative_path(file_path)?;

        // Upsert into database
        SessionMetadataRepository::upsert(
            &self.db,
            entry.session_id,
            entry.display,
            entry.timestamp,
            if entry.project.is_empty() {
                project_path.to_string()
            } else {
                entry.project
            },
            entry.agent_id.to_string_with_prefix(), // Convert enum to string for DB (with prefix for Custom)
            relative_path,
            mtime,
            size,
        )
        .await
    }

    /// Extract and prepare a record for indexing, checking against a pre-loaded
    /// map of existing entries to avoid per-file DB queries (N+1 elimination).
    async fn extract_and_prepare_record(
        &self,
        file_path: &PathBuf,
        project_path: &str,
        existing: &HashMap<String, (i64, i64)>,
    ) -> Result<Option<SessionMetadataRecord>> {
        let metadata = tokio::fs::metadata(file_path).await?;
        let mtime = metadata
            .modified()
            .unwrap_or(SystemTime::UNIX_EPOCH)
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        let size = metadata.len() as i64;

        let relative_path = self.get_relative_path(file_path)?;

        // Check against pre-loaded map (O(1) HashMap lookup, not a DB query)
        if let Some(&(indexed_mtime, indexed_size)) = existing.get(&relative_path) {
            if indexed_mtime == mtime && indexed_size == size {
                return Ok(None); // Unchanged
            }
        }

        // Extract metadata from file
        let entry = match extract_thread_metadata(file_path).await? {
            Some(entry) => entry,
            None => return Ok(None), // Skip invalid files
        };

        let final_project = if entry.project.is_empty() {
            project_path.to_string()
        } else {
            entry.project
        };

        Ok(Some((
            entry.session_id,
            entry.display,
            entry.timestamp,
            final_project,
            entry.agent_id.to_string_with_prefix(), // Convert enum to string for return (with prefix for Custom)
            relative_path,
            mtime,
            size,
        )))
    }

    /// Get relative path from full file path (for storage in DB).
    fn get_relative_path(&self, file_path: &Path) -> Result<String> {
        let jsonl_root = get_session_jsonl_root()?;
        let projects_dir = jsonl_root.join("projects");
        let relative = file_path
            .strip_prefix(&projects_dir)
            .map_err(|_| anyhow!("File not in projects directory"))?;
        Ok(relative.to_string_lossy().to_string())
    }

    /// Extract project path from file path (reverse of path_to_slug).
    fn extract_project_path(&self, file_path: &Path) -> Result<String> {
        let jsonl_root = get_session_jsonl_root()?;
        let projects_dir = jsonl_root.join("projects");
        let relative = file_path
            .strip_prefix(&projects_dir)
            .map_err(|_| anyhow!("File not in projects directory"))?;

        // Get the first component (the slug directory)
        let slug = relative
            .components()
            .next()
            .and_then(|c| c.as_os_str().to_str())
            .ok_or_else(|| anyhow!("Invalid file path structure"))?;

        // Convert slug back to path (reverse of path_to_slug)
        // -Users-example-Documents -> /Users/example/Documents
        let path = if slug.starts_with('-') {
            slug.replace('-', "/")
        } else {
            format!("/{}", slug.replace('-', "/"))
        };

        Ok(path)
    }
}

#[cfg(test)]
mod tests {
    use super::{CopilotSource, SessionMetadataSource};
    use crate::db::repository::SessionMetadataRepository;
    use sea_orm::{Database, DbConn};
    use sea_orm_migration::MigratorTrait;
    use std::fs;
    use std::path::Path;
    use std::sync::{Mutex, OnceLock};
    use tempfile::TempDir;

    async fn setup_test_db() -> DbConn {
        let db = Database::connect("sqlite::memory:")
            .await
            .expect("Failed to connect to in-memory SQLite");
        crate::db::migrations::Migrator::up(&db, None)
            .await
            .expect("Failed to run migrations");
        db
    }

    fn home_test_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    struct HomeGuard {
        previous_value: Option<String>,
    }

    impl HomeGuard {
        fn set(path: &Path) -> Self {
            let previous_value = std::env::var("HOME").ok();
            std::env::set_var("HOME", path);
            Self { previous_value }
        }
    }

    impl Drop for HomeGuard {
        fn drop(&mut self) {
            if let Some(previous_value) = &self.previous_value {
                std::env::set_var("HOME", previous_value);
            } else {
                std::env::remove_var("HOME");
            }
        }
    }

    fn write_copilot_session(home_path: &Path, project_path: &Path, session_id: &str) -> (String, i64, i64) {
        let session_dir = home_path
            .join(".copilot")
            .join("session-state")
            .join(session_id);
        fs::create_dir_all(&session_dir).expect("create copilot session dir");
        let events_path = session_dir.join("events.jsonl");
        fs::write(
            &events_path,
            "{\"type\":\"user.message\",\"data\":{\"content\":\"hello\"},\"timestamp\":\"2026-04-10T00:00:01Z\"}\n",
        )
        .expect("write events jsonl");
        fs::write(
            session_dir.join("workspace.yaml"),
            format!(
                "id: {session_id}\ncwd: {}\nsummary: Real Copilot title\nupdated_at: 2026-04-10T00:00:02Z\n",
                project_path.display()
            ),
        )
        .expect("write workspace metadata");

        let metadata = fs::metadata(&events_path).expect("events metadata");
        let modified = metadata
            .modified()
            .expect("modified time")
            .duration_since(std::time::SystemTime::UNIX_EPOCH)
            .expect("unix timestamp")
            .as_secs() as i64;

        (
            events_path.to_string_lossy().into_owned(),
            modified,
            metadata.len() as i64,
        )
    }

    #[tokio::test]
    async fn copilot_source_fetch_emits_title_refresh_when_only_summary_changed() {
        let _lock = home_test_lock().lock().expect("home lock");
        let temp_dir = TempDir::new().expect("temp dir");
        let home_dir = temp_dir.path().join("home");
        fs::create_dir_all(&home_dir).expect("home dir");
        let _guard = HomeGuard::set(&home_dir);

        let project_dir = temp_dir.path().join("project");
        fs::create_dir_all(&project_dir).expect("project dir");
        git2::Repository::init(&project_dir).expect("init project repo");
        let canonical_project = project_dir
            .canonicalize()
            .expect("canonical project path")
            .to_string_lossy()
            .into_owned();

        let session_id = "12345678-copilot-session";
        let (events_path, file_mtime, file_size) =
            write_copilot_session(&home_dir, &project_dir, session_id);

        let db = setup_test_db().await;
        SessionMetadataRepository::ensure_exists(&db, session_id, &canonical_project, "copilot", None)
            .await
            .expect("seed placeholder row");

        let placeholder = SessionMetadataRepository::get_by_id(&db, session_id)
            .await
            .expect("load placeholder row")
            .expect("placeholder row")
            .display;

        SessionMetadataRepository::upsert(
            &db,
            session_id.to_string(),
            placeholder,
            1704067200000,
            canonical_project.clone(),
            "copilot".to_string(),
            events_path,
            file_mtime,
            file_size,
        )
        .await
        .expect("seed transcript metadata");

        let source = CopilotSource;
        let delta = source
            .fetch(&db, &[canonical_project], None)
            .await
            .expect("fetch copilot delta");

        assert_eq!(delta.records.len(), 1);
        assert_eq!(delta.records[0].0, session_id);
        assert_eq!(delta.records[0].1, "Real Copilot title");
    }
}
