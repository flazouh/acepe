//! Single owner of terminal-turn preservation, reset, and late-duplicate suppression.
//!
//! Live dispatch and journal replay both use decide-then-advance over this guard so
//! transcript suppression matches canonical session lifecycle.

use crate::acp::projections::helpers::convert_turn_error_snapshot;
use crate::acp::projections::types::{SessionSnapshot, SessionTurnState, TurnFailureSnapshot};
use crate::acp::session_update::SessionUpdate;

/// Pre-apply routing decision for one `SessionUpdate` against terminal-turn state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct RouteDecision {
    /// Suppress transcript-bearing stragglers while a terminal turn is preserved.
    pub suppress: bool,
    /// Applying this event clears terminal-turn preservation (starts a running turn).
    pub resets: bool,
    /// Skip a late duplicate `TurnComplete` / `TurnError` for an already-terminal turn.
    pub ignore_late: bool,
}

/// Canonical terminal-turn state machine: route gate + transitions.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TerminalTurnGuard {
    turn_state: SessionTurnState,
    active_turn_failure: Option<TurnFailureSnapshot>,
    last_terminal_turn_id: Option<String>,
}

impl Default for TerminalTurnGuard {
    fn default() -> Self {
        Self {
            turn_state: SessionTurnState::Idle,
            active_turn_failure: None,
            last_terminal_turn_id: None,
        }
    }
}

impl TerminalTurnGuard {
    #[must_use]
    pub fn from_snapshot(snapshot: &SessionSnapshot) -> Self {
        Self {
            turn_state: snapshot.turn_state.clone(),
            active_turn_failure: snapshot.active_turn_failure.clone(),
            last_terminal_turn_id: snapshot.last_terminal_turn_id.clone(),
        }
    }

    pub fn write_to_snapshot(&self, snapshot: &mut SessionSnapshot) {
        snapshot.turn_state = self.turn_state.clone();
        snapshot.active_turn_failure = self.active_turn_failure.clone();
        snapshot.last_terminal_turn_id = self.last_terminal_turn_id.clone();
    }

    #[must_use]
    pub fn preserves_terminal_turn(&self) -> bool {
        self.turn_state == SessionTurnState::Cancelled
            || (self.turn_state == SessionTurnState::Failed && self.active_turn_failure.is_some())
    }

    fn matches_terminal_turn_id(left: Option<&str>, right: Option<&str>) -> bool {
        match (left, right) {
            (Some(left), Some(right)) => left == right,
            (None, None) => true,
            _ => false,
        }
    }

    fn should_ignore_turn_complete(&self, turn_id: Option<&str>) -> bool {
        self.preserves_terminal_turn()
            && (self.last_terminal_turn_id.is_none()
                || turn_id.is_none()
                || Self::matches_terminal_turn_id(self.last_terminal_turn_id.as_deref(), turn_id))
    }

    fn should_ignore_late_turn_failure(&self, turn_id: Option<&str>) -> bool {
        self.preserves_terminal_turn()
            && (self.last_terminal_turn_id.is_none()
                || Self::matches_terminal_turn_id(self.last_terminal_turn_id.as_deref(), turn_id))
    }

    pub fn reset_to_running_turn(&mut self) {
        self.start_running_turn();
    }

    fn start_running_turn(&mut self) {
        self.turn_state = SessionTurnState::Running;
        self.active_turn_failure = None;
        self.last_terminal_turn_id = None;
    }

    fn straggler_suppress(&self) -> bool {
        self.preserves_terminal_turn()
    }

    /// Pure pre-apply decision for one update against the current guard state.
    #[must_use]
    pub fn route(&self, update: &SessionUpdate) -> RouteDecision {
        match update {
            SessionUpdate::UserMessageChunk { .. } => RouteDecision {
                suppress: false,
                resets: true,
                ignore_late: false,
            },
            SessionUpdate::AgentMessageChunk { .. }
            | SessionUpdate::AgentThoughtChunk { .. }
            | SessionUpdate::ToolCallUpdate { .. } => {
                let suppress = self.straggler_suppress();
                RouteDecision {
                    suppress,
                    resets: !suppress,
                    ignore_late: false,
                }
            }
            SessionUpdate::ToolCall { .. } => {
                let suppress = self.straggler_suppress();
                RouteDecision {
                    suppress,
                    resets: !suppress,
                    ignore_late: false,
                }
            }
            SessionUpdate::TurnComplete { turn_id, .. } => RouteDecision {
                suppress: false,
                resets: false,
                ignore_late: self.should_ignore_turn_complete(turn_id.as_deref()),
            },
            SessionUpdate::TurnError { turn_id, .. } => RouteDecision {
                suppress: false,
                resets: false,
                ignore_late: self.should_ignore_late_turn_failure(turn_id.as_deref()),
            },
            SessionUpdate::TurnCancelled { .. } => RouteDecision {
                suppress: false,
                resets: false,
                ignore_late: false,
            },
            _ => RouteDecision::default(),
        }
    }

    /// Mutate terminal-turn state after a projection arm has been applied.
    pub fn advance(&mut self, update: &SessionUpdate) {
        match update {
            SessionUpdate::UserMessageChunk { .. } => {
                self.start_running_turn();
            }
            SessionUpdate::AgentMessageChunk { .. }
            | SessionUpdate::AgentThoughtChunk { .. }
            | SessionUpdate::ToolCall { .. }
            | SessionUpdate::ToolCallUpdate { .. } => {
                if !self.straggler_suppress() {
                    self.start_running_turn();
                }
            }
            SessionUpdate::TurnComplete { turn_id, .. } => {
                self.turn_state = SessionTurnState::Completed;
                self.active_turn_failure = None;
                self.last_terminal_turn_id = turn_id.clone();
            }
            SessionUpdate::TurnError { error, turn_id, .. } => {
                self.turn_state = SessionTurnState::Failed;
                self.active_turn_failure =
                    Some(convert_turn_error_snapshot(error, turn_id.clone()));
                self.last_terminal_turn_id = turn_id.clone();
            }
            SessionUpdate::TurnCancelled { turn_id, .. } => {
                self.turn_state = SessionTurnState::Cancelled;
                self.active_turn_failure = None;
                self.last_terminal_turn_id = turn_id.clone();
            }
            _ => {}
        }
    }
}

#[cfg(test)]
impl TerminalTurnGuard {
    #[must_use]
    pub(crate) fn from_parts(
        turn_state: SessionTurnState,
        active_turn_failure: Option<TurnFailureSnapshot>,
        last_terminal_turn_id: Option<String>,
    ) -> Self {
        Self {
            turn_state,
            active_turn_failure,
            last_terminal_turn_id,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{RouteDecision, TerminalTurnGuard};
    use crate::acp::projections::types::{SessionSnapshot, SessionTurnState, TurnFailureSnapshot};
    use crate::acp::session_update::{
        ContentChunk, SessionUpdate, ToolArguments, ToolCallData, ToolCallStatus, ToolKind,
        TurnErrorData, TurnErrorKind, TurnErrorSource,
    };
    use crate::acp::types::CanonicalAgentId;
    use crate::acp::types::ContentBlock;

    fn failed_guard(turn_id: &str) -> TerminalTurnGuard {
        TerminalTurnGuard::from_parts(
            SessionTurnState::Failed,
            Some(TurnFailureSnapshot {
                turn_id: Some(turn_id.to_string()),
                message: "boom".to_string(),
                code: None,
                details: None,
                kind: TurnErrorKind::Recoverable,
                source: TurnErrorSource::Unknown,
            }),
            Some(turn_id.to_string()),
        )
    }

    fn turn_error(turn_id: Option<&str>) -> SessionUpdate {
        SessionUpdate::TurnError {
            error: TurnErrorData::Legacy("boom".to_string()),
            turn_id: turn_id.map(str::to_string),
            session_id: Some("session-1".to_string()),
        }
    }

    fn tool_call_update() -> SessionUpdate {
        SessionUpdate::ToolCall {
            tool_call: ToolCallData {
                id: "tool-1".to_string(),
                name: "bash".to_string(),
                arguments: ToolArguments::Execute {
                    command: Some("pwd".to_string()),
                },
                diagnostic_input: None,
                status: ToolCallStatus::Pending,
                result: None,
                kind: Some(ToolKind::Execute),
                title: None,
                locations: None,
                skill_meta: None,
                normalized_questions: None,
                normalized_todos: None,
                normalized_todo_update: None,
                parent_tool_use_id: None,
                task_children: None,
                question_answer: None,
                awaiting_plan_approval: false,
                plan_approval_request_id: None,
            },
            session_id: Some("session-1".to_string()),
        }
    }

    #[test]
    fn route_after_turn_error_suppresses_same_turn_straggler_tool_call() {
        let guard = failed_guard("turn-1");
        assert_eq!(
            guard.route(&tool_call_update()),
            RouteDecision {
                suppress: true,
                resets: false,
                ignore_late: false,
            }
        );
    }

    #[test]
    fn route_user_message_after_turn_error_resets() {
        let guard = failed_guard("turn-1");
        let user = SessionUpdate::UserMessageChunk {
            chunk: ContentChunk {
                content: ContentBlock::Text {
                    text: "retry".to_string(),
                },
                aggregation_hint: None,
            },
            session_id: Some("session-1".to_string()),
            attempt_id: None,
        };
        assert_eq!(
            guard.route(&user),
            RouteDecision {
                suppress: false,
                resets: true,
                ignore_late: false,
            }
        );
        let mut guard = guard;
        guard.advance(&user);
        assert!(!guard.preserves_terminal_turn());
        assert!(guard.last_terminal_turn_id.is_none());
    }

    #[test]
    fn route_turn_error_before_advance_is_not_suppressed() {
        let guard = TerminalTurnGuard::default();
        assert_eq!(
            guard.route(&turn_error(Some("turn-1"))),
            RouteDecision {
                suppress: false,
                resets: false,
                ignore_late: false,
            }
        );
    }

    #[test]
    fn route_late_duplicate_turn_complete_with_matching_turn_id() {
        let guard = failed_guard("turn-1");
        let complete = SessionUpdate::TurnComplete {
            session_id: Some("session-1".to_string()),
            turn_id: Some("turn-1".to_string()),
        };
        assert_eq!(
            guard.route(&complete),
            RouteDecision {
                suppress: false,
                resets: false,
                ignore_late: true,
            }
        );
    }

    #[test]
    fn route_late_turn_error_with_none_turn_id_is_not_ignored() {
        let guard = failed_guard("turn-1");
        assert_eq!(
            guard.route(&turn_error(None)),
            RouteDecision {
                suppress: false,
                resets: false,
                ignore_late: false,
            }
        );
    }

    #[test]
    fn characterization_guard_matches_reducer_sequence() {
        let mut snapshot =
            SessionSnapshot::new("session-1".to_string(), Some(CanonicalAgentId::ClaudeCode));
        let events = [
            SessionUpdate::UserMessageChunk {
                chunk: ContentChunk {
                    content: ContentBlock::Text {
                        text: "hi".to_string(),
                    },
                    aggregation_hint: None,
                },
                session_id: Some("session-1".to_string()),
                attempt_id: None,
            },
            turn_error(Some("turn-1")),
            tool_call_update(),
            SessionUpdate::UserMessageChunk {
                chunk: ContentChunk {
                    content: ContentBlock::Text {
                        text: "retry".to_string(),
                    },
                    aggregation_hint: None,
                },
                session_id: Some("session-1".to_string()),
                attempt_id: None,
            },
            tool_call_update(),
        ];

        let mut guard = TerminalTurnGuard::from_snapshot(&snapshot);
        for update in &events {
            let _decision = guard.route(update);
            guard.advance(update);
            guard.write_to_snapshot(&mut snapshot);
        }

        assert_eq!(snapshot.turn_state, SessionTurnState::Running);
        assert!(snapshot.active_turn_failure.is_none());
        assert!(snapshot.last_terminal_turn_id.is_none());
    }
}
