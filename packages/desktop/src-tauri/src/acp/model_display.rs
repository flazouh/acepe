//! Model display transformation for the model selector UI.
//!
//! Transforms raw `AvailableModel` lists from agents into display-ready structures
//! with pre-computed display names and grouping. The frontend receives `ModelsForDisplay`
//! and renders without parsing model IDs.

use crate::acp::client::AvailableModel;
use crate::session_jsonl::display_names::format_model_display_name;
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

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ModelDisplayFamily {
    ClaudeLike,
    CodexReasoningEffort,
    #[default]
    ProviderGrouped,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum UsageMetricsPresentation {
    ContextWindowOnly,
    #[default]
    SpendAndContext,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ModelPresentationMetadata {
    pub display_family: ModelDisplayFamily,
    pub usage_metrics: UsageMetricsPresentation,
}

/// Display-ready model structure. Single representation—flat = one group.
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ModelsForDisplay {
    pub groups: Vec<DisplayModelGroup>,
    #[serde(default)]
    pub presentation: ModelPresentationMetadata,
}

/// Transforms raw models into display-ready structure per agent.
pub trait ModelsDisplayTransformer: Send + Sync {
    fn transform(&self, models: &[AvailableModel]) -> ModelsForDisplay;
}

/// Default transformer for OpenCode and Cursor (provider/model format).
struct DefaultTransformer;

impl ModelsDisplayTransformer for DefaultTransformer {
    fn transform(&self, models: &[AvailableModel]) -> ModelsForDisplay {
        let valid: Vec<_> = models.iter().filter(|m| !m.model_id.is_empty()).collect();
        if valid.is_empty() {
            return ModelsForDisplay {
                groups: vec![],
                ..Default::default()
            };
        }

        // Single group when model count < 5
        if valid.len() < 5 {
            let models = disambiguate_display_names(
                valid
                    .iter()
                    .map(|m| to_displayable_provider(m, None))
                    .collect(),
                None,
            );
            return ModelsForDisplay {
                groups: vec![DisplayModelGroup {
                    label: String::new(),
                    models,
                }],
                ..Default::default()
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
            .map(|(label, models)| DisplayModelGroup {
                models: disambiguate_display_names(models, Some(&label)),
                label,
            })
            .collect();

        ModelsForDisplay {
            groups,
            ..Default::default()
        }
    }
}

/// Claude Code transformer. Derives display name from description; single group.
struct ClaudeCodeTransformer;

impl ModelsDisplayTransformer for ClaudeCodeTransformer {
    fn transform(&self, models: &[AvailableModel]) -> ModelsForDisplay {
        let valid: Vec<_> = models.iter().filter(|m| !m.model_id.is_empty()).collect();
        if valid.is_empty() {
            return ModelsForDisplay {
                groups: vec![],
                ..Default::default()
            };
        }

        let models: Vec<DisplayableModel> =
            valid.iter().map(|m| to_displayable_claude(m)).collect();

        ModelsForDisplay {
            groups: vec![DisplayModelGroup {
                label: String::new(),
                models,
            }],
            ..Default::default()
        }
    }
}

/// Codex transformer. Groups by base model; models are effort variants.
struct CodexTransformer;

impl ModelsDisplayTransformer for CodexTransformer {
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

        ModelsForDisplay {
            groups,
            ..Default::default()
        }
    }
}

fn get_transformer(family: ModelDisplayFamily) -> Box<dyn ModelsDisplayTransformer> {
    match family {
        ModelDisplayFamily::ClaudeLike => Box::new(ClaudeCodeTransformer),
        ModelDisplayFamily::CodexReasoningEffort => Box::new(CodexTransformer),
        ModelDisplayFamily::ProviderGrouped => Box::new(DefaultTransformer),
    }
}

pub fn build_models_for_display(
    models: &[AvailableModel],
    presentation: ModelPresentationMetadata,
) -> ModelsForDisplay {
    let mut display = get_transformer(presentation.display_family).transform(models);
    display.presentation = presentation;
    display
}

fn to_displayable_provider(m: &AvailableModel, _provider: Option<&str>) -> DisplayableModel {
    let display_name = capitalize_name(&m.name);
    DisplayableModel {
        model_id: m.model_id.clone(),
        display_name,
        description: m.description.clone(),
    }
}

fn disambiguate_display_names(
    models: Vec<DisplayableModel>,
    provider: Option<&str>,
) -> Vec<DisplayableModel> {
    let original_counts =
        count_display_names(models.iter().map(|model| model.display_name.as_str()));
    let candidate_models: Vec<(DisplayableModel, String)> = models
        .into_iter()
        .map(|model| {
            let key = normalize_display_name_key(&model.display_name);
            let candidate = if (original_counts.get(&key).copied().unwrap_or(0)) > 1 {
                preferred_collision_display_name(&model)
            } else {
                model.display_name.clone()
            };
            (model, candidate)
        })
        .collect();

    let candidate_counts = count_display_names(
        candidate_models
            .iter()
            .map(|(_, candidate)| candidate.as_str()),
    );

    let disambiguated: Vec<(DisplayableModel, String)> = candidate_models
        .into_iter()
        .map(|(mut model, candidate)| {
            let key = normalize_display_name_key(&candidate);
            if (candidate_counts.get(&key).copied().unwrap_or(0)) > 1 {
                let suffix = build_disambiguation_suffix(&model.model_id, provider);
                if suffix.is_empty() || same_display_name(&suffix, &candidate) {
                    model.display_name = format!("{} · {}", candidate, model.model_id);
                } else {
                    model.display_name = format!("{} · {}", candidate, suffix);
                }
            } else {
                model.display_name = candidate.clone();
            }
            (model, candidate)
        })
        .collect();

    let final_counts = count_display_names(
        disambiguated
            .iter()
            .map(|(model, _)| model.display_name.as_str()),
    );

    disambiguated
        .into_iter()
        .map(|(mut model, candidate)| {
            let key = normalize_display_name_key(&model.display_name);
            if (final_counts.get(&key).copied().unwrap_or(0)) > 1 {
                model.display_name = format!("{} · {}", candidate, model.model_id);
            }
            model
        })
        .collect()
}

fn count_display_names<'a>(
    names: impl Iterator<Item = &'a str>,
) -> std::collections::BTreeMap<String, usize> {
    let mut counts = std::collections::BTreeMap::new();
    for name in names {
        let key = normalize_display_name_key(name);
        counts
            .entry(key)
            .and_modify(|count| *count += 1)
            .or_insert(1);
    }
    counts
}

fn normalize_display_name_key(name: &str) -> String {
    name.trim().to_lowercase()
}

fn same_display_name(left: &str, right: &str) -> bool {
    normalize_display_name_key(left) == normalize_display_name_key(right)
}

fn preferred_collision_display_name(model: &DisplayableModel) -> String {
    if !is_claude_like_model_id(&model.model_id) {
        return model.display_name.clone();
    }

    let formatted = format_model_display_name(&model.model_id);
    if same_display_name(&formatted, &model.display_name) {
        model.display_name.clone()
    } else {
        formatted
    }
}

fn is_claude_like_model_id(model_id: &str) -> bool {
    let tokens: Vec<String> = model_id
        .split(&['/', ':', '.', '-', '_'][..])
        .map(|part| part.to_ascii_lowercase())
        .collect();
    if tokens.iter().any(|token| token == "claude") {
        return true;
    }

    let Some(family_index) = tokens
        .iter()
        .position(|token| token == "opus" || token == "sonnet" || token == "haiku")
    else {
        return false;
    };

    tokens[family_index + 1..]
        .iter()
        .any(|token| token.chars().all(|ch| ch.is_ascii_digit()))
}

fn build_disambiguation_suffix(model_id: &str, provider: Option<&str>) -> String {
    let stripped = strip_provider_prefix(model_id, provider);
    let normalized = stripped
        .replace(['/', ':', '.', '_'], "-")
        .trim_matches('-')
        .to_string();
    if normalized.is_empty() {
        return model_id.to_string();
    }

    if let Some(suffix) = extract_claude_variant_suffix(&normalized) {
        return suffix;
    }

    normalized
}

fn strip_provider_prefix<'a>(model_id: &'a str, provider: Option<&str>) -> &'a str {
    let Some(provider_label) = provider else {
        return model_id;
    };

    let provider_key = provider_label.to_ascii_lowercase().replace(' ', "");
    let lower = model_id.to_ascii_lowercase();
    for separator in ["/", ":", ".", "-"] {
        let prefix = format!("{}{}", provider_key, separator);
        if lower.starts_with(&prefix) {
            return &model_id[prefix.len()..];
        }
    }

    model_id
}

fn extract_claude_variant_suffix(model_id: &str) -> Option<String> {
    let tokens: Vec<&str> = model_id
        .split('-')
        .filter(|token| !token.is_empty())
        .collect();
    let family_index = tokens.iter().position(|token| {
        matches!(
            token.to_ascii_lowercase().as_str(),
            "opus" | "sonnet" | "haiku"
        )
    })?;

    let suffix_tokens: Vec<&str> = tokens[family_index + 1..]
        .iter()
        .copied()
        .skip_while(|token| {
            let lower = token.to_ascii_lowercase();
            lower.chars().all(|ch| ch.is_ascii_digit())
                || (lower.len() == 8 && lower.chars().all(|ch| ch.is_ascii_digit()))
        })
        .collect();

    if suffix_tokens.is_empty() {
        return None;
    }

    Some(suffix_tokens.join("-"))
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
    let lower = model_id.to_ascii_lowercase();
    if lower == "default" {
        return "Default".to_string();
    }
    if lower == "auto" {
        return "Auto".to_string();
    }

    // Known model-family prefixes. Matches Cursor-style bare IDs like
    // `claude-4.6-sonnet-medium`, `gpt-5.4-mini-low`, `grok-4-20`, `kimi-k2.5`.
    for (needle, label) in [
        ("anthropic", "Anthropic"),
        ("claude", "Anthropic"),
        ("opus", "Anthropic"),
        ("sonnet", "Anthropic"),
        ("haiku", "Anthropic"),
        ("openai", "OpenAI"),
        ("gpt", "OpenAI"),
        ("codex", "OpenAI"),
        ("o1-", "OpenAI"),
        ("o3-", "OpenAI"),
        ("o4-", "OpenAI"),
        ("google", "Google"),
        ("gemini", "Google"),
        ("xai", "xAI"),
        ("grok", "xAI"),
        ("kimi", "Moonshot"),
        ("moonshot", "Moonshot"),
        ("meta", "Meta"),
        ("llama", "Meta"),
        ("mistral", "Mistral"),
        ("deepseek", "DeepSeek"),
        ("qwen", "Qwen"),
        ("composer", "Cursor"),
    ] {
        if lower.contains(needle) {
            return label.to_string();
        }
    }

    // Fall back to explicit provider/model separators. `.` is intentionally not
    // treated as a separator: it's a version marker inside IDs like `gpt-5.4`
    // or `claude-4.6-sonnet`, not a provider boundary.
    let parts: Vec<&str> = model_id.split(&['/', ':'][..]).collect();
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
        ..Default::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
        assert!(labels.contains(&"OpenAI"));
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
    fn default_transformer_groups_cursor_style_ids_by_family_not_dot_split() {
        let t = DefaultTransformer;
        let models = vec![
            am("claude-4.6-sonnet-medium", "Sonnet 4.6", None),
            am("claude-4.5-opus-high", "Opus 4.5", None),
            am("claude-opus-4-7-high", "Opus 4.7 High", None),
            am("gpt-5.4-high", "GPT-5.4 High", None),
            am("gpt-5.4-mini-low", "GPT-5.4 Mini Low", None),
            am("gemini-3-flash", "Gemini 3 Flash", None),
            am("grok-4-20", "Grok 4.20", None),
            am("kimi-k2.5", "Kimi K2.5", None),
            am("composer-2", "Composer 2", None),
            am("auto", "Auto", None),
        ];
        let out = t.transform(&models);
        let labels: Vec<&str> = out.groups.iter().map(|g| g.label.as_str()).collect();

        // No version-split artifacts like "Claude-4" or "Gpt-5".
        assert!(
            !labels
                .iter()
                .any(|l| l.starts_with("Claude-") || l.starts_with("Gpt-")),
            "labels must not contain version-split prefixes, got {labels:?}"
        );
        assert!(
            labels.contains(&"Anthropic"),
            "expected Anthropic in {labels:?}"
        );
        assert!(labels.contains(&"OpenAI"), "expected OpenAI in {labels:?}");
        assert!(labels.contains(&"Google"), "expected Google in {labels:?}");
        assert!(labels.contains(&"xAI"), "expected xAI in {labels:?}");
        assert!(
            labels.contains(&"Moonshot"),
            "expected Moonshot in {labels:?}"
        );
        assert!(labels.contains(&"Cursor"), "expected Cursor in {labels:?}");
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
    fn default_transformer_small_list_disambiguates_duplicate_claude_names() {
        let t = DefaultTransformer;
        let models = vec![
            am("anthropic/claude-opus-4-1", "Opus", None),
            am("anthropic/claude-opus-4-5", "Opus", None),
            am("openai:gpt-4.1", "GPT 4.1", None),
        ];
        let out = t.transform(&models);
        let display_names: Vec<&str> = out.groups[0]
            .models
            .iter()
            .map(|model| model.display_name.as_str())
            .collect();
        assert!(display_names.contains(&"Opus 4.1"));
        assert!(display_names.contains(&"Opus 4.5"));
        assert_eq!(display_names.len(), 3);
    }

    #[test]
    fn default_transformer_grouped_provider_models_use_unique_display_names() {
        let t = DefaultTransformer;
        let models = vec![
            am("anthropic/claude-sonnet-4-1", "Sonnet", None),
            am("anthropic/claude-sonnet-4-5", "Sonnet", None),
            am("openai:gpt-4.1", "GPT 4.1", None),
            am("google/gemini-2.5-pro", "Gemini 2.5 Pro", None),
            am("meta/llama-3.1", "Llama 3.1", None),
        ];
        let out = t.transform(&models);
        let anthropic_group = out
            .groups
            .iter()
            .find(|group| group.label == "Anthropic")
            .expect("anthropic group");
        let display_names: Vec<&str> = anthropic_group
            .models
            .iter()
            .map(|model| model.display_name.as_str())
            .collect();
        assert_eq!(display_names, vec!["Sonnet 4.1", "Sonnet 4.5"]);
    }

    #[test]
    fn default_transformer_does_not_disambiguate_across_provider_groups() {
        let t = DefaultTransformer;
        let models = vec![
            am("anthropic/assistant-a", "Assistant", None),
            am("openai:assistant-b", "Assistant", None),
            am("google/gemini-2.5-pro", "Gemini 2.5 Pro", None),
            am("meta/llama-3.1", "Llama 3.1", None),
            am("xai/grok-3", "Grok 3", None),
        ];
        let out = t.transform(&models);
        let anthropic_model = out
            .groups
            .iter()
            .find(|group| group.label == "Anthropic")
            .and_then(|group| group.models.first())
            .expect("anthropic model");
        let openai_model = out
            .groups
            .iter()
            .find(|group| group.label == "OpenAI")
            .and_then(|group| group.models.first())
            .expect("openai model");
        assert_eq!(anthropic_model.display_name, "Assistant");
        assert_eq!(openai_model.display_name, "Assistant");
    }

    #[test]
    fn default_transformer_triple_collisions_get_distinct_suffixes() {
        let t = DefaultTransformer;
        let models = vec![
            am("anthropic/claude-opus-4-1-thinking", "Opus", None),
            am("anthropic/claude-opus-4-1-max", "Opus", None),
            am("anthropic/claude-opus-4-1", "Opus", None),
            am("openai:gpt-4.1", "GPT 4.1", None),
            am("google/gemini-2.5-pro", "Gemini 2.5 Pro", None),
        ];
        let out = t.transform(&models);
        let anthropic_group = out
            .groups
            .iter()
            .find(|group| group.label == "Anthropic")
            .expect("anthropic group");
        let display_names: Vec<&str> = anthropic_group
            .models
            .iter()
            .map(|model| model.display_name.as_str())
            .collect();
        assert!(display_names.contains(&"Opus 4.1 · thinking"));
        assert!(display_names.contains(&"Opus 4.1 · max"));
        assert!(display_names.contains(&"Opus 4.1 · claude-opus-4-1"));
    }

    #[test]
    fn build_models_for_display_provider_grouped_uses_provider_transformer() {
        let out = build_models_for_display(
            &[am("anthropic/claude-4", "Claude 4", None)],
            ModelPresentationMetadata {
                display_family: ModelDisplayFamily::ProviderGrouped,
                usage_metrics: UsageMetricsPresentation::SpendAndContext,
            },
        );
        assert_eq!(out.groups.len(), 1);
        assert_eq!(
            out.presentation,
            ModelPresentationMetadata {
                display_family: ModelDisplayFamily::ProviderGrouped,
                usage_metrics: UsageMetricsPresentation::SpendAndContext,
            }
        );
    }

    #[test]
    fn build_models_for_display_claude_like_uses_claude_transformer() {
        let out = build_models_for_display(
            &[am(
                "default",
                "Default",
                Some("Use the default model (currently claude-sonnet-4) · Uses config"),
            )],
            ModelPresentationMetadata {
                display_family: ModelDisplayFamily::ClaudeLike,
                usage_metrics: UsageMetricsPresentation::ContextWindowOnly,
            },
        );
        assert_eq!(
            out.groups[0].models[0].display_name,
            "claude-sonnet-4 (default)"
        );
        assert_eq!(
            out.presentation.usage_metrics,
            UsageMetricsPresentation::ContextWindowOnly
        );
    }

    #[test]
    fn build_models_for_display_codex_reasoning_effort_groups_variants() {
        let out = build_models_for_display(
            &[
                am("claude-sonnet/low", "Low", None),
                am("claude-sonnet/high", "High", None),
            ],
            ModelPresentationMetadata {
                display_family: ModelDisplayFamily::CodexReasoningEffort,
                usage_metrics: UsageMetricsPresentation::SpendAndContext,
            },
        );
        assert_eq!(out.groups.len(), 1);
        assert_eq!(out.groups[0].label, "Claude-sonnet");
    }

    #[test]
    fn default_transformer_builds_single_group_for_small_lists() {
        let t = DefaultTransformer;
        let out = t.transform(&[am("anthropic/claude-4", "Claude 4", None)]);
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
