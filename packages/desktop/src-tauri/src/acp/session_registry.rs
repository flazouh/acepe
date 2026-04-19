use crate::acp::client_trait::AgentClient;
use crate::acp::client_transport::InboundRequestResponder;
use crate::acp::error::{AcpError, AcpResult};
use crate::acp::types::CanonicalAgentId;
use dashmap::DashMap;
use sea_orm::DbConn;
use std::sync::Arc;
use tauri::{AppHandle, Manager};
use tokio::sync::Mutex as TokioMutex;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LiveSessionDescriptor {
    pub agent_id: CanonicalAgentId,
    pub provider_session_id: Option<String>,
}

impl LiveSessionDescriptor {
    pub fn new(agent_id: CanonicalAgentId, provider_session_id: Option<String>) -> Self {
        Self {
            agent_id,
            provider_session_id,
        }
    }
}

/// Per-session entry: the client plus the live descriptor facts bound to it.
struct SessionEntry {
    client: Arc<TokioMutex<Box<dyn AgentClient + Send + Sync + 'static>>>,
    descriptor: LiveSessionDescriptor,
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
        self.store_descriptor(
            session_id,
            client,
            LiveSessionDescriptor::new(agent_id, None),
        )
    }

    pub fn store_descriptor(
        &self,
        session_id: String,
        client: Box<dyn AgentClient + Send + Sync + 'static>,
        descriptor: LiveSessionDescriptor,
    ) -> Option<Arc<TokioMutex<Box<dyn AgentClient + Send + Sync + 'static>>>> {
        let client_arc = Arc::new(TokioMutex::new(client));
        self.pending_inbound_responders.remove(&session_id);

        let entry = SessionEntry {
            client: client_arc,
            descriptor: descriptor.clone(),
        };

        // Check for existing entry and log appropriately
        let redacted_id = redact_session_id(&session_id);
        if let Some((_, old_entry)) = self.sessions.remove(&session_id) {
            tracing::warn!(
                session_id = %redacted_id,
                old_agent_id = %old_entry.descriptor.agent_id.as_str(),
                new_agent_id = %descriptor.agent_id.as_str(),
                "Replacing existing session client"
            );
            self.sessions.insert(session_id, entry);
            Some(old_entry.client)
        } else {
            tracing::info!(
                session_id = %redacted_id,
                agent_id = %descriptor.agent_id.as_str(),
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
        self.sessions
            .get(session_id)
            .map(|r| r.descriptor.agent_id.clone())
    }

    pub fn get_descriptor(&self, session_id: &str) -> Option<LiveSessionDescriptor> {
        self.sessions.get(session_id).map(|r| r.descriptor.clone())
    }

    pub fn bind_provider_session_id(
        &self,
        session_id: &str,
        provider_session_id: &str,
    ) -> AcpResult<()> {
        let Some(mut entry) = self.sessions.get_mut(session_id) else {
            return Err(AcpError::SessionNotFound(redact_session_id(session_id)));
        };

        let normalized_provider_session_id = if provider_session_id == session_id {
            None
        } else {
            Some(provider_session_id.to_string())
        };

        if entry.descriptor.provider_session_id == normalized_provider_session_id {
            return Ok(());
        }

        if let Some(existing_provider_session_id) = entry.descriptor.provider_session_id.as_ref() {
            return Err(AcpError::InvalidState(format!(
                "conflicting provider session binding for {}: existing={}, new={}",
                redact_session_id(session_id),
                existing_provider_session_id,
                provider_session_id
            )));
        }

        entry.descriptor.provider_session_id = normalized_provider_session_id;
        Ok(())
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
                agent_id = %entry.descriptor.agent_id.as_str(),
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
                            agent_id = %entry.descriptor.agent_id.as_str(),
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

pub async fn bind_provider_session_id_persisted(
    app_handle: Option<&AppHandle>,
    db: Option<&DbConn>,
    session_id: &str,
    provider_session_id: &str,
) -> AcpResult<()> {
    if let Some(session_registry) = app_handle.and_then(|app_handle| {
        app_handle
            .try_state::<SessionRegistry>()
            .map(|state| state.inner())
    }) {
        session_registry.bind_provider_session_id(session_id, provider_session_id)?;
    }

    if let Some(db) = db {
        crate::db::repository::SessionMetadataRepository::set_provider_session_id(
            db,
            session_id,
            provider_session_id,
        )
        .await
        .map_err(|error| {
            AcpError::InvalidState(format!(
                "failed to persist provider session binding for {}: {}",
                redact_session_id(session_id),
                error
            ))
        })?;
    }

    Ok(())
}

#[allow(clippy::items_after_test_module)]
#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::client::{
        InitializeResponse, ListSessionsResponse, NewSessionResponse, ResumeSessionResponse,
    };
    use crate::acp::client_trait::AgentClient;
    use crate::acp::error::AcpResult;
    use crate::acp::types::PromptRequest;
    use async_trait::async_trait;
    use serde_json::Value;

    struct NoopClient;

    #[async_trait]
    impl AgentClient for NoopClient {
        async fn start(&mut self) -> AcpResult<()> {
            Ok(())
        }

        async fn initialize(&mut self) -> AcpResult<InitializeResponse> {
            Ok(InitializeResponse {
                protocol_version: 1,
                agent_capabilities: serde_json::json!({}),
                agent_info: serde_json::json!({}),
                auth_methods: vec![],
            })
        }

        async fn new_session(&mut self, _cwd: String) -> AcpResult<NewSessionResponse> {
            unreachable!()
        }

        async fn resume_session(
            &mut self,
            _session_id: String,
            _cwd: String,
        ) -> AcpResult<ResumeSessionResponse> {
            unreachable!()
        }

        async fn reconnect_session(
            &mut self,
            _session_id: String,
            _cwd: String,
            _launch_mode_id: Option<String>,
        ) -> AcpResult<ResumeSessionResponse> {
            unreachable!()
        }

        async fn fork_session(
            &mut self,
            _session_id: String,
            _cwd: String,
        ) -> AcpResult<NewSessionResponse> {
            unreachable!()
        }

        async fn set_session_model(
            &mut self,
            _session_id: String,
            _model_id: String,
        ) -> AcpResult<()> {
            Ok(())
        }

        async fn set_session_mode(
            &mut self,
            _session_id: String,
            _mode_id: String,
        ) -> AcpResult<()> {
            Ok(())
        }

        async fn send_prompt(&mut self, _request: PromptRequest) -> AcpResult<Value> {
            Ok(serde_json::json!({}))
        }

        async fn cancel(&mut self, _session_id: String) -> AcpResult<()> {
            Ok(())
        }

        async fn list_sessions(&mut self, _cwd: Option<String>) -> AcpResult<ListSessionsResponse> {
            Ok(ListSessionsResponse {
                sessions: vec![],
                next_cursor: None,
            })
        }

        fn stop(&mut self) {}
    }

    #[test]
    fn bind_provider_session_id_updates_live_descriptor() {
        let registry = SessionRegistry::new();
        registry.store_descriptor(
            "session-1".to_string(),
            Box::new(NoopClient),
            LiveSessionDescriptor::new(CanonicalAgentId::ClaudeCode, None),
        );

        registry
            .bind_provider_session_id("session-1", "provider-1")
            .expect("binding should succeed");

        assert_eq!(
            registry
                .get_descriptor("session-1")
                .expect("descriptor")
                .provider_session_id
                .as_deref(),
            Some("provider-1")
        );
    }

    #[test]
    fn bind_provider_session_id_rejects_conflicts() {
        let registry = SessionRegistry::new();
        registry.store_descriptor(
            "session-1".to_string(),
            Box::new(NoopClient),
            LiveSessionDescriptor::new(
                CanonicalAgentId::ClaudeCode,
                Some("provider-1".to_string()),
            ),
        );

        let error = registry
            .bind_provider_session_id("session-1", "provider-2")
            .expect_err("conflict should fail");

        assert!(matches!(error, AcpError::InvalidState(_)));
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
