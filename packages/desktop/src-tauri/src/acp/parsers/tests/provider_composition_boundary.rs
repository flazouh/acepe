use std::fs;
use std::path::PathBuf;

fn normalize_import_line(line: &str) -> String {
    line.chars()
        .filter(|ch| !ch.is_whitespace() && *ch != '{' && *ch != '}')
        .collect()
}

#[test]
fn tranche_one_parser_modules_do_not_cross_provider_boundaries() {
    struct BoundaryCase {
        relative_path: &'static str,
        forbidden_paths: &'static [&'static str],
    }

    let parser_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/acp/parsers");
    let cases = [
        BoundaryCase {
            relative_path: "edit_normalizers/shared_chat.rs",
            forbidden_paths: &[
                "super::opencode",
                "edit_normalizers::opencode",
                "crate::acp::parsers::edit_normalizers::opencode",
            ],
        },
        BoundaryCase {
            relative_path: "edit_normalizers/claude_code.rs",
            forbidden_paths: &[
                "super::copilot",
                "super::cursor",
                "super::codex",
                "super::opencode",
                "crate::acp::parsers::edit_normalizers::copilot",
                "crate::acp::parsers::edit_normalizers::cursor",
                "crate::acp::parsers::edit_normalizers::codex",
                "crate::acp::parsers::edit_normalizers::opencode",
            ],
        },
        BoundaryCase {
            relative_path: "edit_normalizers/copilot.rs",
            forbidden_paths: &[
                "super::claude_code",
                "super::cursor",
                "super::codex",
                "super::opencode",
                "crate::acp::parsers::edit_normalizers::claude_code",
                "crate::acp::parsers::edit_normalizers::cursor",
                "crate::acp::parsers::edit_normalizers::codex",
                "crate::acp::parsers::edit_normalizers::opencode",
            ],
        },
        BoundaryCase {
            relative_path: "adapters/claude_code.rs",
            forbidden_paths: &[
                "super::copilot",
                "super::cursor",
                "super::codex",
                "super::open_code",
                "super::CopilotAdapter",
                "super::CursorAdapter",
                "super::CodexAdapter",
                "super::OpenCodeAdapter",
                "crate::acp::parsers::adapters::copilot",
                "crate::acp::parsers::adapters::cursor",
                "crate::acp::parsers::adapters::codex",
                "crate::acp::parsers::adapters::open_code",
                "crate::acp::parsers::adapters::CopilotAdapter",
                "crate::acp::parsers::adapters::CursorAdapter",
                "crate::acp::parsers::adapters::CodexAdapter",
                "crate::acp::parsers::adapters::OpenCodeAdapter",
                "crate::acp::parsers::CopilotAdapter",
                "crate::acp::parsers::CursorAdapter",
                "crate::acp::parsers::CodexAdapter",
                "crate::acp::parsers::OpenCodeAdapter",
            ],
        },
        BoundaryCase {
            relative_path: "adapters/copilot.rs",
            forbidden_paths: &[
                "super::claude_code",
                "super::cursor",
                "super::codex",
                "super::open_code",
                "super::ClaudeCodeAdapter",
                "super::CursorAdapter",
                "super::CodexAdapter",
                "super::OpenCodeAdapter",
                "crate::acp::parsers::adapters::claude_code",
                "crate::acp::parsers::adapters::cursor",
                "crate::acp::parsers::adapters::codex",
                "crate::acp::parsers::adapters::open_code",
                "crate::acp::parsers::adapters::ClaudeCodeAdapter",
                "crate::acp::parsers::adapters::CursorAdapter",
                "crate::acp::parsers::adapters::CodexAdapter",
                "crate::acp::parsers::adapters::OpenCodeAdapter",
                "crate::acp::parsers::ClaudeCodeAdapter",
                "crate::acp::parsers::CursorAdapter",
                "crate::acp::parsers::CodexAdapter",
                "crate::acp::parsers::OpenCodeAdapter",
            ],
        },
        BoundaryCase {
            relative_path: "adapters/cursor.rs",
            forbidden_paths: &[
                "super::claude_code",
                "super::copilot",
                "super::codex",
                "super::open_code",
                "super::ClaudeCodeAdapter",
                "super::CopilotAdapter",
                "super::CodexAdapter",
                "super::OpenCodeAdapter",
                "crate::acp::parsers::adapters::claude_code",
                "crate::acp::parsers::adapters::copilot",
                "crate::acp::parsers::adapters::codex",
                "crate::acp::parsers::adapters::open_code",
                "crate::acp::parsers::adapters::ClaudeCodeAdapter",
                "crate::acp::parsers::adapters::CopilotAdapter",
                "crate::acp::parsers::adapters::CodexAdapter",
                "crate::acp::parsers::adapters::OpenCodeAdapter",
                "crate::acp::parsers::ClaudeCodeAdapter",
                "crate::acp::parsers::CopilotAdapter",
                "crate::acp::parsers::CodexAdapter",
                "crate::acp::parsers::OpenCodeAdapter",
            ],
        },
        BoundaryCase {
            relative_path: "adapters/codex.rs",
            forbidden_paths: &[
                "super::claude_code",
                "super::copilot",
                "super::cursor",
                "super::open_code",
                "super::ClaudeCodeAdapter",
                "super::CopilotAdapter",
                "super::CursorAdapter",
                "super::OpenCodeAdapter",
                "crate::acp::parsers::adapters::claude_code",
                "crate::acp::parsers::adapters::copilot",
                "crate::acp::parsers::adapters::cursor",
                "crate::acp::parsers::adapters::open_code",
                "crate::acp::parsers::adapters::ClaudeCodeAdapter",
                "crate::acp::parsers::adapters::CopilotAdapter",
                "crate::acp::parsers::adapters::CursorAdapter",
                "crate::acp::parsers::adapters::OpenCodeAdapter",
                "crate::acp::parsers::ClaudeCodeAdapter",
                "crate::acp::parsers::CopilotAdapter",
                "crate::acp::parsers::CursorAdapter",
                "crate::acp::parsers::OpenCodeAdapter",
            ],
        },
    ];

    let violations: Vec<String> = cases
        .iter()
        .flat_map(|case| {
            let source_path = parser_root.join(case.relative_path);
            let source = fs::read_to_string(&source_path).unwrap_or_else(|error| {
                panic!("failed to read {}: {error}", source_path.display())
            });
            let normalized_imports: Vec<String> = source
                .lines()
                .map(str::trim_start)
                .filter(|line| line.starts_with("use ") || line.starts_with("pub use "))
                .map(normalize_import_line)
                .collect();

            case.forbidden_paths
                .iter()
                .filter_map(move |forbidden_path| {
                    let normalized_forbidden_path = normalize_import_line(forbidden_path);
                    if source.contains(*forbidden_path)
                        || normalized_imports
                            .iter()
                            .any(|line| line.contains(&normalized_forbidden_path))
                    {
                        Some(format!(
                            "{} references {forbidden_path}",
                            case.relative_path
                        ))
                    } else {
                        None
                    }
                })
                .collect::<Vec<String>>()
        })
        .collect();

    assert!(
        violations.is_empty(),
        "Tranche-1 parser ownership boundary violated:\n{}",
        violations.join("\n")
    );
}
