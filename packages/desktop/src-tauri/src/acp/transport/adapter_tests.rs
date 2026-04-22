use async_trait::async_trait;
use futures::stream;
use serde_json::json;
use tokio::sync::mpsc;

use crate::acp::error::AcpResult;
use crate::acp::session_state_engine::SessionGraphCapabilities;
use crate::acp::session_update::{SessionUpdate, UsageTelemetryData, UsageTelemetryTokens};
use crate::acp::transport::{
    CapabilityFreshness, CapabilityProvenance, ConnectRequest, ConnectionFailure, ForkRequest,
    PreviewAdapter, PreviewRequest, ResumePolicy, ResumeRequest, RetryBackoffHint,
    RetryDisposition, TransportAdapter, TransportCapabilitySnapshot, TransportCommand,
    TransportCommandSink, TransportConnectResponse, TransportConnection, TransportDisconnect,
    TransportEvent,
};
use crate::acp::types::{ContentBlock, PromptRequest};

struct MockTransportAdapter {
    policy: ResumePolicy,
}

fn capability_snapshot(
    freshness: CapabilityFreshness,
    provenance: CapabilityProvenance,
) -> TransportCapabilitySnapshot {
    TransportCapabilitySnapshot {
        capabilities: SessionGraphCapabilities::empty(),
        freshness,
        provenance,
    }
}

fn mock_connection() -> (
    TransportConnection,
    mpsc::UnboundedReceiver<TransportCommand>,
) {
    let (command_tx, command_rx) = mpsc::unbounded_channel();
    let events = stream::iter(vec![
        TransportEvent::Connected(TransportConnectResponse {
            connection_epoch: 7,
            capabilities: capability_snapshot(
                CapabilityFreshness::Live,
                CapabilityProvenance::Handshake,
            ),
        }),
        TransportEvent::ConnectionFailed(ConnectionFailure {
            connection_epoch: 7,
            retry: RetryBackoffHint::retryable(Some(250), Some(1_000)),
            message: "network".to_string(),
        }),
    ]);
    (
        TransportConnection::new(TransportCommandSink::new(command_tx), Box::pin(events)),
        command_rx,
    )
}

#[async_trait]
impl TransportAdapter for MockTransportAdapter {
    async fn connect(&self, _request: ConnectRequest) -> AcpResult<TransportConnection> {
        Ok(mock_connection().0)
    }

    async fn resume(&self, _request: ResumeRequest) -> AcpResult<TransportConnection> {
        Ok(mock_connection().0)
    }

    fn resume_policy(&self) -> ResumePolicy {
        self.policy.clone()
    }

    async fn fork(&self, _request: ForkRequest) -> AcpResult<TransportCapabilitySnapshot> {
        Ok(capability_snapshot(
            CapabilityFreshness::Restored,
            CapabilityProvenance::PersistedRestore,
        ))
    }
}

#[async_trait]
impl PreviewAdapter for MockTransportAdapter {
    async fn preview_capabilities(
        &self,
        _request: PreviewRequest,
    ) -> AcpResult<TransportCapabilitySnapshot> {
        Ok(capability_snapshot(
            CapabilityFreshness::Stale,
            CapabilityProvenance::Preview,
        ))
    }
}

fn describe_retry(event: &TransportEvent) -> Option<&'static str> {
    match event {
        TransportEvent::ConnectionFailed(failure) => Some(match failure.retry.disposition {
            RetryDisposition::Retryable => "retryable",
            RetryDisposition::Terminal => "terminal",
        }),
        TransportEvent::Disconnected(disconnect) => Some(match disconnect.retry.disposition {
            RetryDisposition::Retryable => "retryable",
            RetryDisposition::Terminal => "terminal",
        }),
        TransportEvent::Connected(_) | TransportEvent::Update(_) => None,
    }
}

fn resume_operation_name(policy: &ResumePolicy) -> &'static str {
    if policy.use_load_semantics {
        "load"
    } else {
        "resume"
    }
}

#[tokio::test]
async fn mock_adapter_is_object_safe_behind_dyn_transport_adapter() {
    let adapter: Box<dyn TransportAdapter> = Box::new(MockTransportAdapter {
        policy: ResumePolicy::default(),
    });

    let mut connection = adapter
        .connect(ConnectRequest {
            session_id: "session-1".to_string(),
            cwd: "/tmp/project".to_string(),
            initial_prompt: None,
            launch_mode_id: None,
        })
        .await
        .expect("connect");

    assert!(matches!(
        connection.next_event().await.expect("connected event"),
        TransportEvent::Connected(_)
    ));
}

#[tokio::test]
async fn transport_connection_exposes_command_sink_and_event_stream() {
    let (mut connection, mut command_rx) = mock_connection();
    connection
        .command_sink()
        .send_prompt(PromptRequest {
            session_id: "session-1".to_string(),
            prompt: vec![ContentBlock::Text {
                text: "hello".to_string(),
            }],
            stream: Some(true),
        })
        .expect("send prompt");

    match command_rx.recv().await.expect("queued command") {
        TransportCommand::SendPrompt { request } => {
            assert_eq!(request.session_id, "session-1");
            assert_eq!(request.prompt.len(), 1);
        }
        other => panic!("expected send prompt command, got {other:?}"),
    }

    assert!(matches!(
        connection.next_event().await.expect("connected event"),
        TransportEvent::Connected(_)
    ));
}

#[test]
fn connection_failed_is_generic_retry_signal() {
    let event = TransportEvent::ConnectionFailed(ConnectionFailure {
        connection_epoch: 9,
        retry: RetryBackoffHint::retryable(Some(500), Some(2_000)),
        message: "broken pipe".to_string(),
    });

    assert_eq!(describe_retry(&event), Some("retryable"));
}

#[test]
fn resume_policy_is_provider_owned_without_provider_branching() {
    let policy = ResumePolicy {
        use_load_semantics: true,
        retry: RetryBackoffHint::terminal(),
    };

    assert_eq!(resume_operation_name(&policy), "load");
}

#[test]
fn capability_snapshots_capture_freshness_and_provenance() {
    let snapshot = capability_snapshot(CapabilityFreshness::Stale, CapabilityProvenance::Preview);

    assert!(snapshot.capabilities.available_commands.is_empty());
    assert_eq!(snapshot.freshness, CapabilityFreshness::Stale);
    assert_eq!(snapshot.provenance, CapabilityProvenance::Preview);
}

#[test]
fn transport_events_do_not_encode_canonical_lifecycle_states() {
    let events = vec![
        TransportEvent::Connected(TransportConnectResponse {
            connection_epoch: 1,
            capabilities: capability_snapshot(
                CapabilityFreshness::Live,
                CapabilityProvenance::Handshake,
            ),
        }),
        TransportEvent::Disconnected(TransportDisconnect {
            connection_epoch: 1,
            retry: RetryBackoffHint::retryable(Some(100), Some(500)),
        }),
        TransportEvent::Update(SessionUpdate::UsageTelemetryUpdate {
            data: UsageTelemetryData {
                session_id: "session-1".to_string(),
                event_id: None,
                scope: "step".to_string(),
                cost_usd: Some(0.01),
                tokens: UsageTelemetryTokens {
                    input: Some(1),
                    output: Some(2),
                    ..UsageTelemetryTokens::default()
                },
                source_model_id: None,
                timestamp_ms: None,
                context_window_size: None,
            },
        }),
        TransportEvent::ConnectionFailed(ConnectionFailure {
            connection_epoch: 1,
            retry: RetryBackoffHint::terminal(),
            message: "fatal".to_string(),
        }),
    ];

    let labels = events
        .into_iter()
        .map(|event| match event {
            TransportEvent::Connected(_) => "connected",
            TransportEvent::Disconnected(_) => "disconnected",
            TransportEvent::Update(_) => "update",
            TransportEvent::ConnectionFailed(_) => "connection_failed",
        })
        .collect::<Vec<_>>();
    assert_eq!(
        labels,
        vec!["connected", "disconnected", "update", "connection_failed"]
    );
}

#[tokio::test]
async fn preview_adapter_returns_capability_snapshot() {
    let adapter = MockTransportAdapter {
        policy: ResumePolicy::default(),
    };

    let snapshot = adapter
        .preview_capabilities(PreviewRequest {
            cwd: "/tmp/project".to_string(),
        })
        .await
        .expect("preview");

    assert_eq!(snapshot.freshness, CapabilityFreshness::Stale);
    assert_eq!(snapshot.provenance, CapabilityProvenance::Preview);
    assert_eq!(json!(snapshot.capabilities.available_commands), json!([]));
}
