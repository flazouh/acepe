//! Claude reasoning-effort config option for the cc_sdk client.
//!
//! Mirrors the Codex reasoning-effort option (`codex_native_config`) so the
//! existing compact reasoning toolbar widget renders for Claude. The chosen
//! effort feeds the `--effort <level>` CLI flag via `ClaudeCodeOptions`.

use crate::acp::error::{AcpError, AcpResult};
use crate::acp::session_update::{ConfigOptionData, ConfigOptionPresentation, ConfigOptionValue};
use crate::cc_sdk::Effort;
use serde_json::Value;

/// Canonical id for the Claude reasoning-effort option. Contains "reasoning" so
/// the canonical classifier independently resolves `CompactReasoning`.
pub const REASONING_CONFIG_ID: &str = "reasoning_effort";

/// Sentinel value representing "let the CLI decide" (no `--effort` flag passed).
pub const REASONING_AUTO_VALUE: &str = "auto";

/// Selectable values, in display order. The first entry is the default/auto
/// sentinel; the rest are the levels accepted by the `claude` CLI
/// (`--effort`: low, medium, high, xhigh, max — verified against CLI v2.1.185).
const CLAUDE_REASONING_OPTIONS: [(&str, &str); 6] = [
    (REASONING_AUTO_VALUE, "Auto"),
    ("low", "Low"),
    ("medium", "Medium"),
    ("high", "High"),
    ("xhigh", "Extra High"),
    ("max", "Max"),
];

/// Per-session reasoning configuration for a Claude cc_sdk session.
///
/// `None` means no explicit selection — the CLI default applies and no
/// `--effort` flag is emitted.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ClaudeReasoningConfigState {
    pub effort: Option<Effort>,
}

/// Map a config value string to an optional effort. The auto sentinel maps to
/// `None`; known level tokens map to `Some(_)`; anything else is rejected.
pub fn parse_effort_value(value: &str) -> AcpResult<Option<Effort>> {
    match value {
        REASONING_AUTO_VALUE => Ok(None),
        "low" => Ok(Some(Effort::Low)),
        "medium" => Ok(Some(Effort::Medium)),
        "high" => Ok(Some(Effort::High)),
        "xhigh" => Ok(Some(Effort::Xhigh)),
        "max" => Ok(Some(Effort::Max)),
        other => Err(AcpError::ProtocolError(format!(
            "Unsupported Claude reasoning effort: {other}"
        ))),
    }
}

fn current_value_string(state: &ClaudeReasoningConfigState) -> String {
    state
        .effort
        .map(|effort| effort.to_string())
        .unwrap_or_else(|| REASONING_AUTO_VALUE.to_string())
}

/// Build the canonical config option list for the current reasoning state.
pub fn build_claude_reasoning_config_options(
    state: &ClaudeReasoningConfigState,
) -> Vec<ConfigOptionData> {
    vec![ConfigOptionData {
        id: REASONING_CONFIG_ID.to_string(),
        name: "Reasoning Effort".to_string(),
        category: REASONING_CONFIG_ID.to_string(),
        option_type: "select".to_string(),
        description: Some("Controls Claude reasoning depth.".to_string()),
        current_value: Some(Value::String(current_value_string(state))),
        options: CLAUDE_REASONING_OPTIONS
            .into_iter()
            .map(|(value, label)| ConfigOptionValue {
                name: label.to_string(),
                value: Value::String(value.to_string()),
                description: None,
            })
            .collect(),
        presentation: ConfigOptionPresentation::CompactReasoning,
    }]
}

/// Apply a new value to the reasoning state and return the rebuilt options.
pub fn set_reasoning_effort(
    state: &mut ClaudeReasoningConfigState,
    value: &str,
) -> AcpResult<Vec<ConfigOptionData>> {
    state.effort = parse_effort_value(value)?;
    Ok(build_claude_reasoning_config_options(state))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_state_emits_auto_compact_reasoning_option() {
        let options = build_claude_reasoning_config_options(&ClaudeReasoningConfigState::default());
        assert_eq!(options.len(), 1);
        let option = &options[0];
        assert!(option.id.contains("reasoning"));
        assert_eq!(
            option.presentation,
            ConfigOptionPresentation::CompactReasoning
        );
        assert_eq!(
            option.current_value,
            Some(Value::String("auto".to_string()))
        );
        // Auto sentinel + five CLI levels.
        assert_eq!(option.options.len(), 6);
    }

    #[test]
    fn set_high_updates_state_and_current_value() {
        let mut state = ClaudeReasoningConfigState::default();
        let options = set_reasoning_effort(&mut state, "high").expect("set high");
        assert_eq!(state.effort, Some(Effort::High));
        assert_eq!(
            options[0].current_value,
            Some(Value::String("high".to_string()))
        );
    }

    #[test]
    fn set_auto_resets_to_none() {
        let mut state = ClaudeReasoningConfigState {
            effort: Some(Effort::Max),
        };
        let options = set_reasoning_effort(&mut state, "auto").expect("set auto");
        assert_eq!(state.effort, None);
        assert_eq!(
            options[0].current_value,
            Some(Value::String("auto".to_string()))
        );
    }

    #[test]
    fn set_invalid_value_errors_and_preserves_state() {
        let mut state = ClaudeReasoningConfigState {
            effort: Some(Effort::High),
        };
        let result = set_reasoning_effort(&mut state, "bogus");
        assert!(result.is_err());
        assert_eq!(state.effort, Some(Effort::High));
    }

    #[test]
    fn every_level_round_trips_to_cli_token() {
        for (value, _label) in CLAUDE_REASONING_OPTIONS {
            let parsed = parse_effort_value(value).expect("parse known value");
            match parsed {
                Some(effort) => assert_eq!(effort.to_string(), value),
                None => assert_eq!(value, REASONING_AUTO_VALUE),
            }
        }
    }
}
