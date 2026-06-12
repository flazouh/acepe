use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, specta::Type, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum SessionStateField {
    TranscriptSnapshot,
    Operations,
    Activity,
    TurnState,
    ActiveTurnFailure,
    LastTerminalTurnId,
    ActiveStreamingTail,
    Interactions,
}

/// Shared 5-field base-set for turn/interaction terminal projection updates.
pub fn turn_terminal_change_fields() -> Vec<SessionStateField> {
    vec![
        SessionStateField::Activity,
        SessionStateField::TurnState,
        SessionStateField::ActiveTurnFailure,
        SessionStateField::LastTerminalTurnId,
        SessionStateField::ActiveStreamingTail,
    ]
}

#[cfg(test)]
mod tests {
    use super::SessionStateField;

    #[test]
    fn session_state_field_serializes_to_legacy_camel_case_tokens() {
        let fields = vec![SessionStateField::TurnState, SessionStateField::Operations];
        let json = serde_json::to_string(&fields).expect("serialize");
        assert_eq!(json, r#"["turnState","operations"]"#);
    }

    #[test]
    fn session_state_field_round_trips_legacy_string_array() {
        let json = r#"["transcriptSnapshot","activity"]"#;
        let fields: Vec<SessionStateField> = serde_json::from_str(json).expect("deserialize");
        assert_eq!(
            fields,
            vec![
                SessionStateField::TranscriptSnapshot,
                SessionStateField::Activity,
            ]
        );
    }
}
