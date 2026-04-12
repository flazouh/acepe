use acepe_lib::acp::parsers::{get_parser, AgentType};
use acepe_lib::acp::session_update::{ToolArguments, ToolKind};
use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize)]
struct FixtureExpected {
    kind: String,
    argument_kind: String,
    query: Option<String>,
    description: Option<String>,
    file_path: Option<String>,
    from: Option<String>,
    to: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ProviderFixture {
    agent: String,
    payload: Value,
    expected: FixtureExpected,
}

fn load_fixture(path: &str) -> ProviderFixture {
    let fixture_text = std::fs::read_to_string(path).expect("fixture should load");
    serde_json::from_str(&fixture_text).expect("fixture should parse")
}

fn parse_agent(value: &str) -> AgentType {
    match value {
        "copilot" => AgentType::Copilot,
        "codex" => AgentType::Codex,
        "opencode" => AgentType::OpenCode,
        other => panic!("unsupported fixture agent: {other}"),
    }
}

fn parse_tool_kind(value: &str) -> ToolKind {
    match value {
        "task" => ToolKind::Task,
        "edit" => ToolKind::Edit,
        "move" => ToolKind::Move,
        "web_search" => ToolKind::WebSearch,
        other => panic!("unsupported expected kind: {other}"),
    }
}

fn assert_expected_arguments(expected: &FixtureExpected, arguments: &ToolArguments) {
    match (expected.argument_kind.as_str(), arguments) {
        ("web_search", ToolArguments::WebSearch { query }) => {
            assert_eq!(query.as_deref(), expected.query.as_deref());
        }
        (
            "think",
            ToolArguments::Think {
                description, prompt: _, ..
            },
        ) => {
            assert_eq!(description.as_deref(), expected.description.as_deref());
        }
        ("edit", ToolArguments::Edit { edits }) => {
            let first_edit = edits.first().expect("edit entry");
            assert_eq!(
                first_edit.file_path().map(String::as_str),
                expected.file_path.as_deref()
            );
        }
        ("move", ToolArguments::Move { from, to }) => {
            assert_eq!(from.as_deref(), expected.from.as_deref());
            assert_eq!(to.as_deref(), expected.to.as_deref());
        }
        other => panic!("unexpected argument match: {other:?}"),
    }
}

#[test]
fn provider_tool_event_fixtures_preserve_canonical_semantics() {
    let fixture_dir = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/provider-tool-events"
    );
    let fixture_paths = [
        "copilot-description-query.json",
        "copilot-subagent-task.json",
        "codex-semantic-kind.json",
        "codex-edit-patch.json",
        "opencode-semantic-kind.json",
        "opencode-edit-patch.json",
    ];

    for fixture_name in fixture_paths {
        let fixture = load_fixture(&format!("{fixture_dir}/{fixture_name}"));
        let parser = get_parser(parse_agent(&fixture.agent));
        let parsed = parser
            .parse_tool_call(&fixture.payload)
            .unwrap_or_else(|error| panic!("{fixture_name} failed to parse: {error:?}"));

        assert_eq!(
            parsed.kind,
            Some(parse_tool_kind(&fixture.expected.kind)),
            "{fixture_name} returned wrong kind"
        );
        assert_expected_arguments(&fixture.expected, &parsed.arguments);
    }
}
