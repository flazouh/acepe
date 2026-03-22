use crate::acp::client_trait::AgentClient;
use crate::acp::client_transport::InboundRequestResponder;
use crate::acp::error::{AcpError, AcpResult};
use crate::acp::types::CanonicalAgentId;
use dashmap::DashMap;
use std::sync::Arc;
use tokio::sync::Mutex as TokioMutex;

/// Per-session entry: the client plus the agent that created it.
struct SessionEntry {
    client: Arc<TokioMutex<Box<dyn AgentClient + Send + Sync + 'static>>>,
    agent_id: CanonicalAgentId,
}

/// Thread-safe registry of active session clients.
/// Uses DashMap for concurrent access with per-client Tokio Mutexes for exclusive access.
/// The stored trait objects must be Send + Sync + 'static to meet DashMap's requirements.
pub struct SessionRegistry {
    sessions: DashMap<String, SessionEntry>,
    pending_inbound_responders: DashMap<String, Arc<InboundRequestResponder>>,
}

impl SessionRegistry {
    pub fn new() -> Self {
        Self {
            sessions: DashMap::new(),
            pending_inbound_responders: DashMap::new(),
        }
    }

    /// Store a client for a session. Returns the replaced client if one existed.
    pub fn store(
        &self,
        session_id: String,
        client: Box<dyn AgentClient + Send + Sync + 'static>,
        agent_id: CanonicalAgentId,
    ) -> Option<Arc<TokioMutex<Box<dyn AgentClient + Send + Sync + 'static>>>> {
        let client_arc = Arc::new(TokioMutex::new(client));
        self.pending_inbound_responders.remove(&session_id);

        let entry = SessionEntry {
            client: client_arc,
            agent_id: agent_id.clone(),
        };

        // Check for existing entry and log appropriately
        let redacted_id = redact_session_id(&session_id);
        if let Some((_, old_entry)) = self.sessions.remove(&session_id) {
            tracing::warn!(
                session_id = %redacted_id,
                old_agent_id = %old_entry.agent_id.as_str(),
                new_agent_id = %agent_id.as_str(),
                "Replacing existing session client"
            );
            self.sessions.insert(session_id, entry);
            Some(old_entry.client)
        } else {
            tracing::info!(
                session_id = %redacted_id,
                agent_id = %agent_id.as_str(),
                "Session client stored"
            );
            self.sessions.insert(session_id, entry);
            None
        }
    }

    /// Get a client by session ID.
    pub fn get(
        &self,
        session_id: &str,
    ) -> AcpResult<Arc<TokioMutex<Box<dyn AgentClient + Send + Sync + 'static>>>> {
        self.sessions
            .get(session_id)
            .map(|r| Arc::clone(&r.client))
            .ok_or_else(|| AcpError::SessionNotFound(redact_session_id(session_id)))
    }

    /// Get the agent ID for a session, if known.
    pub fn get_agent_id(&self, session_id: &str) -> Option<CanonicalAgentId> {
        self.sessions.get(session_id).map(|r| r.agent_id.clone())
    }

    /// Remove a client by session ID. Returns the removed client if found.
    pub fn remove(
        &self,
        session_id: &str,
        reason: &'static str,
    ) -> Option<Arc<TokioMutex<Box<dyn AgentClient + Send + Sync + 'static>>>> {
        self.pending_inbound_responders.remove(session_id);
        let result = self.sessions.remove(session_id);
        if let Some((_, entry)) = &result {
            let redacted_id = redact_session_id(session_id);
            tracing::info!(
                session_id = %redacted_id,
                agent_id = %entry.agent_id.as_str(),
                reason,
                "Session client removed"
            );
        }
        result.map(|(_, entry)| entry.client)
    }

    /// Check if a session exists.
    pub fn contains(&self, session_id: &str) -> bool {
        self.sessions.contains_key(session_id)
    }

    /// Get the number of active sessions.
    pub fn len(&self) -> usize {
        self.sessions.len()
    }

    /// Check if registry is empty.
    pub fn is_empty(&self) -> bool {
        self.sessions.is_empty()
    }

    pub(crate) fn store_pending_inbound_responder(
        &self,
        session_id: String,
        responder: Arc<InboundRequestResponder>,
    ) {
        if self.sessions.contains_key(&session_id) {
            return;
        }

        let redacted_id = redact_session_id(&session_id);
        match self.pending_inbound_responders.entry(session_id) {
            dashmap::mapref::entry::Entry::Occupied(_) => {}
            dashmap::mapref::entry::Entry::Vacant(entry) => {
                tracing::info!(session_id = %redacted_id, "Stored pending inbound responder");
                entry.insert(responder);
            }
        }
    }

    pub(crate) fn get_pending_inbound_responder(
        &self,
        session_id: &str,
    ) -> Option<Arc<InboundRequestResponder>> {
        self.pending_inbound_responders
            .get(session_id)
            .map(|entry| Arc::clone(entry.value()))
    }

    /// Stop all active session clients and clear the registry.
    ///
    /// This is called during app shutdown to ensure all subprocess trees are killed.
    /// Uses `try_lock` to avoid blocking if a client is in use.
    pub fn stop_all(&self) {
        let count = self.sessions.len();
        if count == 0 {
            self.pending_inbound_responders.clear();
            return;
        }
        tracing::info!(count = count, "Stopping all session clients on shutdown");

        // Drain all entries from the DashMap
        let entries: Vec<_> = self
            .sessions
            .iter()
            .map(|entry| entry.key().clone())
            .collect();

        for session_id in entries {
            if let Some((_, entry)) = self.sessions.remove(&session_id) {
                // try_lock to avoid deadlock during shutdown
                match entry.client.try_lock() {
                    Ok(mut client) => {
                        tracing::warn!(
                            session_id = %redact_session_id(&session_id),
                            agent_id = %entry.agent_id.as_str(),
                            reason = "session_registry.stop_all",
                            "Stopping session client during registry shutdown"
                        );
                        client.stop();
                        tracing::info!(session_id = %redact_session_id(&session_id), "Session client stopped");
                    }
                    Err(_) => {
                        // Client is locked (in use) — drop the Arc which will
                        // trigger Drop on AcpClient when all references are released
                        tracing::warn!(
                            session_id = %redact_session_id(&session_id),
                            "Could not lock client for shutdown, will be cleaned up on drop"
                        );
                    }
                }
            }
        }
        self.pending_inbound_responders.clear();
    }
}

impl Drop for SessionRegistry {
    fn drop(&mut self) {
        self.stop_all();
    }
}

impl Default for SessionRegistry {
    fn default() -> Self {
        Self::new()
    }
}

/// Redact session ID for safe logging (show only first 8 chars and last 4 chars).
pub(crate) fn redact_session_id(session_id: &str) -> String {
    if session_id.len() <= 12 {
        // For short IDs, just show first 4 chars
        format!("{}***", &session_id[..session_id.len().min(4)])
    } else {
        format!(
            "{}...{}",
            &session_id[..8],
            &session_id[session_id.len() - 4..]
        )
    }
}
