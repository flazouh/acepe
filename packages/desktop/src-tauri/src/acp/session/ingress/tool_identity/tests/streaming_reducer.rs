//! Streaming normalization and lifecycle characterization (Plan 012 U1).
//!
//! **Semantic pins** — streamed classification uses the same path as non-streamed.
//! **Lifecycle pins** — caller-owned steps today (to be absorbed by `StreamingStateRegistry` in U2):
//! | Pin | Lifecycle step |
//! |-----|----------------|
//! | `lifecycle_seed_delta_terminal_clears_tool_state` | seed → delta → terminal cleanup |
//! | `lifecycle_cross_session_same_tool_call_id_isolated` | cross-session isolation |
//! | `lifecycle_plan_detect_accumulate_finalize_round_trip` | plan detect → accumulate → finalize |
//! | `lifecycle_concurrent_delta_and_terminal_does_not_deadlock` | drop-before-cleanup under concurrency |

use crate::acp::agent_context::with_agent;
use crate::acp::parsers::{get_parser, AgentType};
use crate::acp::session::ingress::tool_identity::{
    providers, semantic_transition, RawClassificationInput,
};
use crate::acp::session_update::ToolKind;
use crate::acp::session_update::{
    build_tool_call_update_from_raw, RawToolCallUpdateInput, ToolArguments, ToolCallStatus,
};
use crate::acp::streaming_accumulator::{
    has_plan_streaming, has_tool_state, reset_streaming_state_for_test, seed_tool_name,
};

fn unique_session(prefix: &str) -> String {
    format!(
        "{prefix}-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    )
}

#[test]
fn semantic_transition_matches_provider_classify_for_streaming_shape() {
    let raw = RawClassificationInput {
        id: "t1",
        name: Some("unknown"),
        title: Some("unknown"),
        kind_hint: Some("other"),
        arguments: &serde_json::json!({
            "description": "Mark all done",
            "query": "UPDATE todos SET status = 'done'"
        }),
    };
    let direct = providers::classify(AgentType::Copilot, &raw);
    let transition = semantic_transition(AgentType::Copilot, &raw);

    assert_eq!(direct.kind, transition.record.kind);
    assert_eq!(direct.arguments, transition.projected_arguments);
    assert_eq!(transition.record.kind, ToolKind::Todo);
    assert!(matches!(
        transition.projected_arguments,
        ToolArguments::Think { raw: Some(_), .. }
    ));
}

/// Pin: seed_tool_name → streaming delta → terminal status clears per-tool state.
#[test]
fn lifecycle_seed_delta_terminal_clears_tool_state() {
    with_agent(AgentType::ClaudeCode, || {
        let _streaming_test_guard = reset_streaming_state_for_test();
        let session_id = unique_session("lifecycle-seed-delta-terminal");
        let tool_call_id = "lifecycle-tool-1";
        let parser = get_parser(AgentType::ClaudeCode);

        seed_tool_name(&session_id, tool_call_id, "Read", AgentType::ClaudeCode);

        let _ = build_tool_call_update_from_raw(
            parser,
            RawToolCallUpdateInput {
                id: tool_call_id.to_string(),
                status: Some(ToolCallStatus::InProgress),
                result: None,
                raw_output: None,
                content: None,
                title: None,
                locations: None,
                streaming_input_delta: Some(r#"{"file_path": "/tmp/pinned.rs"}"#.to_string()),
                tool_name: None,
                raw_input: None,
                kind: None,
            },
            Some(&session_id),
        );
        assert!(
            has_tool_state(&session_id, tool_call_id),
            "delta should seed per-tool streaming state"
        );

        let terminal = build_tool_call_update_from_raw(
            parser,
            RawToolCallUpdateInput {
                id: tool_call_id.to_string(),
                status: Some(ToolCallStatus::Completed),
                result: None,
                raw_output: None,
                content: None,
                title: None,
                locations: None,
                streaming_input_delta: None,
                tool_name: None,
                raw_input: None,
                kind: None,
            },
            Some(&session_id),
        );
        assert!(
            !has_tool_state(&session_id, tool_call_id),
            "terminal update must clear per-tool state (finalize_tool pin)"
        );
        assert!(
            terminal.streaming_arguments.is_none(),
            "terminal update without delta should not emit streaming arguments"
        );
    });
}

/// Pin: two sessions sharing a tool-call id keep independent streaming state.
#[test]
fn lifecycle_cross_session_same_tool_call_id_isolated() {
    with_agent(AgentType::ClaudeCode, || {
        let _streaming_test_guard = reset_streaming_state_for_test();
        let session_a = unique_session("lifecycle-cross-a");
        let session_b = unique_session("lifecycle-cross-b");
        let tool_call_id = "shared-tool-call-id";
        let parser = get_parser(AgentType::ClaudeCode);

        seed_tool_name(&session_a, tool_call_id, "Read", AgentType::ClaudeCode);
        seed_tool_name(&session_b, tool_call_id, "Write", AgentType::ClaudeCode);

        std::thread::sleep(std::time::Duration::from_millis(160));

        let read_update = build_tool_call_update_from_raw(
            parser,
            RawToolCallUpdateInput {
                id: tool_call_id.to_string(),
                status: Some(ToolCallStatus::InProgress),
                result: None,
                raw_output: None,
                content: None,
                title: None,
                locations: None,
                streaming_input_delta: Some(r#"{"file_path": "/tmp/read.rs"}"#.to_string()),
                tool_name: None,
                raw_input: None,
                kind: None,
            },
            Some(&session_a),
        );
        let write_update = build_tool_call_update_from_raw(
            parser,
            RawToolCallUpdateInput {
                id: tool_call_id.to_string(),
                status: Some(ToolCallStatus::InProgress),
                result: None,
                raw_output: None,
                content: None,
                title: None,
                locations: None,
                streaming_input_delta: Some(
                    r#"{"file_path": "/tmp/write.rs", "content": "data"}"#.to_string(),
                ),
                tool_name: None,
                raw_input: None,
                kind: None,
            },
            Some(&session_b),
        );

        assert!(has_tool_state(&session_a, tool_call_id));
        assert!(has_tool_state(&session_b, tool_call_id));

        match read_update.streaming_arguments {
            Some(ToolArguments::Read { .. }) => {}
            other => panic!("session A should classify as Read, got {:?}", other),
        }
        match write_update.streaming_arguments {
            Some(ToolArguments::Edit { .. }) => {}
            other => panic!("session B should classify as Write/Edit, got {:?}", other),
        }

        let _ = build_tool_call_update_from_raw(
            parser,
            RawToolCallUpdateInput {
                id: tool_call_id.to_string(),
                status: Some(ToolCallStatus::Completed),
                result: None,
                raw_output: None,
                content: None,
                title: None,
                locations: None,
                streaming_input_delta: None,
                tool_name: None,
                raw_input: None,
                kind: None,
            },
            Some(&session_a),
        );
        assert!(
            !has_tool_state(&session_a, tool_call_id),
            "terminal on session A must not clear session B"
        );
        assert!(
            has_tool_state(&session_b, tool_call_id),
            "session B state must survive session A terminal cleanup"
        );
    });
}

/// Pin: plan-file path detection → accumulate → finalize round-trip via tool_calls seam.
#[test]
fn lifecycle_plan_detect_accumulate_finalize_round_trip() {
    with_agent(AgentType::ClaudeCode, || {
        let _streaming_test_guard = reset_streaming_state_for_test();
        let session_id = unique_session("lifecycle-plan-roundtrip");
        let tool_call_id = "plan-tool-1";
        let parser = get_parser(AgentType::ClaudeCode);
        let plan_path = "/Users/example/.claude/plans/pinned-plan.md";
        let plan_content = "# Pinned Plan\n\nStep one";
        let delta_json = serde_json::json!({
            "file_path": plan_path,
            "content": plan_content,
        })
        .to_string();
        let delta_json_for_terminal = "{}".to_string();

        seed_tool_name(&session_id, tool_call_id, "Write", AgentType::ClaudeCode);

        let streaming = build_tool_call_update_from_raw(
            parser,
            RawToolCallUpdateInput {
                id: tool_call_id.to_string(),
                status: Some(ToolCallStatus::InProgress),
                result: None,
                raw_output: None,
                content: None,
                title: None,
                locations: None,
                streaming_input_delta: Some(delta_json),
                tool_name: Some("Write".to_string()),
                raw_input: None,
                kind: None,
            },
            Some(&session_id),
        );

        let streaming_plan = streaming
            .streaming_plan
            .expect("plan delta should emit streaming_plan");
        assert!(streaming_plan.streaming);
        assert_eq!(streaming_plan.content.as_deref(), Some(plan_content));
        assert_eq!(streaming_plan.file_path.as_deref(), Some(plan_path));
        assert!(has_plan_streaming(&session_id));

        let finalized = build_tool_call_update_from_raw(
            parser,
            RawToolCallUpdateInput {
                id: tool_call_id.to_string(),
                status: Some(ToolCallStatus::Completed),
                result: None,
                raw_output: None,
                content: None,
                title: None,
                locations: None,
                // Terminal updates that still carry a streaming delta hit the finalize path
                // in build_tool_call_update_from_raw (drop RefMut → cleanup → finalize_plan).
                streaming_input_delta: Some(delta_json_for_terminal),
                tool_name: Some("Write".to_string()),
                raw_input: None,
                kind: None,
            },
            Some(&session_id),
        );

        let final_plan = finalized
            .streaming_plan
            .expect("terminal should finalize plan via finalize_plan_streaming_for_tool");
        assert!(!final_plan.streaming);
        assert!(
            final_plan
                .content
                .as_deref()
                .is_some_and(|c| c.contains("# Pinned Plan")),
            "finalized plan should retain accumulated content"
        );
        assert!(!has_plan_streaming(&session_id));
        assert!(!has_tool_state(&session_id, tool_call_id));
    });
}

/// Pin: concurrent delta + terminal updates on one tool must not deadlock.
/// Documents the drop-before-cleanup ordering in `build_tool_call_update_from_raw`.
#[tokio::test]
async fn lifecycle_concurrent_delta_and_terminal_does_not_deadlock() {
    use std::sync::Arc;
    use tokio::time::{timeout, Duration};

    let session_id = Arc::new(unique_session("lifecycle-concurrent"));
    let tool_call_id = "concurrent-tool";

    with_agent(AgentType::ClaudeCode, || {
        let _streaming_test_guard = reset_streaming_state_for_test();
        seed_tool_name(
            session_id.as_str(),
            tool_call_id,
            "TodoWrite",
            AgentType::ClaudeCode,
        );
    });

    let delta_input = RawToolCallUpdateInput {
        id: tool_call_id.to_string(),
        status: Some(ToolCallStatus::InProgress),
        result: None,
        raw_output: None,
        content: None,
        title: None,
        locations: None,
        streaming_input_delta: Some(
            r#"{"todos": [{"content": "x", "status": "pending"}]}"#.to_string(),
        ),
        tool_name: Some("TodoWrite".to_string()),
        raw_input: None,
        kind: None,
    };
    let terminal_input = RawToolCallUpdateInput {
        id: tool_call_id.to_string(),
        status: Some(ToolCallStatus::Completed),
        result: None,
        raw_output: None,
        content: None,
        title: None,
        locations: None,
        streaming_input_delta: None,
        tool_name: None,
        raw_input: None,
        kind: None,
    };

    let run = async {
        let mut handles = Vec::new();
        for round in 0..16 {
            let sid = Arc::clone(&session_id);
            let delta = delta_input.clone();
            let terminal = terminal_input.clone();
            handles.push(tokio::spawn(async move {
                with_agent(AgentType::ClaudeCode, || {
                    let parser = get_parser(AgentType::ClaudeCode);
                    if round % 2 == 0 {
                        build_tool_call_update_from_raw(parser, delta, Some(sid.as_str()));
                    } else {
                        build_tool_call_update_from_raw(parser, terminal, Some(sid.as_str()));
                    }
                })
            }));
        }
        for handle in handles {
            handle.await.expect("concurrent lifecycle task join");
        }
    };

    timeout(Duration::from_secs(5), run)
        .await
        .expect("concurrent delta + terminal updates should complete without deadlock");
}
