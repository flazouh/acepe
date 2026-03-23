use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::sync::{broadcast, RwLock};

const DEFAULT_EVENT_CHANNEL_CAPACITY: usize = 8192;

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AcpEventEnvelope {
    pub seq: u64,
    pub event_name: String,
    pub session_id: Option<String>,
    pub payload: Value,
    pub priority: String,
    pub droppable: bool,
    pub emitted_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AcpEventBridgeInfo {
    pub events_url: String,
}

pub struct AcpEventHubState {
    sender: broadcast::Sender<AcpEventEnvelope>,
    next_seq: AtomicU64,
    bridge_info: RwLock<Option<AcpEventBridgeInfo>>,
}

impl Default for AcpEventHubState {
    fn default() -> Self {
        Self::new()
    }
}

impl AcpEventHubState {
    #[must_use]
    pub fn new() -> Self {
        Self::with_capacity(DEFAULT_EVENT_CHANNEL_CAPACITY)
    }

    #[must_use]
    pub fn with_capacity(capacity: usize) -> Self {
        let (sender, _) = broadcast::channel(capacity);
        Self {
            sender,
            next_seq: AtomicU64::new(0),
            bridge_info: RwLock::new(None),
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<AcpEventEnvelope> {
        self.sender.subscribe()
    }

    pub fn publish(
        &self,
        event_name: &str,
        session_id: Option<String>,
        payload: Value,
        priority: &str,
        droppable: bool,
    ) {
        let seq = self.next_seq.fetch_add(1, Ordering::Relaxed) + 1;
        let emitted_at_ms = chrono::Utc::now().timestamp_millis().max(0) as u64;
        let envelope = AcpEventEnvelope {
            seq,
            event_name: event_name.to_string(),
            session_id,
            payload,
            priority: priority.to_string(),
            droppable,
            emitted_at_ms,
        };

        if let Err(error) = self.sender.send(envelope) {
            tracing::trace!(%error, "ACP event hub send failed (no active subscribers)");
        }
    }

    pub async fn set_bridge_info(&self, info: AcpEventBridgeInfo) {
        let mut guard = self.bridge_info.write().await;
        *guard = Some(info);
    }

    pub async fn get_bridge_info(&self) -> Option<AcpEventBridgeInfo> {
        self.bridge_info.read().await.clone()
    }
}
