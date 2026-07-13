//! Ingress source traits — live and history paths normalize to `ProviderEvent`.

use std::fmt;
use std::path::PathBuf;

use async_trait::async_trait;
use serde_json::Value;

use crate::acp::parsers::ParseError;
use crate::acp::projections::RouteDecision;
use crate::acp::session::ingress::live_session_update::session_update_to_provider_event;
use crate::acp::session_update::SessionUpdate;
use crate::acp::types::CanonicalAgentId;

use super::event::ProviderEvent;

/// Input descriptor for reading history from disk.
#[derive(Debug, Clone)]
pub struct HistoryInput {
    pub session_id: String,
    pub workspace_root: Option<PathBuf>,
}

/// Provider-neutral facts needed to locate history for a restored session.
///
/// Each registered history source owns how these facts map to its physical
/// storage layout. Delivery code must not switch on provider identity.
#[derive(Debug, Clone)]
pub struct HistoryReplayInput {
    pub session_id: String,
    pub project_path: PathBuf,
    pub effective_cwd: Option<PathBuf>,
    pub source_path: Option<PathBuf>,
}

/// Errors from history ingress reads.
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub enum HistoryError {
    NotFound(String),
    InvalidFormat(String),
    Io(String),
}

impl fmt::Display for HistoryError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            HistoryError::NotFound(msg) => write!(f, "History not found: {msg}"),
            HistoryError::InvalidFormat(msg) => write!(f, "Invalid history format: {msg}"),
            HistoryError::Io(msg) => write!(f, "History IO error: {msg}"),
        }
    }
}

impl std::error::Error for HistoryError {}

/// Normalizes live ACP JSON into ordered provider events.
pub trait LiveSource: Sync {
    fn agent_id(&self) -> CanonicalAgentId;

    fn normalize(&self, raw: &Value) -> Result<Vec<ProviderEvent>, ParseError>;

    /// Map one parsed live update through the shared ingress mapper (terminal-turn aware).
    fn normalize_update(
        &self,
        event_seq: i64,
        update: &SessionUpdate,
        decision: RouteDecision,
    ) -> Option<ProviderEvent> {
        session_update_to_provider_event(self.agent_id(), event_seq, update, decision)
    }
}

/// Reads provider history from disk into ordered provider events.
#[async_trait]
pub trait HistorySource: Sync {
    async fn read(&self, input: HistoryInput) -> Result<Vec<ProviderEvent>, HistoryError>;

    /// Locate and read history for a restored session.
    async fn read_replay(
        &self,
        input: HistoryReplayInput,
    ) -> Result<Vec<ProviderEvent>, HistoryError> {
        let workspace_root = input.source_path.or(Some(input.project_path));
        self.read(HistoryInput {
            session_id: input.session_id,
            workspace_root,
        })
        .await
    }
}
