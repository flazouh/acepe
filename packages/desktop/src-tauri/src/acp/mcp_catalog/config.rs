use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use serde::Deserialize;
use serde_json::Value;

/// Server names discovered from on-disk MCP configuration (project + user).
pub fn load_configured_mcp_server_names(project_root: &Path) -> Vec<String> {
    let mut candidates = project_mcp_config_candidates(project_root);
    candidates.extend(user_mcp_config_candidates());
    load_mcp_server_names_from_candidates(&candidates)
}

fn project_mcp_config_candidates(project_root: &Path) -> Vec<PathBuf> {
    vec![
        project_root.join(".cursor").join("mcp.json"),
        project_root.join("mcp.json"),
    ]
}

fn user_mcp_config_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join(".cursor").join("mcp.json"));
    }
    candidates
}

fn load_mcp_server_names_from_candidates(candidates: &[PathBuf]) -> Vec<String> {
    let mut names = BTreeSet::new();
    for candidate in candidates {
        if let Some(file_names) = read_mcp_server_names_from_file(candidate) {
            for name in file_names {
                names.insert(name);
            }
        }
    }
    names.into_iter().collect()
}

fn read_mcp_server_names_from_file(path: &Path) -> Option<Vec<String>> {
    let content = std::fs::read_to_string(path).ok()?;
    let value = serde_json::from_str::<Value>(&content).ok()?;
    Some(parse_mcp_server_names(&value))
}

fn parse_mcp_server_names(value: &Value) -> Vec<String> {
    let servers_value = value
        .get("mcpServers")
        .or_else(|| value.get("mcp_servers"))
        .and_then(Value::as_object);
    let Some(servers) = servers_value else {
        return Vec::new();
    };

    servers.keys().cloned().collect()
}

#[derive(Debug, Deserialize)]
struct McpServersFile {
    #[serde(rename = "mcpServers")]
    mcp_servers: Option<serde_json::Map<String, Value>>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn reads_cursor_style_project_mcp_json() {
        let temp = tempdir().expect("temp dir");
        let cursor_dir = temp.path().join(".cursor");
        fs::create_dir_all(&cursor_dir).expect("cursor dir");
        fs::write(
            cursor_dir.join("mcp.json"),
            r#"{"mcpServers":{"github":{"command":"npx"},"linear":{"url":"https://example.com"}}}"#,
        )
        .expect("write mcp.json");

        let names = load_mcp_server_names_from_candidates(&project_mcp_config_candidates(temp.path()));
        assert_eq!(names, vec!["github".to_string(), "linear".to_string()]);
    }

    #[test]
    fn includes_user_level_cursor_mcp_config_path() {
        let temp = tempdir().expect("temp dir");
        let candidates = user_mcp_config_candidates();
        if let Some(home) = dirs::home_dir() {
            assert!(candidates.contains(&home.join(".cursor").join("mcp.json")));
        }
        assert!(project_mcp_config_candidates(temp.path())
            .contains(&temp.path().join(".cursor").join("mcp.json")));
    }

    #[test]
    fn returns_empty_when_no_project_config_exists() {
        let temp = tempdir().expect("temp dir");
        assert!(load_mcp_server_names_from_candidates(&project_mcp_config_candidates(temp.path())).is_empty());
    }
}
