use crate::acp::types::CanonicalAgentId;
use std::sync::RwLock;

/// Thread-safe storage for the currently active agent preference.
pub struct ActiveAgent {
    inner: RwLock<Option<CanonicalAgentId>>,
}

impl ActiveAgent {
    pub fn new() -> Self {
        Self {
            inner: RwLock::new(None),
        }
    }

    pub fn get(&self) -> Option<CanonicalAgentId> {
        match self.inner.read() {
            Ok(current) => current.clone(),
            Err(error) => {
                tracing::error!(%error, "ActiveAgent lock poisoned while reading");
                None
            }
        }
    }

    pub fn set(&self, agent_id: CanonicalAgentId) {
        match self.inner.write() {
            Ok(mut current) => *current = Some(agent_id),
            Err(error) => tracing::error!(%error, "ActiveAgent lock poisoned while writing"),
        }
    }

    pub fn clear(&self) {
        match self.inner.write() {
            Ok(mut current) => *current = None,
            Err(error) => tracing::error!(%error, "ActiveAgent lock poisoned while clearing"),
        }
    }
}

impl Default for ActiveAgent {
    fn default() -> Self {
        Self::new()
    }
}
