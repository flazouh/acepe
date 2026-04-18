use std::fs;
use std::path::PathBuf;

fn normalize_import_line(line: &str) -> String {
    line.chars()
        .filter(|ch| !ch.is_whitespace() && *ch != '{' && *ch != '}')
        .collect()
}

struct ProviderFamily {
    adapter_module: &'static str,
    edit_module: &'static str,
    parser_module: &'static str,
    type_prefix: &'static str,
}

struct BoundaryCase {
    relative_path: String,
    forbidden_paths: Vec<String>,
}

fn collect_violations(
    source: &str,
    relative_path: &str,
    forbidden_paths: &[String],
) -> Vec<String> {
    let normalized_imports: Vec<String> = source
        .lines()
        .map(str::trim_start)
        .filter(|line| line.starts_with("use ") || line.starts_with("pub use "))
        .map(normalize_import_line)
        .collect();

    forbidden_paths
        .iter()
        .filter_map(|forbidden_path| {
            let normalized_forbidden_path = normalize_import_line(forbidden_path);
            if source.contains(forbidden_path)
                || normalized_imports
                    .iter()
                    .any(|line| line.contains(&normalized_forbidden_path))
            {
                Some(format!("{relative_path} references {forbidden_path}"))
            } else {
                None
            }
        })
        .collect()
}

fn runtime_forbidden_paths() -> Vec<String> {
    [
        "crate::acp::client::cc_sdk_client",
        "crate::acp::client::codex_native_events",
        "crate::acp::cursor_extensions",
        "crate::acp::opencode::sse::conversion",
        "crate::acp::commands::inbound_commands",
    ]
    .into_iter()
    .map(ToOwned::to_owned)
    .collect()
}

fn adapter_case(current: &ProviderFamily, all: &[ProviderFamily]) -> BoundaryCase {
    let mut forbidden_paths = all
        .iter()
        .filter(|family| family.adapter_module != current.adapter_module)
        .flat_map(|family| {
            [
                format!("super::{}", family.adapter_module),
                format!("super::{}Adapter", family.type_prefix),
                format!(
                    "crate::acp::reconciler::providers::{}",
                    family.adapter_module
                ),
                format!(
                    "crate::acp::reconciler::providers::{}Adapter",
                    family.type_prefix
                ),
                format!(
                    "crate::acp::reconciler::providers::{}::{}Adapter",
                    family.adapter_module, family.type_prefix
                ),
                format!("crate::acp::parsers::{}Adapter", family.type_prefix),
            ]
        })
        .collect::<Vec<_>>();
    forbidden_paths.extend(runtime_forbidden_paths());

    BoundaryCase {
        relative_path: format!("reconciler/providers/{}.rs", current.adapter_module),
        forbidden_paths,
    }
}

fn edit_case(current: &ProviderFamily, all: &[ProviderFamily]) -> BoundaryCase {
    let mut forbidden_paths = all
        .iter()
        .filter(|family| family.edit_module != current.edit_module)
        .flat_map(|family| {
            [
                format!("super::{}", family.edit_module),
                format!("edit_normalizers::{}", family.edit_module),
                format!(
                    "crate::acp::parsers::edit_normalizers::{}",
                    family.edit_module
                ),
            ]
        })
        .collect::<Vec<_>>();
    forbidden_paths.extend(runtime_forbidden_paths());

    BoundaryCase {
        relative_path: format!("edit_normalizers/{}.rs", current.edit_module),
        forbidden_paths,
    }
}

fn parser_case(current: &ProviderFamily, all: &[ProviderFamily]) -> BoundaryCase {
    let mut forbidden_paths = all
        .iter()
        .filter(|family| family.parser_module != current.parser_module)
        .flat_map(|family| {
            [
                format!("super::{}", family.parser_module),
                format!("super::{}Parser", family.type_prefix),
                format!("crate::acp::parsers::{}", family.parser_module),
                format!("crate::acp::parsers::{}Parser", family.type_prefix),
                format!(
                    "crate::acp::parsers::{}::{}Parser",
                    family.parser_module, family.type_prefix
                ),
            ]
        })
        .collect::<Vec<_>>();
    forbidden_paths.extend(runtime_forbidden_paths());

    BoundaryCase {
        relative_path: format!("{}.rs", current.parser_module),
        forbidden_paths,
    }
}

#[test]
fn provider_modules_do_not_cross_provider_boundaries() {
    let parser_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/acp/parsers");
    let acp_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/acp");

    // OpenCode remains provider-owned today. We intentionally apply the same no-sibling-import
    // rule to its parser, adapter, and edit normalizer instead of treating it as a hidden
    // exception while future shared capability work is still pending.
    let provider_families = [
        ProviderFamily {
            adapter_module: "claude_code",
            edit_module: "claude_code",
            parser_module: "claude_code_parser",
            type_prefix: "ClaudeCode",
        },
        ProviderFamily {
            adapter_module: "copilot",
            edit_module: "copilot",
            parser_module: "copilot_parser",
            type_prefix: "Copilot",
        },
        ProviderFamily {
            adapter_module: "cursor",
            edit_module: "cursor",
            parser_module: "cursor_parser",
            type_prefix: "Cursor",
        },
        ProviderFamily {
            adapter_module: "codex",
            edit_module: "codex",
            parser_module: "codex_parser",
            type_prefix: "Codex",
        },
        ProviderFamily {
            adapter_module: "open_code",
            edit_module: "opencode",
            parser_module: "opencode_parser",
            type_prefix: "OpenCode",
        },
    ];

    let cases: Vec<BoundaryCase> = provider_families
        .iter()
        .flat_map(|family| {
            [
                adapter_case(family, &provider_families),
                edit_case(family, &provider_families),
                parser_case(family, &provider_families),
            ]
        })
        .collect();

    let violations: Vec<String> = cases
        .iter()
        .flat_map(|case| {
            let source_path = if case.relative_path.starts_with("reconciler/") {
                acp_root.join(&case.relative_path)
            } else {
                parser_root.join(&case.relative_path)
            };
            let source = fs::read_to_string(&source_path).unwrap_or_else(|error| {
                panic!("failed to read {}: {error}", source_path.display())
            });

            collect_violations(&source, &case.relative_path, &case.forbidden_paths)
        })
        .collect();

    assert!(
        violations.is_empty(),
        "Provider ownership boundary violated:\n{}",
        violations.join("\n")
    );
}

#[test]
fn agent_context_does_not_silently_default_to_a_built_in_provider() {
    let source_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/acp/agent_context.rs");
    let source = fs::read_to_string(&source_path)
        .unwrap_or_else(|error| panic!("failed to read {}: {error}", source_path.display()));

    assert!(
        !source.contains("unwrap_or(AgentType::ClaudeCode)")
            && !source.contains("unwrap_or(AgentType::Copilot)"),
        "agent_context.rs must not silently default missing context to a built-in agent"
    );
}
