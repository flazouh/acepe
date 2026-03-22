use crate::terminal::types::TerminalExitStatus;
use dashmap::DashMap;
use std::sync::Arc;
use tokio::process::Child;
use tokio::sync::{oneshot, Mutex as TokioMutex};
use tokio::task::JoinHandle;

/// State for a running terminal process
pub struct TerminalState {
    pub terminal_id: String,
    pub session_id: String,
    pub command: String,
    pub output_buffer: Arc<TokioMutex<String>>,
    pub output_byte_limit: Option<u64>,
    pub truncated: Arc<TokioMutex<bool>>,
    pub child: Arc<TokioMutex<Option<Child>>>,
    pub exit_status: Arc<TokioMutex<Option<TerminalExitStatus>>>,
    /// Oneshot channels for wait_for_exit callers
    pub exit_waiters: Arc<TokioMutex<Vec<oneshot::Sender<TerminalExitStatus>>>>,
    /// Handles for stdout/stderr reader tasks; awaited before signalling exit
    /// so that all output is buffered before callers read it.
    pub output_readers: Arc<TokioMutex<Vec<JoinHandle<()>>>>,
}

impl TerminalState {
    pub fn new(
        terminal_id: String,
        session_id: String,
        command: String,
        output_byte_limit: Option<u64>,
        child: Child,
    ) -> Self {
        Self {
            terminal_id,
            session_id,
            command,
            output_buffer: Arc::new(TokioMutex::new(String::new())),
            output_byte_limit,
            truncated: Arc::new(TokioMutex::new(false)),
            child: Arc::new(TokioMutex::new(Some(child))),
            exit_status: Arc::new(TokioMutex::new(None)),
            exit_waiters: Arc::new(TokioMutex::new(Vec::new())),
            output_readers: Arc::new(TokioMutex::new(Vec::new())),
        }
    }
}

/// Thread-safe registry for active terminals.
/// Uses DashMap for concurrent access without a global lock.
pub struct TerminalRegistry {
    terminals: DashMap<String, Arc<TerminalState>>,
}

impl TerminalRegistry {
    pub fn new() -> Self {
        Self {
            terminals: DashMap::new(),
        }
    }

    /// Insert a new terminal state into the registry
    pub fn insert(&self, terminal_id: String, state: Arc<TerminalState>) {
        tracing::debug!(terminal_id = %terminal_id, "Terminal registered");
        self.terminals.insert(terminal_id, state);
    }

    /// Get a terminal by its ID
    pub fn get(&self, terminal_id: &str) -> Option<Arc<TerminalState>> {
        self.terminals.get(terminal_id).map(|r| Arc::clone(&r))
    }

    /// Remove a terminal from the registry
    pub fn remove(&self, terminal_id: &str) -> Option<Arc<TerminalState>> {
        let result = self.terminals.remove(terminal_id).map(|(_, v)| v);
        if result.is_some() {
            tracing::debug!(terminal_id = %terminal_id, "Terminal removed from registry");
        }
        result
    }

    /// Get all terminals for a specific session
    pub fn get_session_terminals(&self, session_id: &str) -> Vec<Arc<TerminalState>> {
        self.terminals
            .iter()
            .filter(|r| r.session_id == session_id)
            .map(|r| Arc::clone(&r))
            .collect()
    }

    /// Remove all terminals for a specific session and return them
    pub fn remove_session_terminals(&self, session_id: &str) -> Vec<Arc<TerminalState>> {
        let terminal_ids: Vec<String> = self
            .terminals
            .iter()
            .filter(|r| r.session_id == session_id)
            .map(|r| r.terminal_id.clone())
            .collect();

        terminal_ids
            .into_iter()
            .filter_map(|id| self.remove(&id))
            .collect()
    }

    /// Get the number of active terminals
    pub fn len(&self) -> usize {
        self.terminals.len()
    }

    /// Check if registry is empty
    pub fn is_empty(&self) -> bool {
        self.terminals.is_empty()
    }
}

impl Default for TerminalRegistry {
    fn default() -> Self {
        Self::new()
    }
}
