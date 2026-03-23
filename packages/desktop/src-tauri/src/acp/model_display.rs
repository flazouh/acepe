//! Model display transformation for the model selector UI.
//!
//! Transforms raw `AvailableModel` lists from agents into display-ready structures
//! with pre-computed display names and grouping. The frontend receives `ModelsForDisplay`
//! and renders without parsing model IDs.

use crate::acp::client::AvailableModel;
use crate::acp::parsers::AgentType;
use serde::{Deserialize, Serialize};
use specta::Type;

const CODEX_EFFORTS: &[&str] = &["low", "medium", "high", "xhigh"];

/// Pre-computed model info for display. Frontend uses this directly.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DisplayableModel {
    pub model_id: String,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// Generic group of models. Label can be provider, base model name, or empty.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
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

/// Transforms raw models into display-ready structure per agent.
pub trait ModelsDisplayTransformer: Send + Sync {
    fn agent_type(&self) -> AgentType;
    fn transform(&self, models: &[AvailableModel]) -> ModelsForDisplay;
}

/// Default transformer for OpenCode and Cursor (provider/model format).
struct DefaultTransformer;

impl ModelsDisplayTransformer for DefaultTransformer {
    fn agent_type(&self) -> AgentType {
        AgentType::OpenCode // Used for OpenCode and Cursor
    }

    fn transform(&self, models: &[AvailableModel]) -> ModelsForDisplay {
        let valid: Vec<_> = models.iter().filter(|m| !m.model_id.is_empty()).collect();
        if valid.is_empty() {
            return ModelsForDisplay { groups: vec![] };
        }

        // Single group when model count < 5
        if valid.len() < 5 {
            let models: Vec<DisplayableModel> = valid
                .iter()
                .map(|m| to_displayable_provider(m, None))
                .collect();
            return ModelsForDisplay {
                groups: vec![DisplayModelGroup {
                    label: String::new(),
                    models,
                }],
            };
        }

        // Group by provider
        let mut by_provider: std::collections::BTreeMap<String, Vec<DisplayableModel>> =
            std::collections::BTreeMap::new();
        for m in valid {
            let provider = provider_from_model_id(&m.model_id);
            let dm = to_displayable_provider(m, Some(&provider));
            by_provider.entry(provider).or_default().push(dm);
        }

        let groups: Vec<DisplayModelGroup> = by_provider
            .into_iter()
            .map(|(label, models)| DisplayModelGroup { label, models })
            .collect();

        ModelsForDisplay { groups }
    }
}

/// Claude Code transformer. Derives display name from description; single group.
struct ClaudeCodeTransformer;

impl ModelsDisplayTransformer for ClaudeCodeTransformer {
    fn agent_type(&self) -> AgentType {
        AgentType::ClaudeCode
    }

    fn transform(&self, models: &[AvailableModel]) -> ModelsForDisplay {
        let valid: Vec<_> = models.iter().filter(|m| !m.model_id.is_empty()).collect();
        if valid.is_empty() {
            return ModelsForDisplay { groups: vec![] };
        }

        let models: Vec<DisplayableModel> =
            valid.iter().map(|m| to_displayable_claude(m)).collect();

        ModelsForDisplay {
            groups: vec![DisplayModelGroup {
                label: String::new(),
                models,
            }],
        }
    }
}

/// Codex transformer. Groups by base model; models are effort variants.
struct CodexTransformer;

impl ModelsDisplayTransformer for CodexTransformer {
    fn agent_type(&self) -> AgentType {
        AgentType::Codex
    }

    fn transform(&self, models: &[AvailableModel]) -> ModelsForDisplay {
        let mut by_base: std::collections::BTreeMap<String, Vec<DisplayableModel>> =
            std::collections::BTreeMap::new();

        for m in models.iter().filter(|m| !m.model_id.is_empty()) {
            if let Some((base_id, effort)) = parse_codex_variant(&m.model_id) {
                let display_name = capitalize_effort(&effort).to_string();
                let dm = DisplayableModel {
                    model_id: m.model_id.clone(),
                    display_name,
                    description: m.description.clone(),
                };
                by_base.entry(base_id).or_default().push(dm);
            }
        }

        // Sort variants by effort order within each group
        let groups: Vec<DisplayModelGroup> = by_base
            .into_iter()
            .map(|(base_id, mut variants)| {
                variants.sort_by(|a, b| {
                    let ai = effort_order(a.model_id.rsplit('/').next().unwrap_or(""));
                    let bi = effort_order(b.model_id.rsplit('/').next().unwrap_or(""));
                    ai.cmp(&bi)
                });
                let label = capitalize_base(&base_id);
                DisplayModelGroup {
                    label,
                    models: variants,
                }
            })
            .collect();

        ModelsForDisplay { groups }
    }
}

pub fn get_transformer(agent: AgentType) -> Box<dyn ModelsDisplayTransformer> {
    match agent {
        AgentType::ClaudeCode => Box::new(ClaudeCodeTransformer),
        AgentType::OpenCode | AgentType::Cursor => Box::new(DefaultTransformer),
        AgentType::Codex => Box::new(CodexTransformer),
    }
}

fn to_displayable_provider(m: &AvailableModel, _provider: Option<&str>) -> DisplayableModel {
    let display_name = capitalize_name(&m.name);
    DisplayableModel {
        model_id: m.model_id.clone(),
        display_name,
        description: m.description.clone(),
    }
}

fn to_displayable_claude(m: &AvailableModel) -> DisplayableModel {
    let display_name = if m.model_id == "default" && m.description.as_ref().is_some() {
        if let Some(desc) = &m.description {
            let parts: Vec<&str> = desc.split(" · ").collect();
            if parts.len() >= 2 {
                let first = parts[0].trim();
                if let Some(cap) = first
                    .find("(currently ")
                    .and_then(|i| first.get(i + 11..))
                    .and_then(|s| s.strip_suffix(')'))
                {
                    return DisplayableModel {
                        model_id: m.model_id.clone(),
                        display_name: format!("{} (default)", cap.trim()),
                        description: m.description.clone(),
                    };
                }
                return DisplayableModel {
                    model_id: m.model_id.clone(),
                    display_name: first.to_string(),
                    description: m.description.clone(),
                };
            }
        }
        capitalize_name(&m.name)
    } else if let Some(desc) = &m.description {
        let parts: Vec<&str> = desc.split(" · ").collect();
        if parts.len() >= 2 && !parts[0].trim().is_empty() {
            parts[0].trim().to_string()
        } else {
            capitalize_name(&m.name)
        }
    } else {
        capitalize_name(&m.name)
    };

    DisplayableModel {
        model_id: m.model_id.clone(),
        display_name,
        description: m.description.clone(),
    }
}

fn capitalize_name(s: &str) -> String {
    s.split_whitespace()
        .map(|w| {
            let mut c = w.chars();
            match c.next() {
                None => String::new(),
                Some(f) => f
                    .to_uppercase()
                    .chain(c.flat_map(|c| c.to_lowercase()))
                    .collect(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn capitalize_base(base_id: &str) -> String {
    base_id
        .split('/')
        .next_back()
        .map(capitalize_name)
        .unwrap_or_else(|| capitalize_name(base_id))
}

fn capitalize_effort(effort: &str) -> &str {
    match effort {
        "low" => "Low",
        "medium" => "Medium",
        "high" => "High",
        "xhigh" => "XHigh",
        _ => effort,
    }
}

fn provider_from_model_id(model_id: &str) -> String {
    if model_id == "default" {
        return "Default".to_string();
    }
    let parts: Vec<&str> = model_id.split(&['/', ':', '.'][..]).collect();
    if parts.len() > 1 && !parts[0].is_empty() {
        capitalize_name(parts[0])
    } else {
        "Other".to_string()
    }
}

fn parse_codex_variant(model_id: &str) -> Option<(String, String)> {
    let slash = model_id.rfind('/')?;
    if slash == 0 || slash >= model_id.len() - 1 {
        return None;
    }
    let base = model_id[..slash].to_string();
    let effort = model_id[slash + 1..].to_string();
    if CODEX_EFFORTS.contains(&effort.as_str()) {
        Some((base, effort))
    } else {
        None
    }
}

fn effort_order(effort: &str) -> usize {
    CODEX_EFFORTS
        .iter()
        .position(|&e| e == effort)
        .unwrap_or(usize::MAX)
}

/// Passthrough for agents with no specific logic. Single group, display_name = name.
pub fn passthrough_transform(models: &[AvailableModel]) -> ModelsForDisplay {
    let valid: Vec<_> = models.iter().filter(|m| !m.model_id.is_empty()).collect();
    let models: Vec<DisplayableModel> = valid
        .iter()
        .map(|m| DisplayableModel {
            model_id: m.model_id.clone(),
            display_name: m.name.clone(),
            description: m.description.clone(),
        })
        .collect();
    ModelsForDisplay {
        groups: vec![DisplayModelGroup {
            label: String::new(),
            models,
        }],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::parsers::AgentType;

    fn am(id: &str, name: &str, desc: Option<&str>) -> AvailableModel {
        AvailableModel {
            model_id: id.to_string(),
            name: name.to_string(),
            description: desc.map(|s| s.to_string()),
        }
    }

    // ---- DefaultTransformer ----

    #[test]
    fn default_transformer_empty_returns_no_groups() {
        let t = DefaultTransformer;
        let out = t.transform(&[]);
        assert_eq!(out.groups.len(), 0);
    }

    #[test]
    fn default_transformer_empty_model_id_filtered() {
        let t = DefaultTransformer;
        let models = vec![
            am("", "Empty", None),
            am("anthropic/claude-4", "Claude 4", None),
        ];
        let out = t.transform(&models);
        assert_eq!(out.groups.len(), 1);
        assert_eq!(out.groups[0].models.len(), 1);
        assert_eq!(out.groups[0].models[0].model_id, "anthropic/claude-4");
    }

    #[test]
    fn default_transformer_all_empty_model_ids_returns_empty() {
        let t = DefaultTransformer;
        let models = vec![am("", "Empty1", None), am("", "Empty2", None)];
        let out = t.transform(&models);
        assert_eq!(out.groups.len(), 0);
    }

    #[test]
    fn default_transformer_single_model() {
        let t = DefaultTransformer;
        let models = vec![am("anthropic/claude-4", "Claude 4", None)];
        let out = t.transform(&models);
        assert_eq!(out.groups.len(), 1);
        assert!(out.groups[0].label.is_empty());
        assert_eq!(out.groups[0].models.len(), 1);
        assert_eq!(out.groups[0].models[0].display_name, "Claude 4");
    }

    #[test]
    fn default_transformer_four_models_single_group() {
        let t = DefaultTransformer;
        let models = vec![
            am("anthropic/claude-4", "Claude 4", None),
            am("openai:gpt-4", "GPT-4", None),
            am("google/gemini-2", "Gemini 2", None),
            am("meta.llama/llama-3", "Llama 3", None),
        ];
        let out = t.transform(&models);
        assert_eq!(out.groups.len(), 1);
        assert!(out.groups[0].label.is_empty());
        assert_eq!(out.groups[0].models.len(), 4);
    }

    #[test]
    fn default_transformer_five_plus_models_grouped_by_provider() {
        let t = DefaultTransformer;
        let models = vec![
            am("anthropic/claude-4", "Claude 4", None),
            am("anthropic/claude-3", "Claude 3", None),
            am("openai:gpt-4", "GPT-4", None),
            am("openai:gpt-3.5", "GPT-3.5", None),
            am("google/gemini-2", "Gemini 2", None),
        ];
        let out = t.transform(&models);
        assert_eq!(out.groups.len(), 3);
        let labels: Vec<&str> = out.groups.iter().map(|g| g.label.as_str()).collect();
        assert!(labels.contains(&"Anthropic"));
        assert!(labels.contains(&"Openai"));
        assert!(labels.contains(&"Google"));
    }

    #[test]
    fn default_transformer_provider_extraction_slash() {
        let t = DefaultTransformer;
        let models = vec![am("anthropic/claude-4", "Claude 4", None)];
        let out = t.transform(&models);
        assert_eq!(out.groups[0].models[0].model_id, "anthropic/claude-4");
        assert_eq!(out.groups[0].models[0].display_name, "Claude 4");
    }

    #[test]
    fn default_transformer_provider_extraction_colon() {
        let t = DefaultTransformer;
        let models = vec![am("openai:gpt-4", "GPT-4", None)];
        let out = t.transform(&models);
        assert_eq!(out.groups.len(), 1);
    }

    #[test]
    fn default_transformer_provider_extraction_dot() {
        let t = DefaultTransformer;
        let models = vec![am("meta.llama/llama-3", "Llama 3", None)];
        let out = t.transform(&models);
        assert_eq!(out.groups.len(), 1);
    }

    #[test]
    fn default_transformer_default_becomes_default_label() {
        let t = DefaultTransformer;
        let models = vec![
            am("default", "Default", Some("Default model")),
            am("anthropic/claude-4", "Claude 4", None),
            am("openai:gpt-4", "GPT-4", None),
            am("google/gemini", "Gemini", None),
            am("meta/llama", "Llama", None),
            am("other", "Other", None),
        ];
        let out = t.transform(&models);
        let labels: Vec<&str> = out.groups.iter().map(|g| g.label.as_str()).collect();
        assert!(labels.contains(&"Default"));
    }

    #[test]
    fn default_transformer_other_for_no_separator() {
        let t = DefaultTransformer;
        let models = vec![
            am("nomodel", "No Model", None),
            am("single", "Single", None),
            am("a", "A", None),
            am("b", "B", None),
            am("c", "C", None),
        ];
        let out = t.transform(&models);
        let labels: Vec<&str> = out.groups.iter().map(|g| g.label.as_str()).collect();
        assert!(labels.contains(&"Other"));
    }

    #[test]
    fn default_transformer_agent_type() {
        let t = DefaultTransformer;
        assert_eq!(t.agent_type(), AgentType::OpenCode);
    }

    // ---- ClaudeCodeTransformer ----

    #[test]
    fn claude_transformer_empty_returns_no_groups() {
        let t = ClaudeCodeTransformer;
        let out = t.transform(&[]);
        assert_eq!(out.groups.len(), 0);
    }

    #[test]
    fn claude_transformer_empty_model_id_filtered() {
        let t = ClaudeCodeTransformer;
        let models = vec![am("", "Empty", None), am("opus", "Opus", None)];
        let out = t.transform(&models);
        assert_eq!(out.groups[0].models.len(), 1);
        assert_eq!(out.groups[0].models[0].model_id, "opus");
    }

    #[test]
    fn claude_transformer_default_extracts_currently_from_description() {
        let t = ClaudeCodeTransformer;
        let models = vec![am(
            "default",
            "Default",
            Some(
                "Use the default model (currently claude-sonnet-4) · Uses your configured default",
            ),
        )];
        let out = t.transform(&models);
        assert_eq!(out.groups.len(), 1);
        assert_eq!(
            out.groups[0].models[0].display_name,
            "claude-sonnet-4 (default)"
        );
    }

    #[test]
    fn claude_transformer_default_description_x_dot_y_uses_first_part() {
        let t = ClaudeCodeTransformer;
        let models = vec![am(
            "default",
            "Default",
            Some("Claude Opus · Best for complex tasks"),
        )];
        let out = t.transform(&models);
        assert_eq!(out.groups[0].models[0].display_name, "Claude Opus");
    }

    #[test]
    fn claude_transformer_default_single_part_description_uses_name() {
        let t = ClaudeCodeTransformer;
        let models = vec![am("default", "Default", Some("Single part only"))];
        let out = t.transform(&models);
        assert_eq!(out.groups[0].models[0].display_name, "Default");
    }

    #[test]
    fn claude_transformer_opus_no_description_uses_name() {
        let t = ClaudeCodeTransformer;
        let models = vec![am("opus", "Claude Opus 4.5", None)];
        let out = t.transform(&models);
        assert_eq!(out.groups[0].models[0].display_name, "Claude Opus 4.5");
    }

    #[test]
    fn claude_transformer_description_x_dot_y_uses_a() {
        let t = ClaudeCodeTransformer;
        let models = vec![am(
            "sonnet",
            "Claude Sonnet",
            Some("Claude Sonnet 4 · Fast and capable"),
        )];
        let out = t.transform(&models);
        assert_eq!(out.groups[0].models[0].display_name, "Claude Sonnet 4");
    }

    #[test]
    fn claude_transformer_description_empty_first_part_uses_name() {
        let t = ClaudeCodeTransformer;
        let models = vec![am("sonnet", "Claude Sonnet", Some(" · Second part only"))];
        let out = t.transform(&models);
        assert_eq!(out.groups[0].models[0].display_name, "Claude Sonnet");
    }

    #[test]
    fn claude_transformer_no_description_fallback_to_name() {
        let t = ClaudeCodeTransformer;
        let models = vec![am("custom", "My Custom Model", None)];
        let out = t.transform(&models);
        assert_eq!(out.groups[0].models[0].display_name, "My Custom Model");
    }

    #[test]
    fn claude_transformer_single_group() {
        let t = ClaudeCodeTransformer;
        let models = vec![am("opus", "Opus", None), am("sonnet", "Sonnet", None)];
        let out = t.transform(&models);
        assert_eq!(out.groups.len(), 1);
        assert!(out.groups[0].label.is_empty());
        assert_eq!(out.groups[0].models.len(), 2);
    }

    #[test]
    fn claude_transformer_agent_type() {
        let t = ClaudeCodeTransformer;
        assert_eq!(t.agent_type(), AgentType::ClaudeCode);
    }

    #[test]
    fn claude_transformer_capitalize_name() {
        let t = ClaudeCodeTransformer;
        let models = vec![am("m", "lowercase name", None)];
        let out = t.transform(&models);
        assert_eq!(out.groups[0].models[0].display_name, "Lowercase Name");
    }

    // ---- CodexTransformer ----

    #[test]
    fn codex_transformer_empty_returns_no_groups() {
        let t = CodexTransformer;
        let out = t.transform(&[]);
        assert_eq!(out.groups.len(), 0);
    }

    #[test]
    fn codex_transformer_empty_model_id_filtered() {
        let t = CodexTransformer;
        let models = vec![am("", "Empty", None), am("claude-sonnet/low", "Low", None)];
        let out = t.transform(&models);
        assert_eq!(out.groups[0].models.len(), 1);
    }

    #[test]
    fn codex_transformer_valid_variants() {
        let t = CodexTransformer;
        let models = vec![
            am("claude-sonnet/low", "Low", None),
            am("claude-sonnet/medium", "Medium", None),
            am("claude-sonnet/high", "High", None),
            am("claude-sonnet/xhigh", "XHigh", None),
        ];
        let out = t.transform(&models);
        assert_eq!(out.groups.len(), 1);
        assert_eq!(out.groups[0].label, "Claude-sonnet");
        assert_eq!(out.groups[0].models.len(), 4);
        let names: Vec<&str> = out.groups[0]
            .models
            .iter()
            .map(|m| m.display_name.as_str())
            .collect();
        assert_eq!(names, ["Low", "Medium", "High", "XHigh"]);
    }

    #[test]
    fn codex_transformer_malformed_filtered() {
        let t = CodexTransformer;
        let models = vec![
            am("claude-sonnet/low", "Low", None),
            am("invalid", "Invalid", None),
            am("claude-sonnet/", "Missing effort", None),
            am("/low", "Missing base", None),
            am("claude-sonnet/unknown", "Unknown effort", None),
        ];
        let out = t.transform(&models);
        assert_eq!(out.groups.len(), 1);
        assert_eq!(out.groups[0].models.len(), 1);
        assert_eq!(out.groups[0].models[0].model_id, "claude-sonnet/low");
    }

    #[test]
    fn codex_transformer_effort_order() {
        let t = CodexTransformer;
        let models = vec![
            am("claude-sonnet/xhigh", "XHigh", None),
            am("claude-sonnet/low", "Low", None),
            am("claude-sonnet/high", "High", None),
            am("claude-sonnet/medium", "Medium", None),
        ];
        let out = t.transform(&models);
        let order: Vec<&str> = out.groups[0]
            .models
            .iter()
            .map(|m| m.display_name.as_str())
            .collect();
        assert_eq!(order, ["Low", "Medium", "High", "XHigh"]);
    }

    #[test]
    fn codex_transformer_multiple_bases() {
        let t = CodexTransformer;
        let models = vec![
            am("claude-sonnet/medium", "Medium", None),
            am("claude-sonnet/low", "Low", None),
            am("claude-opus/high", "High", None),
            am("claude-haiku/low", "Low", None),
        ];
        let out = t.transform(&models);
        assert_eq!(out.groups.len(), 3);
        let sonnet = out
            .groups
            .iter()
            .find(|g| g.label == "Claude-sonnet")
            .unwrap();
        let opus = out
            .groups
            .iter()
            .find(|g| g.label == "Claude-opus")
            .unwrap();
        let haiku = out
            .groups
            .iter()
            .find(|g| g.label == "Claude-haiku")
            .unwrap();
        assert_eq!(sonnet.models.len(), 2);
        assert_eq!(opus.models.len(), 1);
        assert_eq!(haiku.models.len(), 1);
    }

    #[test]
    fn codex_transformer_unknown_effort_filtered() {
        let t = CodexTransformer;
        let models = vec![
            am("claude-sonnet/low", "Low", None),
            am("claude-sonnet/ultra", "Ultra", None),
        ];
        let out = t.transform(&models);
        assert_eq!(out.groups[0].models.len(), 1);
        assert_eq!(out.groups[0].models[0].model_id, "claude-sonnet/low");
    }

    #[test]
    fn codex_transformer_agent_type() {
        let t = CodexTransformer;
        assert_eq!(t.agent_type(), AgentType::Codex);
    }

    #[test]
    fn codex_transformer_base_with_slashes_uses_last_part() {
        let t = CodexTransformer;
        let models = vec![am("org/claude-sonnet/low", "Low", None)];
        let out = t.transform(&models);
        assert_eq!(out.groups.len(), 1);
        assert_eq!(out.groups[0].label, "Claude-sonnet");
    }

    // ---- get_transformer ----

    #[test]
    fn get_transformer_claude_code() {
        let t = get_transformer(AgentType::ClaudeCode);
        assert_eq!(t.agent_type(), AgentType::ClaudeCode);
        let out = t.transform(&[am("default", "Default", None)]);
        assert_eq!(out.groups.len(), 1);
    }

    #[test]
    fn get_transformer_open_code() {
        let t = get_transformer(AgentType::OpenCode);
        assert_eq!(t.agent_type(), AgentType::OpenCode);
        let out = t.transform(&[am("anthropic/claude-4", "Claude 4", None)]);
        assert_eq!(out.groups.len(), 1);
    }

    #[test]
    fn get_transformer_cursor() {
        let t = get_transformer(AgentType::Cursor);
        assert_eq!(t.agent_type(), AgentType::OpenCode);
        let out = t.transform(&[am("anthropic/claude-4", "Claude 4", None)]);
        assert_eq!(out.groups.len(), 1);
    }

    #[test]
    fn get_transformer_codex() {
        let t = get_transformer(AgentType::Codex);
        assert_eq!(t.agent_type(), AgentType::Codex);
        let out = t.transform(&[am("claude-sonnet/low", "Low", None)]);
        assert_eq!(out.groups.len(), 1);
    }

    // ---- passthrough_transform ----

    #[test]
    fn passthrough_transform_empty() {
        let out = passthrough_transform(&[]);
        assert_eq!(out.groups.len(), 1);
        assert!(out.groups[0].models.is_empty());
    }

    #[test]
    fn passthrough_transform_single_group() {
        let models = vec![
            am("model-1", "Model One", None),
            am("model-2", "Model Two", Some("Desc")),
        ];
        let out = passthrough_transform(&models);
        assert_eq!(out.groups.len(), 1);
        assert!(out.groups[0].label.is_empty());
        assert_eq!(out.groups[0].models.len(), 2);
    }

    #[test]
    fn passthrough_transform_display_name_equals_name() {
        let models = vec![am("id", "Display Name Here", Some("Description"))];
        let out = passthrough_transform(&models);
        assert_eq!(out.groups[0].models[0].display_name, "Display Name Here");
        assert_eq!(out.groups[0].models[0].model_id, "id");
        assert_eq!(
            out.groups[0].models[0].description,
            Some("Description".to_string())
        );
    }

    #[test]
    fn passthrough_transform_empty_model_id_filtered() {
        let models = vec![am("", "Empty", None), am("valid", "Valid", None)];
        let out = passthrough_transform(&models);
        assert_eq!(out.groups[0].models.len(), 1);
        assert_eq!(out.groups[0].models[0].model_id, "valid");
    }

    // ---- ModelsForDisplay Default ----

    #[test]
    fn models_for_display_default() {
        let d = ModelsForDisplay::default();
        assert!(d.groups.is_empty());
    }
}
