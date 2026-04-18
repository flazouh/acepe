//! Unit 2: projector + semantic record invariants (R2, R3, R13).

use crate::acp::parsers::arguments::parse_tool_kind_arguments;
use crate::acp::reconciler::projector;
use crate::acp::reconciler::semantic::SemanticToolRecord;
use crate::acp::session_update::{ToolArguments, ToolKind};
use serde_json::json;

#[test]
fn projector_preserves_read_source_context() {
    let raw = json!({
        "path": "/packages/desktop/src/lib.rs",
        "file_path": "/packages/desktop/src/lib.rs",
        "view_range": { "start_line": 12, "end_line": 48 },
        "lines": "12| pub fn project() {\n13|   Ok(())\n"
    });
    let arguments = parse_tool_kind_arguments(ToolKind::Read, &raw);
    let record = SemanticToolRecord::new(ToolKind::Read, arguments.clone(), None, None);
    let projected = projector::project_semantic_record(&record);
    assert_eq!(projected, arguments);
    assert_eq!(projector::projected_tool_kind(&projected), ToolKind::Read);

    match projected {
        ToolArguments::Read {
            file_path,
            source_context,
        } => {
            assert_eq!(file_path.as_deref(), Some("/packages/desktop/src/lib.rs"));
            let ctx = source_context.expect("expected structured read context");
            assert_eq!(ctx.path.as_deref(), Some("/packages/desktop/src/lib.rs"));
            assert_eq!(ctx.view_range.as_ref().and_then(|r| r.start_line), Some(12));
            assert_eq!(ctx.view_range.as_ref().and_then(|r| r.end_line), Some(48));
            assert!(ctx
                .excerpt
                .as_ref()
                .is_some_and(|e| e.contains("project()")));
        }
        other => panic!("expected Read, got {other:?}"),
    }
}

#[test]
fn projector_sql_round_trip() {
    let raw = json!({
        "query": "SELECT 1",
        "description": "probe"
    });
    let arguments = parse_tool_kind_arguments(ToolKind::Sql, &raw);
    let record = SemanticToolRecord::new(ToolKind::Sql, arguments.clone(), None, None);
    assert_eq!(projector::project_semantic_record(&record), arguments);
}
