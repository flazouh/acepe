use crate::acp::session_state_engine::SessionGraphCapabilities;
use crate::acp::session_update::SessionUpdate;
use crate::acp::transport::adapter::RetryBackoffHint;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CapabilityFreshness {
    Live,
    Restored,
    Stale,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CapabilityProvenance {
    Preview,
    Handshake,
    Update,
    PersistedRestore,
}

#[derive(Debug, Clone)]
pub struct TransportCapabilitySnapshot {
    pub capabilities: SessionGraphCapabilities,
    pub freshness: CapabilityFreshness,
    pub provenance: CapabilityProvenance,
}

#[derive(Debug, Clone)]
pub struct TransportConnectResponse {
    pub connection_epoch: u64,
    pub capabilities: TransportCapabilitySnapshot,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TransportDisconnect {
    pub connection_epoch: u64,
    pub retry: RetryBackoffHint,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConnectionFailure {
    pub connection_epoch: u64,
    pub retry: RetryBackoffHint,
    pub message: String,
}

#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone)]
pub enum TransportEvent {
    Connected(TransportConnectResponse),
    Disconnected(TransportDisconnect),
    Update(SessionUpdate),
    ConnectionFailed(ConnectionFailure),
}
