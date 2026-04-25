use crate::acp::client::{AvailableModel, SessionModelState, SessionModes};
use crate::acp::error::AcpResult;
use crate::session_jsonl::display_names::format_model_display_name;
use regex::Regex;
use serde_json::Value;
use std::cmp::Ordering;
use std::path::Path;
use std::sync::OnceLock;

static RE_VERSION_SUFFIX: OnceLock<Regex> = OnceLock::new();

fn version_suffix_regex() -> &'static Regex {
    RE_VERSION_SUFFIX
        .get_or_init(|| Regex::new(r"-v\d+(:\d+)?$").expect("version suffix regex must compile"))
}

/// Normalizes a model ID from any provider representation to its first-party canonical form.
///
/// Handles:
/// - Bedrock: `us.anthropic.claude-opus-4-7` → `claude-opus-4-7`
/// - Bedrock versioned: `us.anthropic.claude-opus-4-7-v1:0` → `claude-opus-4-7`
/// - Date-tagged: `claude-opus-4-7@20250514` → `claude-opus-4-7`
/// - Versioned suffix: `claude-opus-4-7-v1` → `claude-opus-4-7`
/// - First-party passthrough: `claude-opus-4-7` → `claude-opus-4-7`
pub(crate) fn normalize_model_id_from_any_provider(raw_id: &str) -> String {
    // Strip `@date` suffix.
    let without_at = if let Some(at_pos) = raw_id.find('@') {
        &raw_id[..at_pos]
    } else {
        raw_id
    };

    // Find the first `claude-` substring to handle Bedrock/Vertex prefixes.
    let claude_start = without_at.to_ascii_lowercase().find("claude-").unwrap_or(0);
    let from_claude = &without_at[claude_start..];

    // Strip trailing `-v\d+(:\d+)?` version suffix.
    let normalized = version_suffix_regex().replace(from_claude, "");
    normalized.to_string()
}

pub(crate) fn resolve_claude_runtime_mode_id(
    requested_mode_id: Option<&str>,
    cwd: &Path,
) -> String {
    match requested_mode_id {
        Some(mode_id) if mode_id != "default" => mode_id.to_string(),
        _ => configured_claude_permission_mode(cwd).unwrap_or_else(|| "default".to_string()),
    }
}

pub(crate) fn apply_claude_session_defaults(
    cwd: &Path,
    models: &mut SessionModelState,
    _modes: &mut SessionModes,
) -> AcpResult<()> {
    let should_apply_model =
        models.current_model_id.trim().is_empty() || models.current_model_id == "auto";
    if !should_apply_model {
        return Ok(());
    }

    let available_model_ids: Vec<String> = models
        .available_models
        .iter()
        .map(|model| model.model_id.clone())
        .collect();
    let Some(configured_model_id) = configured_claude_model_id(cwd, &available_model_ids) else {
        return Ok(());
    };

    models.current_model_id = configured_model_id.clone();
    if !models
        .available_models
        .iter()
        .any(|model| model.model_id == configured_model_id)
    {
        models.available_models.insert(
            0,
            AvailableModel {
                model_id: configured_model_id.clone(),
                name: format_model_display_name(&configured_model_id),
                description: Some("Configured in Claude settings".to_string()),
            },
        );
    }

    Ok(())
}

pub(crate) fn configured_claude_model_id(
    cwd: &Path,
    available_model_ids: &[String],
) -> Option<String> {
    configured_claude_model_id_with_home(cwd, dirs::home_dir().as_deref(), available_model_ids)
}

pub(crate) fn configured_claude_permission_mode(cwd: &Path) -> Option<String> {
    configured_claude_permission_mode_with_home(cwd, dirs::home_dir().as_deref())
}

pub(crate) fn is_claude_model_id(model_id: &str) -> bool {
    parse_claude_model_family(model_id).is_some()
}

pub(crate) fn compare_claude_model_ids(left: &str, right: &str) -> Ordering {
    let left_lower = left.to_ascii_lowercase();
    let right_lower = right.to_ascii_lowercase();
    claude_model_sort_key(&left_lower)
        .cmp(&claude_model_sort_key(&right_lower))
        .then_with(|| left_lower.cmp(&right_lower))
}

fn configured_claude_permission_mode_with_home(
    cwd: &Path,
    home_dir: Option<&Path>,
) -> Option<String> {
    let mut configured_mode = None;

    if let Some(home_dir) = home_dir {
        configured_mode = read_claude_permission_mode_from_settings(
            &home_dir.join(".claude").join("settings.json"),
        );
    }

    for settings_path in [
        cwd.join(".claude").join("settings.json"),
        cwd.join(".claude").join("settings.local.json"),
    ] {
        if let Some(mode) = read_claude_permission_mode_from_settings(&settings_path) {
            configured_mode = Some(mode);
        }
    }

    configured_mode
}

fn configured_claude_model_id_with_home(
    cwd: &Path,
    home_dir: Option<&Path>,
    available_model_ids: &[String],
) -> Option<String> {
    let mut configured_model = None;

    if let Some(home_dir) = home_dir {
        configured_model = read_claude_model_from_settings(
            &home_dir.join(".claude").join("settings.json"),
            available_model_ids,
        );
    }

    for settings_path in [
        cwd.join(".claude").join("settings.json"),
        cwd.join(".claude").join("settings.local.json"),
    ] {
        if let Some(model) = read_claude_model_from_settings(&settings_path, available_model_ids) {
            configured_model = Some(model);
        }
    }

    configured_model
}

fn read_claude_permission_mode_from_settings(path: &Path) -> Option<String> {
    let contents = std::fs::read_to_string(path).ok()?;
    let parsed = serde_json::from_str::<Value>(&contents).ok()?;
    parse_claude_permission_mode(&parsed)
}

fn read_claude_model_from_settings(path: &Path, available_model_ids: &[String]) -> Option<String> {
    let contents = std::fs::read_to_string(path).ok()?;
    let parsed = serde_json::from_str::<Value>(&contents).ok()?;
    parse_claude_model_setting(&parsed, available_model_ids)
}

fn parse_claude_permission_mode(settings: &Value) -> Option<String> {
    for pointer in [
        "/permissions/defaultMode",
        "/permissionMode",
        "/claude/permissionMode",
    ] {
        if let Some(value) = settings
            .pointer(pointer)
            .and_then(serde_json::Value::as_str)
        {
            if matches!(
                value,
                "default" | "acceptEdits" | "bypassPermissions" | "plan"
            ) {
                return Some(value.to_string());
            }
        }
    }

    for pointer in [
        "/dangerouslySkipPermissions",
        "/claude/dangerouslySkipPermissions",
    ] {
        if settings
            .pointer(pointer)
            .and_then(serde_json::Value::as_bool)
            == Some(true)
        {
            return Some("bypassPermissions".to_string());
        }
    }

    None
}

fn parse_claude_model_setting(settings: &Value, available_model_ids: &[String]) -> Option<String> {
    for pointer in ["/model", "/claude/model"] {
        if let Some(value) = settings.pointer(pointer).and_then(Value::as_str) {
            if let Some(model_id) = normalize_claude_model_id(value, available_model_ids) {
                return Some(model_id);
            }
        }
    }

    None
}

fn normalize_claude_model_id(raw: &str, available_model_ids: &[String]) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    let lower = trimmed.to_ascii_lowercase();
    if matches!(lower.as_str(), "sonnet" | "opus" | "haiku") {
        return newest_model_for_family(lower.as_str(), available_model_ids).or(Some(lower));
    }

    // Normalize cross-provider IDs (Bedrock/Vertex/Foundry) to first-party canonical form.
    let normalized = normalize_model_id_from_any_provider(trimmed);
    if normalized != trimmed && available_model_ids.iter().any(|id| id == &normalized) {
        tracing::debug!(
            original = %trimmed,
            normalized = %normalized,
            "Normalized cross-provider model ID to first-party form"
        );
        return Some(normalized);
    }

    Some(trimmed.to_string())
}

fn newest_model_for_family(family: &str, available_model_ids: &[String]) -> Option<String> {
    available_model_ids
        .iter()
        .filter(|model_id| parse_claude_model_family(model_id).as_deref() == Some(family))
        .max_by(|left, right| compare_claude_model_ids(left, right))
        .cloned()
}

fn parse_claude_model_family(model_id: &str) -> Option<String> {
    model_id
        .to_ascii_lowercase()
        .split(&['-', '_'][..])
        .find(|part| matches!(*part, "sonnet" | "opus" | "haiku"))
        .map(ToOwned::to_owned)
}

#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
struct ClaudeModelSortKey {
    version: Vec<u32>,
    date: Option<u32>,
}

fn claude_model_sort_key(model_id: &str) -> ClaudeModelSortKey {
    let parts: Vec<&str> = model_id.split(&['-', '_'][..]).collect();
    let Some(family_idx) = parts
        .iter()
        .position(|part| matches!(*part, "sonnet" | "opus" | "haiku"))
    else {
        return ClaudeModelSortKey {
            version: Vec::new(),
            date: None,
        };
    };

    let mut version = Vec::new();
    let mut date = None;
    for part in &parts[family_idx + 1..] {
        if part.len() == 8 && part.chars().all(|ch| ch.is_ascii_digit()) {
            date = part.parse::<u32>().ok();
            continue;
        }

        if part.chars().all(|ch| ch.is_ascii_digit()) {
            if let Ok(value) = part.parse::<u32>() {
                version.push(value);
            }
        }
    }

    ClaudeModelSortKey { version, date }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{LazyLock, Mutex};

    static HOME_ENV_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

    #[test]
    fn resolve_claude_runtime_mode_id_uses_user_settings_for_default_requests() {
        let _guard = HOME_ENV_LOCK.lock().expect("lock HOME env");
        let previous_home = std::env::var_os("HOME");
        let temp = tempfile::tempdir().expect("temp dir");
        let home = temp.path().join("home");
        let project = temp.path().join("project");
        std::fs::create_dir_all(home.join(".claude")).expect("create claude dir");
        std::fs::create_dir_all(&project).expect("create project dir");
        std::fs::write(
            home.join(".claude").join("settings.json"),
            r#"{
  "skipDangerousModePermissionPrompt": true,
  "permissions": {
    "defaultMode": "bypassPermissions"
  }
}"#,
        )
        .expect("write settings");
        std::env::set_var("HOME", &home);

        let resolved = resolve_claude_runtime_mode_id(None, &project);

        match previous_home {
            Some(previous_home) => std::env::set_var("HOME", previous_home),
            None => std::env::remove_var("HOME"),
        }

        assert_eq!(resolved, "bypassPermissions");
    }

    #[test]
    fn configured_claude_permission_mode_prefers_local_over_user_settings() {
        let temp = tempfile::tempdir().expect("temp dir");
        let home = temp.path().join("home");
        let project = temp.path().join("project");
        std::fs::create_dir_all(home.join(".claude")).expect("create user claude dir");
        std::fs::create_dir_all(project.join(".claude")).expect("create project claude dir");
        std::fs::write(
            home.join(".claude").join("settings.json"),
            r#"{"permissions":{"defaultMode":"acceptEdits"}}"#,
        )
        .expect("write user settings");
        std::fs::write(
            project.join(".claude").join("settings.local.json"),
            r#"{"permissions":{"defaultMode":"bypassPermissions"}}"#,
        )
        .expect("write local settings");

        let mode = configured_claude_permission_mode_with_home(&project, Some(&home));

        assert_eq!(mode.as_deref(), Some("bypassPermissions"));
    }

    #[test]
    fn parse_claude_permission_mode_supports_legacy_dangerously_skip_permissions() {
        let settings = serde_json::json!({
            "claude": {
                "dangerouslySkipPermissions": true
            }
        });

        assert_eq!(
            parse_claude_permission_mode(&settings).as_deref(),
            Some("bypassPermissions")
        );
    }

    #[test]
    fn configured_claude_model_prefers_local_settings_and_resolves_alias_to_latest_history_model() {
        let temp = tempfile::tempdir().expect("temp dir");
        let home = temp.path().join("home");
        let project = temp.path().join("project");
        std::fs::create_dir_all(home.join(".claude")).expect("create user claude dir");
        std::fs::create_dir_all(project.join(".claude")).expect("create project claude dir");
        std::fs::write(
            home.join(".claude").join("settings.json"),
            r#"{"model":"opus"}"#,
        )
        .expect("write user settings");
        std::fs::write(
            project.join(".claude").join("settings.local.json"),
            r#"{"model":"sonnet"}"#,
        )
        .expect("write local settings");

        let available_model_ids = vec![
            "claude-sonnet-4-5-20250929".to_string(),
            "claude-sonnet-4-6".to_string(),
            "claude-opus-4-6".to_string(),
        ];
        let configured =
            configured_claude_model_id_with_home(&project, Some(&home), &available_model_ids);

        assert_eq!(configured.as_deref(), Some("claude-sonnet-4-6"));
    }

    #[test]
    fn configured_claude_model_returns_alias_when_history_is_missing() {
        let settings = serde_json::json!({
            "model": "sonnet"
        });

        assert_eq!(
            parse_claude_model_setting(&settings, &[]).as_deref(),
            Some("sonnet")
        );
    }

    #[test]
    fn apply_claude_session_defaults_inserts_configured_model_when_missing() {
        let temp = tempfile::tempdir().expect("temp dir");
        let home = temp.path().join("home");
        let project = temp.path().join("project");
        std::fs::create_dir_all(home.join(".claude")).expect("create user claude dir");
        std::fs::create_dir_all(&project).expect("create project dir");
        std::fs::write(
            home.join(".claude").join("settings.json"),
            r#"{"model":"claude-sonnet-4-6"}"#,
        )
        .expect("write settings");

        let mut models = SessionModelState {
            available_models: Vec::new(),
            current_model_id: "auto".to_string(),
            models_display: Default::default(),
            provider_metadata: None,
        };
        let mut modes = SessionModes {
            current_mode_id: "build".to_string(),
            available_modes: Vec::new(),
        };

        let result =
            apply_claude_session_defaults_with_home(&project, Some(&home), &mut models, &mut modes);

        assert!(result.is_ok());
        assert_eq!(models.current_model_id, "claude-sonnet-4-6");
        assert_eq!(models.available_models.len(), 1);
        assert_eq!(models.available_models[0].name, "Sonnet 4.6");
    }

    fn apply_claude_session_defaults_with_home(
        cwd: &Path,
        home_dir: Option<&Path>,
        models: &mut SessionModelState,
        modes: &mut SessionModes,
    ) -> AcpResult<()> {
        let should_apply_model =
            models.current_model_id.trim().is_empty() || models.current_model_id == "auto";
        if !should_apply_model {
            return Ok(());
        }

        let available_model_ids: Vec<String> = models
            .available_models
            .iter()
            .map(|model| model.model_id.clone())
            .collect();
        let Some(configured_model_id) =
            configured_claude_model_id_with_home(cwd, home_dir, &available_model_ids)
        else {
            return Ok(());
        };

        let _ = modes;
        models.current_model_id = configured_model_id.clone();
        if !models
            .available_models
            .iter()
            .any(|model| model.model_id == configured_model_id)
        {
            models.available_models.insert(
                0,
                AvailableModel {
                    model_id: configured_model_id.clone(),
                    name: format_model_display_name(&configured_model_id),
                    description: Some("Configured in Claude settings".to_string()),
                },
            );
        }

        Ok(())
    }

    #[test]
    fn normalize_model_id_from_any_provider_table() {
        let cases = [
            // Bedrock prefix
            ("us.anthropic.claude-opus-4-7", "claude-opus-4-7"),
            // Bedrock with versioned suffix
            ("us.anthropic.claude-opus-4-7-v1:0", "claude-opus-4-7"),
            // Date-tagged
            ("claude-opus-4-7@20250514", "claude-opus-4-7"),
            // Versioned suffix only
            ("claude-opus-4-7-v1", "claude-opus-4-7"),
            // First-party passthrough
            ("claude-opus-4-7", "claude-opus-4-7"),
        ];
        for (input, expected) in cases {
            assert_eq!(
                normalize_model_id_from_any_provider(input),
                expected,
                "normalize_model_id_from_any_provider({input:?})"
            );
        }
    }
}
