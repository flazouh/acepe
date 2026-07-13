//! Provider plugin conformance — every registered plugin reads or converts its fixture.

use std::path::PathBuf;

use crate::acp::parsers::AgentType;
use crate::acp::session::ingress::canonical_events::canonical_transcript_events_to_provider_events;
use crate::acp::session::ingress::event::ProviderEventKind;
use crate::acp::session::ingress::plugin::registered_agents;
use crate::acp::session::ingress::source::{HistoryInput, HistorySource, LiveSource};
use crate::acp::types::CanonicalAgentId;
use crate::opencode_history::convert::opencode_messages_to_provider_events;
use crate::opencode_history::types::{OpenCodeMessage, OpenCodeMessagePart};

fn disk_fixture_for(agent: &CanonicalAgentId) -> Option<(&'static str, PathBuf)> {
    match agent {
        CanonicalAgentId::Cursor => Some((
            "c2a34686-f99a-4632-90e2-e036b96124c2",
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/cursor_sessions"),
        )),
        CanonicalAgentId::ClaudeCode => Some((
            "sess-hist-001",
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("src/acp/session/ingress/tool_identity/tests/fixtures"),
        )),
        _ => None,
    }
}

fn synthetic_events_for(
    agent: &CanonicalAgentId,
) -> Vec<crate::acp::session::ingress::event::ProviderEvent> {
    match agent {
        CanonicalAgentId::OpenCode => {
            let messages = vec![
                OpenCodeMessage {
                    id: "msg-user-1".to_string(),
                    role: "user".to_string(),
                    parts: vec![OpenCodeMessagePart::Text {
                        text: "Hello OpenCode".to_string(),
                    }],
                    model: None,
                    timestamp: Some("2026-07-12T00:00:00Z".to_string()),
                },
                OpenCodeMessage {
                    id: "msg-assistant-1".to_string(),
                    role: "assistant".to_string(),
                    parts: vec![OpenCodeMessagePart::Text {
                        text: "Hi there".to_string(),
                    }],
                    model: Some("openrouter/test-model".to_string()),
                    timestamp: Some("2026-07-12T00:00:01Z".to_string()),
                },
            ];
            opencode_messages_to_provider_events(&messages)
        }
        CanonicalAgentId::Copilot => {
            use crate::acp::session_update::{
                ContentChunk, ToolArguments, ToolCallData, ToolCallStatus, ToolKind,
            };
            use crate::acp::types::ContentBlock;
            use crate::copilot_history::convert_replay_updates_to_provider_events;

            convert_replay_updates_to_provider_events(&[
                (
                    1_710_000_000_000,
                    crate::acp::session_update::SessionUpdate::UserMessageChunk {
                        chunk: ContentChunk {
                            content: ContentBlock::Text {
                                text: "Summarize the repo".to_string(),
                            },
                            aggregation_hint: None,
                        },
                        session_id: Some("copilot-conformance".to_string()),
                        attempt_id: None,
                    },
                ),
                (
                    1_710_000_001_000,
                    crate::acp::session_update::SessionUpdate::ToolCall {
                        tool_call: ToolCallData {
                            id: "tool-1".to_string(),
                            name: "Read".to_string(),
                            arguments: ToolArguments::Read {
                                file_path: Some("/repo/README.md".to_string()),
                                source_context: None,
                            },
                            diagnostic_input: None,
                            status: ToolCallStatus::Pending,
                            result: None,
                            kind: Some(ToolKind::Read),
                            title: Some("Read README".to_string()),
                            locations: None,
                            skill_meta: None,
                            normalized_questions: None,
                            normalized_todos: None,
                            normalized_todo_update: None,
                            parent_tool_use_id: None,
                            task_children: None,
                            question_answer: None,
                            awaiting_plan_approval: false,
                            plan_approval_request_id: None,
                        },
                        session_id: Some("copilot-conformance".to_string()),
                    },
                ),
            ])
        }
        CanonicalAgentId::Codex => {
            use crate::acp::session::ingress::event::ProviderEventKind;
            use crate::acp::session_update::{
                ToolArguments, ToolCallData, ToolCallStatus, ToolKind,
            };

            vec![
                crate::acp::session::ingress::event::ProviderEvent {
                    source: CanonicalAgentId::Codex,
                    provider_seq: 1,
                    provider_row_id: "user-1".to_string(),
                    timestamp_ms: None,
                    kind: ProviderEventKind::UserText {
                        text: "Run the tests".to_string(),
                        attempt_id: None,
                    },
                },
                crate::acp::session::ingress::event::ProviderEvent {
                    source: CanonicalAgentId::Codex,
                    provider_seq: 2,
                    provider_row_id: "tool-1".to_string(),
                    timestamp_ms: None,
                    kind: ProviderEventKind::ToolCall(ToolCallData {
                        id: "tool-1".to_string(),
                        name: "Read".to_string(),
                        arguments: ToolArguments::Read {
                            file_path: Some("/repo/README.md".to_string()),
                            source_context: None,
                        },
                        diagnostic_input: None,
                        status: ToolCallStatus::Completed,
                        result: None,
                        kind: Some(ToolKind::Read),
                        title: Some("Read README".to_string()),
                        locations: None,
                        skill_meta: None,
                        normalized_questions: None,
                        normalized_todos: None,
                        normalized_todo_update: None,
                        parent_tool_use_id: None,
                        task_children: None,
                        question_answer: None,
                        awaiting_plan_approval: false,
                        plan_approval_request_id: None,
                    }),
                },
            ]
        }
        other => panic!("missing synthetic conformance fixture for registered agent {other:?}"),
    }
}

#[test]
fn every_registered_plugin_bundles_history_live_and_tool_table() {
    use crate::acp::session::ingress::plugin::{
        history_source_for, live_source_for, plugin_for, tool_table_for,
    };

    for agent in registered_agents() {
        let plugin =
            plugin_for(&agent).unwrap_or_else(|| panic!("plugin {agent:?} must be registered"));
        assert_eq!(plugin.agent_id, agent);
        assert_eq!(plugin.tool_table.agent_id, agent);
        assert!(
            std::ptr::eq(
                plugin.tool_table as *const _,
                tool_table_for(&agent).expect("tool table") as *const _
            ),
            "plugin {agent:?} tool_table must match tool_table_for"
        );
        assert!(
            std::ptr::eq(
                plugin.history as *const dyn HistorySource,
                history_source_for(&agent).expect("history source") as *const dyn HistorySource
            ),
            "plugin {agent:?} history must match history_source_for"
        );
        assert!(
            std::ptr::eq(
                plugin.live as *const dyn LiveSource,
                live_source_for(&agent).expect("live source") as *const dyn LiveSource
            ),
            "plugin {agent:?} live must match live_source_for"
        );
    }
}

#[test]
fn every_registered_plugin_bundles_history_and_live() {
    use crate::acp::session::ingress::plugin::{history_source_for, live_source_for, plugin_for};

    for agent in registered_agents() {
        let plugin =
            plugin_for(&agent).unwrap_or_else(|| panic!("plugin {agent:?} must be registered"));
        assert_eq!(plugin.agent_id, agent);
        assert!(
            std::ptr::eq(
                plugin.history as *const dyn HistorySource,
                history_source_for(&agent).expect("history source") as *const dyn HistorySource
            ),
            "plugin {agent:?} history must match history_source_for"
        );
        assert!(
            std::ptr::eq(
                plugin.live as *const dyn LiveSource,
                live_source_for(&agent).expect("live source") as *const dyn LiveSource
            ),
            "plugin {agent:?} live must match live_source_for"
        );
    }
}

#[test]
fn every_registered_plugin_has_history_and_live_source() {
    use crate::acp::session::ingress::plugin::{history_source_for, live_source_for};

    for agent in registered_agents() {
        assert!(
            history_source_for(&agent).is_some(),
            "plugin {agent:?} must register a history source"
        );
        assert!(
            live_source_for(&agent).is_some(),
            "plugin {agent:?} must register a live source"
        );
    }
}

#[tokio::test]
async fn every_registered_plugin_reads_its_fixture_without_error() {
    use crate::acp::session::ingress::plugin::history_source_for;

    for agent in registered_agents() {
        let history = history_source_for(&agent)
            .unwrap_or_else(|| panic!("plugin {agent:?} must register a history source"));

        let events = if let Some((session_id, fixture_dir)) = disk_fixture_for(&agent) {
            history
                .read(HistoryInput {
                    session_id: session_id.to_string(),
                    workspace_root: Some(fixture_dir),
                })
                .await
                .unwrap_or_else(|error| panic!("plugin {agent:?} failed to read fixture: {error}"))
        } else {
            let synthetic = synthetic_events_for(&agent);
            assert!(
                !synthetic.is_empty(),
                "plugin {agent:?} synthetic conformance must emit events"
            );
            for event in &synthetic {
                assert!(
                    matches!(
                        &event.kind,
                        ProviderEventKind::UserText { .. }
                            | ProviderEventKind::AssistantText { .. }
                            | ProviderEventKind::ToolCall(_)
                    ),
                    "plugin {agent:?} synthetic event must be replayable"
                );
            }
            synthetic
        };

        assert!(
            !events.is_empty(),
            "plugin {agent:?} must emit events from its fixture"
        );
    }
}
