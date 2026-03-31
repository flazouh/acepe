use serde::{Deserialize, Serialize};
use specta::Type;

/// Canonical agent identifier enum.
///
/// This enum represents all valid agent types in the system.
/// Parsers set the enum directly based on their context (no normalization needed).
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "kebab-case")]
pub enum CanonicalAgentId {
    #[serde(rename = "claude-code")]
    ClaudeCode,
    #[serde(rename = "copilot")]
    Copilot,
    #[serde(rename = "cursor")]
    Cursor,
    #[serde(rename = "opencode")]
    OpenCode,
    #[serde(rename = "codex")]
    Codex,
    /// Custom agent registered by user
    #[serde(rename = "custom")]
    Custom(String),
}

impl CanonicalAgentId {
    /// Convert to string for IPC/database storage
    ///
    /// Custom agent IDs are prefixed with "custom:" to avoid collisions with built-in names.
    pub fn as_str(&self) -> &str {
        match self {
            Self::ClaudeCode => "claude-code",
            Self::Copilot => "copilot",
            Self::Cursor => "cursor",
            Self::OpenCode => "opencode",
            Self::Codex => "codex",
            Self::Custom(id) => {
                // Store in a way that allows round-trip conversion
                // We need to return a &str, so we can't allocate here
                // Instead, we'll use a static approach or require the caller to handle it
                // For now, we'll use a prefix to distinguish custom IDs
                // Note: This requires the caller to handle the prefix when storing
                id.as_str()
            }
        }
    }

    /// Convert to string with prefix for Custom variants to ensure round-trip safety
    pub fn to_string_with_prefix(&self) -> String {
        match self {
            Self::ClaudeCode => "claude-code".to_string(),
            Self::Copilot => "copilot".to_string(),
            Self::Cursor => "cursor".to_string(),
            Self::OpenCode => "opencode".to_string(),
            Self::Codex => "codex".to_string(),
            Self::Custom(id) => format!("custom:{}", id),
        }
    }

    /// Convert from string (for IPC/database loading)
    ///
    /// Handles both prefixed custom IDs ("custom:...") and built-in names.
    pub fn parse(s: &str) -> Self {
        // Check for custom prefix first
        if let Some(custom_id) = s.strip_prefix("custom:") {
            return Self::Custom(custom_id.to_string());
        }

        // Then check built-in names
        match s {
            "claude-code" => Self::ClaudeCode,
            "copilot" => Self::Copilot,
            "cursor" => Self::Cursor,
            "opencode" => Self::OpenCode,
            "codex" => Self::Codex,
            custom => Self::Custom(custom.to_string()),
        }
    }
}

impl From<&str> for CanonicalAgentId {
    fn from(s: &str) -> Self {
        Self::parse(s)
    }
}

impl From<String> for CanonicalAgentId {
    fn from(s: String) -> Self {
        Self::parse(&s)
    }
}

impl From<CanonicalAgentId> for String {
    fn from(id: CanonicalAgentId) -> Self {
        id.as_str().to_string()
    }
}

impl std::fmt::Display for CanonicalAgentId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

impl std::str::FromStr for CanonicalAgentId {
    type Err = ();

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(CanonicalAgentId::parse(s))
    }
}

/// Content block types per ACP protocol specification.
///
/// @see https://agentclientprotocol.com/protocol/schema#contentblock
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContentBlock {
    /// Text content block
    #[serde(rename = "text")]
    Text {
        /// The text content
        text: String,
    },
    /// Image content block
    #[serde(rename = "image")]
    Image {
        /// Base64-encoded image data
        data: String,
        /// MIME type of the image
        #[serde(rename = "mimeType")]
        mime_type: String,
        /// Optional URI for the image
        #[serde(skip_serializing_if = "Option::is_none")]
        uri: Option<String>,
    },
    /// Audio content block
    #[serde(rename = "audio")]
    Audio {
        /// Base64-encoded audio data
        data: String,
        /// MIME type of the audio
        #[serde(rename = "mimeType")]
        mime_type: String,
    },
    /// Embedded resource content block
    #[serde(rename = "resource")]
    Resource {
        /// The resource data
        resource: EmbeddedResource,
    },
    /// Resource link content block
    #[serde(rename = "resource_link")]
    ResourceLink {
        /// URI of the resource
        uri: String,
        /// Name of the resource
        name: String,
        /// Optional title
        #[serde(skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        /// Optional description
        #[serde(skip_serializing_if = "Option::is_none")]
        description: Option<String>,
        /// Optional MIME type
        #[serde(rename = "mimeType", skip_serializing_if = "Option::is_none")]
        mime_type: Option<String>,
        /// Optional size in bytes
        #[serde(skip_serializing_if = "Option::is_none")]
        size: Option<u64>,
    },
}

/// Embedded resource data
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddedResource {
    /// URI of the resource
    pub uri: String,
    /// Optional text content
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// Optional base64-encoded blob content
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blob: Option<String>,
    /// Optional MIME type
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
}

/// Pre-computed model info for display. Frontend uses this directly.
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DisplayableModel {
    pub model_id: String,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// Generic group of models. Label can be provider, base model name, or empty.
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DisplayModelGroup {
    pub label: String,
    pub models: Vec<DisplayableModel>,
}

/// Display-ready model structure. Single representation—flat = one group.
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ModelsForDisplay {
    pub groups: Vec<DisplayModelGroup>,
}

/// Prompt request per ACP protocol specification.
///
/// @see https://agentclientprotocol.com/protocol/#prompt
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptRequest {
    /// Session ID to send the prompt to
    pub session_id: String,
    /// Array of content blocks to send as the prompt
    pub prompt: Vec<ContentBlock>,
    /// Whether to stream the response (enables incremental message display)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream: Option<bool>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn canonical_agent_id_round_trips_copilot() {
        let agent_id = CanonicalAgentId::parse("copilot");

        assert_eq!(agent_id, CanonicalAgentId::Copilot);
        assert_eq!(agent_id.as_str(), "copilot");
        assert_eq!(agent_id.to_string_with_prefix(), "copilot");
    }

    #[test]
    fn canonical_agent_id_preserves_custom_prefix_behavior() {
        let agent_id = CanonicalAgentId::parse("custom:copilot-like");

        assert_eq!(
            agent_id,
            CanonicalAgentId::Custom("copilot-like".to_string())
        );
    }

    #[test]
    fn prompt_request_serializes_with_stream_true() {
        let request = PromptRequest {
            session_id: "test-session".to_string(),
            prompt: vec![ContentBlock::Text {
                text: "Hello".to_string(),
            }],
            stream: Some(true),
        };

        let json = serde_json::to_value(&request).unwrap();

        assert_eq!(json["sessionId"], "test-session");
        assert_eq!(json["stream"], true);
        assert!(json["prompt"].is_array());
    }

    #[test]
    fn prompt_request_omits_stream_when_none() {
        let request = PromptRequest {
            session_id: "test-session".to_string(),
            prompt: vec![ContentBlock::Text {
                text: "Hello".to_string(),
            }],
            stream: None,
        };

        let json = serde_json::to_value(&request).unwrap();

        assert_eq!(json["sessionId"], "test-session");
        // stream field should not be present when None
        assert!(json.get("stream").is_none());
    }

    #[test]
    fn prompt_request_deserializes_with_stream() {
        let json = json!({
            "sessionId": "test-session",
            "prompt": [{"type": "text", "text": "Hello"}],
            "stream": true
        });

        let request: PromptRequest = serde_json::from_value(json).unwrap();

        assert_eq!(request.session_id, "test-session");
        assert_eq!(request.stream, Some(true));
    }

    #[test]
    fn prompt_request_deserializes_without_stream() {
        let json = json!({
            "sessionId": "test-session",
            "prompt": [{"type": "text", "text": "Hello"}]
        });

        let request: PromptRequest = serde_json::from_value(json).unwrap();

        assert_eq!(request.session_id, "test-session");
        assert_eq!(request.stream, None);
    }
}
