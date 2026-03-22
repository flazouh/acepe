use serde::{Deserialize, Serialize};
use specta::Type;

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
    pub value: serde_json::Value,
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
    pub current_value: Option<serde_json::Value>,
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
    let items: Vec<serde_json::Value> = match Vec::<serde_json::Value>::deserialize(deserializer) {
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
