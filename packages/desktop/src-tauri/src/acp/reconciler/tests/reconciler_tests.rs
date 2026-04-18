use crate::acp::reconciler::{
    classify_with_provider_name_kind, RawClassificationInput, SignalName,
};
use crate::acp::session_update::{ToolArguments, ToolKind};

#[test]
fn provider_name_kind_has_highest_priority() {
    let output = classify_with_provider_name_kind(
        Some(ToolKind::Read),
        &RawClassificationInput {
            id: "tool-read",
            name: Some("read"),
            title: None,
            kind_hint: Some("execute"),
            arguments: &serde_json::json!({ "command": "ls" }),
        },
    );

    assert_eq!(output.kind, ToolKind::Read);
    // Provider resolved first — no fallback signals should fire
    assert!(output.signals_tried.is_empty());
}

#[test]
fn todo_sql_argument_shape_wins_before_task_like_description() {
    let output = classify_with_provider_name_kind(
        None,
        &RawClassificationInput {
            id: "tool-sql",
            name: Some("unknown"),
            title: Some("Mark all done"),
            kind_hint: Some("other"),
            arguments: &serde_json::json!({
                "description": "Mark all done",
                "query": "UPDATE todos SET status = 'done'"
            }),
        },
    );

    assert_eq!(output.kind, ToolKind::Todo);
    assert_eq!(output.signals_tried, vec![SignalName::ProviderName]);
    match output.arguments {
        ToolArguments::Think { raw, .. } => {
            let raw = raw.expect("raw todo payload");
            assert_eq!(
                raw.get("query").and_then(serde_json::Value::as_str),
                Some("UPDATE todos SET status = 'done'")
            );
            assert_eq!(
                raw.get("description").and_then(serde_json::Value::as_str),
                Some("Mark all done")
            );
        }
        other => panic!("expected todo arguments, got {other:?}"),
    }
}

#[test]
fn empty_inputs_become_unclassified_with_all_failed_signals() {
    let output = classify_with_provider_name_kind(
        None,
        &RawClassificationInput {
            id: "tool-empty",
            name: Some(""),
            title: None,
            kind_hint: Some("other"),
            arguments: &serde_json::json!({}),
        },
    );

    assert_eq!(output.kind, ToolKind::Unclassified);
    assert_eq!(
        output.signals_tried,
        vec![
            SignalName::ProviderName,
            SignalName::ArgumentShape,
            SignalName::AcpKindHint,
            SignalName::TitleHeuristic
        ]
    );
    match output.arguments {
        ToolArguments::Unclassified { signals_tried, .. } => {
            assert_eq!(
                signals_tried,
                vec![
                    "provider_name".to_string(),
                    "argument_shape".to_string(),
                    "acp_kind_hint".to_string(),
                    "title_heuristic".to_string()
                ]
            );
        }
        other => panic!("expected unclassified arguments, got {other:?}"),
    }
}

#[test]
fn promotes_fetch_to_web_search_from_search_id() {
    let output = classify_with_provider_name_kind(
        None,
        &RawClassificationInput {
            id: "ws_123",
            name: Some("unknown"),
            title: None,
            kind_hint: Some("fetch"),
            arguments: &serde_json::json!({ "url": "https://example.com" }),
        },
    );

    assert_eq!(output.kind, ToolKind::WebSearch);
}

#[test]
fn promotes_browser_title_even_when_otherwise_unclassified() {
    let output = classify_with_provider_name_kind(
        None,
        &RawClassificationInput {
            id: "tool-browser",
            name: Some("unknown"),
            title: Some("webview_screenshot"),
            kind_hint: Some("other"),
            arguments: &serde_json::json!({}),
        },
    );

    assert_eq!(output.kind, ToolKind::Browser);
    assert_eq!(
        output.signals_tried,
        vec![
            SignalName::ProviderName,
            SignalName::ArgumentShape,
            SignalName::AcpKindHint,
            SignalName::TitleHeuristic
        ]
    );
}
