//! Characterization for **streamed** tool input vs one-shot classification.
//!
//! `SessionStreamingState::accumulate_delta` eventually calls `providers::classify` on the parsed JSON
//! (`streaming_accumulator::SessionStreamingState::normalize_value`). Unit 4 will fold streaming into
//! the provider reducer; these tests document parity expectations:
//!
//! - **Todo / Question / Sql**: progressive deltas that parse to the same final JSON object as a
//!   non-streamed tool call should yield the same [`crate::acp::session_update::ToolArguments`] as
//!   `providers::classify` on that object (same agent, same weak identity inputs).
//! - **Effective naming**: `effective_streaming_tool_name` may rewrite display names when the wire
//!   name is `"unknown"`; classification still uses the reconciler output [`ToolKind`].

use crate::acp::parsers::AgentType;
use crate::acp::reconciler::providers;
use crate::acp::reconciler::RawClassificationInput;
use crate::acp::session_update::{ToolArguments, ToolKind};
use crate::acp::streaming_accumulator::SessionStreamingState;

fn throttle_for_streaming_emit() {
    std::thread::sleep(std::time::Duration::from_millis(160));
}

fn classify_json(
    agent: AgentType,
    tool_call_id: &str,
    tool_name: &str,
    kind_hint: &str,
    json: &serde_json::Value,
) -> crate::acp::reconciler::ClassificationOutput {
    providers::classify(
        agent,
        &RawClassificationInput {
            id: tool_call_id,
            name: Some(tool_name),
            title: Some(tool_name),
            kind_hint: Some(kind_hint),
            arguments: json,
        },
    )
}

fn assert_tool_arguments_equal(a: &ToolArguments, b: &ToolArguments) {
    match (a, b) {
        (
            ToolArguments::Sql {
                query: q1,
                description: d1,
            },
            ToolArguments::Sql {
                query: q2,
                description: d2,
            },
        ) => {
            assert_eq!(q1, q2);
            assert_eq!(d1, d2);
        }
        (
            ToolArguments::Think {
                description: d1,
                prompt: p1,
                subagent_type: s1,
                skill: sk1,
                skill_args: sa1,
                raw: r1,
            },
            ToolArguments::Think {
                description: d2,
                prompt: p2,
                subagent_type: s2,
                skill: sk2,
                skill_args: sa2,
                raw: r2,
            },
        ) => {
            assert_eq!(d1, d2);
            assert_eq!(p1, p2);
            assert_eq!(s1, s2);
            assert_eq!(sk1, sk2);
            assert_eq!(sa1, sa2);
            assert_eq!(r1, r2);
        }
        _ => panic!("argument variants differ: {a:?} vs {b:?}"),
    }
}

#[test]
fn streamed_sql_matches_direct_classify() {
    let agent = AgentType::Copilot;
    let payload = r#"{"description":"Mark all done","query":"UPDATE todos SET status = 'done'"}"#;
    let parsed: serde_json::Value = serde_json::from_str(payload).unwrap();

    let direct = classify_json(agent, "tool-sql-parity", "unknown", "other", &parsed);

    let state = SessionStreamingState::new();
    throttle_for_streaming_emit();
    let streamed = state
        .accumulate_delta("tool-sql-parity", "unknown", payload, agent)
        .expect("streamed sql");

    assert_eq!(
        direct.kind,
        streamed.streaming_arguments.as_ref().unwrap().tool_kind()
    );
    assert_tool_arguments_equal(
        &direct.arguments,
        streamed.streaming_arguments.as_ref().unwrap(),
    );
}

#[test]
fn streamed_todo_matches_direct_classify() {
    let agent = AgentType::ClaudeCode;
    let payload = r#"{"todos":[{"content":"Ship reconciler","status":"in_progress","activeForm":"Shipping reconciler"}]}"#;
    let parsed: serde_json::Value = serde_json::from_str(payload).unwrap();

    let direct = classify_json(agent, "tool-todo-parity", "unknown", "other", &parsed);

    let state = SessionStreamingState::new();
    throttle_for_streaming_emit();
    let streamed = state
        .accumulate_delta("tool-todo-parity", "unknown", payload, agent)
        .expect("streamed todo");

    assert_tool_arguments_equal(
        &direct.arguments,
        streamed.streaming_arguments.as_ref().unwrap(),
    );
}

#[test]
fn streamed_question_matches_direct_classify() {
    let agent = AgentType::ClaudeCode;
    let payload = r#"{"questions":[{"question":"Next step?","header":"Plan","options":[{"label":"A","description":"do a"}],"multiSelect":false}]}"#;
    let parsed: serde_json::Value = serde_json::from_str(payload).unwrap();

    let direct = classify_json(agent, "tool-q-parity", "unknown", "other", &parsed);

    let state = SessionStreamingState::new();
    throttle_for_streaming_emit();
    let streamed = state
        .accumulate_delta("tool-q-parity", "unknown", payload, agent)
        .expect("streamed question");

    assert_eq!(direct.kind, ToolKind::Question);
    assert_tool_arguments_equal(
        &direct.arguments,
        streamed.streaming_arguments.as_ref().unwrap(),
    );
}
