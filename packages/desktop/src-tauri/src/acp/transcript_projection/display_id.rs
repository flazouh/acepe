//! Acepe-owned display-id authority.
//!
//! Derives stable `entry_id` values from canonical facts (turn key, element
//! role, tool call identity) independent of provider and source path.

use crate::acp::parsers::acp_fields::normalize_tool_call_id;
use crate::acp::transcript_projection::snapshot::TranscriptEntryRole;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DisplayElementRole {
    User,
    Assistant,
    Tool,
    SessionActivity,
}

impl DisplayElementRole {
    fn slug(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Assistant => "assistant",
            Self::Tool => "tool",
            Self::SessionActivity => "session-activity",
        }
    }
}

/// Canonical facts for one logical transcript element.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DisplayIdInput {
    pub turn_key: String,
    pub role: DisplayElementRole,
    /// Required for [`DisplayElementRole::Tool`]; must be `None` for other roles.
    pub tool_call_id: Option<String>,
}

/// Derive the canonical Acepe-owned `entry_id` for a transcript entry.
#[must_use]
pub fn derive_entry_id(input: &DisplayIdInput) -> String {
    let role_slug = input.role.slug();
    let suffix = match input.role {
        DisplayElementRole::Tool => input
            .tool_call_id
            .as_deref()
            .filter(|id| !id.trim().is_empty())
            .map(normalize_tool_call_id)
            .unwrap_or_else(|| ".".to_string()),
        DisplayElementRole::User
        | DisplayElementRole::Assistant
        | DisplayElementRole::SessionActivity => ".".to_string(),
    };
    format!(
        "acepe::entry::{}::{}::{}",
        input.turn_key, role_slug, suffix
    )
}

/// Convenience for tool rows — the primary resume-seam reconciliation key.
#[must_use]
pub fn derive_tool_entry_id(turn_key: &str, tool_call_id: &str) -> String {
    derive_entry_id(&DisplayIdInput {
        turn_key: turn_key.to_string(),
        role: DisplayElementRole::Tool,
        tool_call_id: Some(tool_call_id.to_string()),
    })
}

#[must_use]
pub fn derive_session_activity_entry_id(turn_key: &str, activity_id: &str) -> String {
    let normalized_activity_id = normalize_tool_call_id(activity_id);
    format!(
        "acepe::entry::{}::{}::{}",
        turn_key,
        DisplayElementRole::SessionActivity.slug(),
        normalized_activity_id
    )
}

/// Historical-shaped entry point — identical output to [`derive_entry_id_from_live_facts`].
#[must_use]
pub fn derive_entry_id_from_history_facts(input: &DisplayIdInput) -> String {
    derive_entry_id(input)
}

/// Live-shaped entry point — identical output to [`derive_entry_id_from_history_facts`].
#[must_use]
pub fn derive_entry_id_from_live_facts(input: &DisplayIdInput) -> String {
    derive_entry_id(input)
}

/// Replay the assistant-boundary counter from a materialized transcript snapshot.
#[must_use]
pub fn assistant_boundary_entry_count_from_transcript_entries(
    entries: &[crate::acp::transcript_projection::TranscriptEntry],
) -> usize {
    let mut boundary = 0usize;
    for (index, entry) in entries.iter().enumerate() {
        if !matches!(entry.role, TranscriptEntryRole::Assistant) {
            boundary = index + 1;
        }
    }
    boundary
}

/// Turn key from the assistant-boundary counter used by live and history replay.
#[must_use]
pub fn turn_key_for_assistant_boundary(assistant_boundary_entry_count: usize) -> String {
    if assistant_boundary_entry_count == 0 {
        "session-start".to_string()
    } else {
        format!("assistant-boundary:{assistant_boundary_entry_count}")
    }
}

/// Extract the normalized tool-call suffix from an authority-derived tool entry id.
#[must_use]
pub fn tool_call_id_from_authority_entry_id(entry_id: &str) -> Option<String> {
    const TOOL_MARKER: &str = "::tool::";
    let marker_index = entry_id.rfind(TOOL_MARKER)?;
    let suffix = entry_id[marker_index + TOOL_MARKER.len()..].trim();
    if suffix.is_empty() || suffix == "." {
        return None;
    }
    Some(suffix.to_string())
}

/// Map from snapshot role for callers that already have [`TranscriptEntryRole`].
#[must_use]
pub fn derive_entry_id_for_snapshot_role(
    turn_key: &str,
    role: &TranscriptEntryRole,
    tool_call_id: Option<&str>,
) -> String {
    let display_role = match role {
        TranscriptEntryRole::User => DisplayElementRole::User,
        TranscriptEntryRole::Assistant => DisplayElementRole::Assistant,
        TranscriptEntryRole::Tool => DisplayElementRole::Tool,
        TranscriptEntryRole::SessionActivity => DisplayElementRole::SessionActivity,
    };
    derive_entry_id(&DisplayIdInput {
        turn_key: turn_key.to_string(),
        role: display_role,
        tool_call_id: tool_call_id.map(str::to_string),
    })
}

#[cfg(test)]
mod tests {
    use super::{
        derive_entry_id, derive_entry_id_from_history_facts, derive_entry_id_from_live_facts,
        derive_tool_entry_id, DisplayElementRole, DisplayIdInput,
    };

    fn tool_input(turn_key: &str, tool_call_id: &str) -> DisplayIdInput {
        DisplayIdInput {
            turn_key: turn_key.to_string(),
            role: DisplayElementRole::Tool,
            tool_call_id: Some(tool_call_id.to_string()),
        }
    }

    #[test]
    fn same_canonical_facts_yield_identical_ids_from_history_and_live_shaped_inputs() {
        let input = tool_input("assistant-boundary:2", "toolu_read_file");

        assert_eq!(
            derive_entry_id_from_history_facts(&input),
            derive_entry_id_from_live_facts(&input)
        );
        assert_eq!(
            derive_entry_id_from_history_facts(&input),
            "acepe::entry::assistant-boundary:2::tool::toolu_read_file"
        );
    }

    #[test]
    fn distinct_tool_calls_in_one_turn_get_distinct_entry_ids() {
        let first = derive_tool_entry_id("assistant-boundary:1", "toolu_a");
        let second = derive_tool_entry_id("assistant-boundary:1", "toolu_b");

        assert_ne!(first, second);
    }

    #[test]
    fn entry_id_derivation_does_not_depend_on_provider_specific_normalization_only() {
        let with_controls = derive_tool_entry_id("session-start", "tool%provider\ncursor");
        assert_eq!(
            with_controls,
            "acepe::entry::session-start::tool::tool%25provider%0Acursor"
        );
    }

    #[test]
    fn non_tool_roles_use_turn_key_and_role_without_tool_call_id() {
        assert_eq!(
            derive_entry_id(&DisplayIdInput {
                turn_key: "session-start".to_string(),
                role: DisplayElementRole::User,
                tool_call_id: None,
            }),
            "acepe::entry::session-start::user::."
        );
        assert_eq!(
            derive_entry_id(&DisplayIdInput {
                turn_key: "assistant-boundary:3".to_string(),
                role: DisplayElementRole::Assistant,
                tool_call_id: None,
            }),
            "acepe::entry::assistant-boundary:3::assistant::."
        );
    }

    #[test]
    fn same_turn_key_and_tool_call_id_is_deterministic() {
        let once = derive_tool_entry_id("assistant-boundary:4", "toolu_same");
        let twice = derive_tool_entry_id("assistant-boundary:4", "toolu_same");
        assert_eq!(once, twice);
    }
}
