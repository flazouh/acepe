use crate::acp::parsers::{get_parser, AgentType};
use crate::acp::session_update::{
    build_tool_call_from_raw, RawToolCallInput, ToolArguments, ToolCallStatus, ToolKind,
};
use serde_json::json;

#[test]
fn unclaimed_tool_call_should_classify_as_unclassified() {
    let parser = get_parser(AgentType::ClaudeCode);
    let raw = RawToolCallInput {
        id: "tool-unclassified".to_string(),
        name: String::new(),
        arguments: json!({}),
        status: ToolCallStatus::Pending,
        kind: Some(ToolKind::Other),
        title: Some("Generic tool".to_string()),
        suppress_title_read_path_hint: false,
        parent_tool_use_id: None,
        task_children: None,
    };

    let tool_call = build_tool_call_from_raw(parser, raw);

    assert_eq!(tool_call.kind, Some(ToolKind::Unclassified));
    match tool_call.arguments {
        ToolArguments::Unclassified {
            raw_name,
            raw_kind_hint,
            title,
            signals_tried,
            ..
        } => {
            assert!(raw_name.is_empty());
            assert_eq!(raw_kind_hint.as_deref(), Some("other"));
            assert_eq!(title.as_deref(), Some("Generic tool"));
            assert!(!signals_tried.is_empty());
        }
        other => panic!("expected Unclassified arguments, got {other:?}"),
    }
}
