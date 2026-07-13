//! Live ingress — normalize raw ACP JSON into ordered `ProviderEvent`s.

use serde_json::Value;

use crate::acp::parsers::AgentType;
use crate::acp::parsers::ParseError;
use crate::acp::projections::RouteDecision;
use crate::acp::session::ingress::event::ProviderEvent;
use crate::acp::session::ingress::live_session_update::session_update_to_provider_event;
use crate::acp::session::ingress::source::LiveSource;
use crate::acp::session_update::parse_session_update_with_agent;
use crate::acp::types::CanonicalAgentId;

/// Default live ingress for ACP session-update JSON lines.
#[derive(Debug, Clone)]
pub struct AcpLiveSource {
    pub agent_type: AgentType,
    pub canonical_agent_id: CanonicalAgentId,
}

impl AcpLiveSource {
    #[must_use]
    pub const fn new(agent_type: AgentType, canonical_agent_id: CanonicalAgentId) -> Self {
        Self {
            agent_type,
            canonical_agent_id,
        }
    }
}

impl LiveSource for AcpLiveSource {
    fn agent_id(&self) -> CanonicalAgentId {
        self.canonical_agent_id.clone()
    }

    fn normalize(&self, raw: &Value) -> Result<Vec<ProviderEvent>, ParseError> {
        let update = parse_session_update_with_agent::<serde_json::Error>(raw, self.agent_type)
            .map_err(|error| ParseError::InvalidFormat(error.to_string()))?;
        let event = session_update_to_provider_event(
            self.canonical_agent_id.clone(),
            1,
            &update,
            RouteDecision::default(),
        );
        Ok(event.into_iter().collect())
    }
}
