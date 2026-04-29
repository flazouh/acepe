use serde::{Deserialize, Serialize};
use serde_json::Value;
use specta::Type;

const MAX_CANONICAL_CONFIG_STRING_LENGTH: usize = 512;

/// Available command with metadata.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AvailableCommand {
    pub name: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input: Option<CommandInput>,
}

/// Command input hint.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CommandInput {
    /// The hint can be a string or array in the protocol; we normalize to string.
    #[serde(deserialize_with = "deserialize_hint_to_string")]
    pub hint: String,
}

/// Deserialize hint field that can be a string, array of strings, or array of objects.
/// Normalizes all formats to a single string.
fn deserialize_hint_to_string<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::de::{self, Visitor};
    use std::fmt;

    struct HintVisitor;

    impl<'de> Visitor<'de> for HintVisitor {
        type Value = String;

        fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
            formatter.write_str("a string or array")
        }

        fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            Ok(value.to_string())
        }

        fn visit_seq<A>(self, mut seq: A) -> Result<Self::Value, A::Error>
        where
            A: de::SeqAccess<'de>,
        {
            let mut parts = Vec::new();
            while let Some(elem) = seq.next_element::<serde_json::Value>()? {
                match elem {
                    serde_json::Value::String(s) => parts.push(s),
                    serde_json::Value::Object(obj) => {
                        // Handle objects like {"optional": "description"}
                        for (_key, val) in obj {
                            if let serde_json::Value::String(s) = val {
                                parts.push(s);
                            }
                        }
                    }
                    _ => {}
                }
            }
            Ok(parts.join(", "))
        }
    }

    deserializer.deserialize_any(HintVisitor)
}

/// Available commands update data.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AvailableCommandsData {
    pub available_commands: Vec<AvailableCommand>,
}

/// Current mode update data.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CurrentModeData {
    pub current_mode_id: String,
}

/// Configuration option value.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ConfigOptionValue {
    pub name: String,
    pub value: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// Configuration option data.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ConfigOptionData {
    pub id: String,
    pub name: String,
    pub category: String,
    #[serde(rename = "type")]
    pub option_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_value: Option<Value>,
    #[serde(default, deserialize_with = "deserialize_config_options")]
    pub options: Vec<ConfigOptionValue>,
}

/// Deserialize config options that can be either:
/// - Flat: `[{name, value, description?}]`
/// - Grouped: `[{group, name, options: [{name, value, description?}]}]`
/// - Invalid: defaults to empty vec
fn deserialize_config_options<'de, D>(deserializer: D) -> Result<Vec<ConfigOptionValue>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let items: Vec<Value> = match Vec::<Value>::deserialize(deserializer) {
        Ok(v) => v,
        Err(_) => return Ok(Vec::new()),
    };

    let mut result = Vec::new();
    for item in items {
        // Try flat format first: {name, value}
        if item.get("value").is_some() {
            if let Ok(opt) = serde_json::from_value::<ConfigOptionValue>(item.clone()) {
                result.push(opt);
                continue;
            }
        }
        // Try grouped format: {group, name, options: [{name, value}]}
        if let Some(nested) = item.get("options").and_then(|v| v.as_array()) {
            for nested_item in nested {
                if let Ok(opt) = serde_json::from_value::<ConfigOptionValue>(nested_item.clone()) {
                    result.push(opt);
                }
            }
        }
    }
    Ok(result)
}

/// Configuration options update data.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ConfigOptionUpdateData {
    pub config_options: Vec<ConfigOptionData>,
}

/// Boundary gate for config options before they enter canonical session capabilities.
///
/// Canonical capabilities are product state, so provider-supplied config values
/// are constrained to display-safe scalar/enum values. Credential-shaped strings
/// and structured payloads are redacted instead of becoming canonical truth.
pub fn sanitize_config_options_for_canonical(
    options: Vec<ConfigOptionData>,
) -> Vec<ConfigOptionData> {
    options
        .into_iter()
        .map(sanitize_config_option_for_canonical)
        .collect()
}

fn sanitize_config_option_for_canonical(mut option: ConfigOptionData) -> ConfigOptionData {
    let identity = ConfigOptionIdentity {
        id: option.id.clone(),
        name: option.name.clone(),
        category: option.category.clone(),
    };
    option.current_value = option
        .current_value
        .map(|value| sanitize_config_value_for_canonical(value, &identity, "currentValue"));
    option.options = option
        .options
        .into_iter()
        .map(|mut candidate| {
            candidate.value =
                sanitize_config_value_for_canonical(candidate.value, &identity, "option.value");
            candidate
        })
        .collect();
    option
}

struct ConfigOptionIdentity {
    id: String,
    name: String,
    category: String,
}

fn sanitize_config_value_for_canonical(
    value: Value,
    identity: &ConfigOptionIdentity,
    field: &'static str,
) -> Value {
    match value {
        Value::Null | Value::Bool(_) | Value::Number(_) => value,
        Value::String(value) => {
            if should_redact_config_string(&value, identity) {
                warn_config_redaction(identity, field, "credential-shaped string");
                Value::Null
            } else {
                Value::String(value)
            }
        }
        Value::Array(_) | Value::Object(_) => {
            warn_config_redaction(identity, field, "structured value");
            Value::Null
        }
    }
}

fn should_redact_config_string(value: &str, identity: &ConfigOptionIdentity) -> bool {
    let trimmed = value.trim();
    if trimmed.len() > MAX_CANONICAL_CONFIG_STRING_LENGTH
        || trimmed.contains('\n')
        || trimmed.contains('\r')
    {
        return true;
    }

    let field_text = format!(
        "{} {} {}",
        identity.id.to_ascii_lowercase(),
        identity.name.to_ascii_lowercase(),
        identity.category.to_ascii_lowercase()
    );
    if credential_label(&field_text) {
        return true;
    }

    credential_shaped_value(trimmed)
}

fn credential_label(text: &str) -> bool {
    let normalized = text
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character
            } else {
                '_'
            }
        })
        .collect::<String>();
    [
        "api_key",
        "apikey",
        "access_key",
        "accesskey",
        "access_token",
        "refresh_token",
        "auth_token",
        "bearer",
        "credential",
        "oauth",
        "password",
        "private_key",
        "privatekey",
        "secret",
    ]
    .iter()
    .any(|needle| text.contains(needle) || normalized.contains(needle))
}

fn credential_shaped_value(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    lower.starts_with("bearer ")
        || lower.starts_with("basic ")
        || lower.starts_with("sk-")
        || lower.starts_with("ghp_")
        || lower.starts_with("gho_")
        || lower.starts_with("github_pat_")
        || lower.starts_with("xoxb-")
        || looks_like_jwt(value)
}

fn looks_like_jwt(value: &str) -> bool {
    value.starts_with("eyJ") && value.matches('.').count() == 2
}

fn warn_config_redaction(
    identity: &ConfigOptionIdentity,
    field: &'static str,
    reason: &'static str,
) {
    tracing::warn!(
        config_id = %identity.id,
        config_name = %identity.name,
        config_category = %identity.category,
        field,
        reason,
        "Redacting unsafe canonical config option value"
    );
}

#[cfg(test)]
mod tests {
    use super::{sanitize_config_options_for_canonical, ConfigOptionData, ConfigOptionValue};
    use serde_json::{json, Value};

    fn config_option(id: &str, current_value: Value) -> ConfigOptionData {
        ConfigOptionData {
            id: id.to_string(),
            name: id.to_string(),
            category: "general".to_string(),
            option_type: "string".to_string(),
            description: None,
            current_value: Some(current_value),
            options: Vec::new(),
        }
    }

    #[test]
    fn sanitize_config_options_keeps_display_safe_scalar_values() {
        let sanitized = sanitize_config_options_for_canonical(vec![ConfigOptionData {
            id: "max-tokens".to_string(),
            name: "Max tokens".to_string(),
            category: "general".to_string(),
            option_type: "enum".to_string(),
            description: None,
            current_value: Some(json!("4096")),
            options: vec![ConfigOptionValue {
                name: "8192".to_string(),
                value: json!("8192"),
                description: None,
            }],
        }]);

        assert_eq!(
            sanitized[0].current_value,
            Some(Value::String("4096".to_string()))
        );
        assert_eq!(sanitized[0].options[0].value, json!("8192"));
    }

    #[test]
    fn sanitize_config_options_redacts_credential_labels_and_shapes() {
        let sanitized = sanitize_config_options_for_canonical(vec![
            config_option("api-key", json!("not-a-real-token")),
            config_option("runtime-mode", json!("sk-12345678901234567890")),
            config_option("structured", json!({ "nested": "value" })),
        ]);

        assert_eq!(sanitized[0].current_value, Some(Value::Null));
        assert_eq!(sanitized[1].current_value, Some(Value::Null));
        assert_eq!(sanitized[2].current_value, Some(Value::Null));
    }
}
