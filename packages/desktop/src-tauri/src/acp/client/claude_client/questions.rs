use std::collections::HashMap;
use std::sync::Arc;

use serde_json::Value;
use tokio::sync::Mutex;
use tokio::time::Duration;

use crate::acp::client::claude_client::permissions::PermissionBridge;
use crate::acp::session_update::{QuestionItem, SessionUpdate};

#[derive(Debug, Clone)]
pub(crate) struct PendingQuestionState {
    pub(crate) request_id: u64,
    pub(crate) session_id: String,
    pub(crate) questions: Option<Vec<QuestionItem>>,
    pub(crate) ui_emitted: bool,
}

pub(crate) fn build_question_answer_map(
    questions: &[QuestionItem],
    answers: &[Vec<String>],
) -> serde_json::Map<String, Value> {
    let mut answer_map = serde_json::Map::new();

    for (index, question) in questions.iter().enumerate() {
        let selected_answers = answers.get(index).cloned().unwrap_or_default();
        let answer_value = if question.multi_select || selected_answers.len() > 1 {
            Value::Array(selected_answers.into_iter().map(Value::String).collect())
        } else {
            Value::String(selected_answers.into_iter().next().unwrap_or_default())
        };

        answer_map.insert(question.question.clone(), answer_value);
    }

    answer_map
}

pub(crate) fn question_answers_are_empty(answers: &[Vec<String>]) -> bool {
    answers.iter().all(Vec::is_empty)
}

pub(crate) fn build_question_reply_text(
    questions: &[QuestionItem],
    answers: &[Vec<String>],
) -> String {
    let lines = questions
        .iter()
        .enumerate()
        .map(|(index, question)| {
            let selected_answers = answers.get(index).cloned().unwrap_or_default();
            let answer_text = if question.multi_select || selected_answers.len() > 1 {
                selected_answers.join(", ")
            } else {
                selected_answers.into_iter().next().unwrap_or_default()
            };
            let question_json = serde_json::to_string(&question.question)
                .unwrap_or_else(|_| format!("\"{}\"", question.question));
            let answer_json = serde_json::to_string(&answer_text)
                .unwrap_or_else(|_| format!("\"{}\"", answer_text));
            format!("- {question_json}: {answer_json}")
        })
        .collect::<Vec<_>>();

    format!("The user answered the questions:\n{}", lines.join("\n"))
}

fn question_request_binding_grace_duration() -> Duration {
    if cfg!(test) {
        Duration::from_millis(25)
    } else {
        Duration::from_millis(250)
    }
}

fn question_request_binding_poll_interval() -> Duration {
    if cfg!(test) {
        Duration::from_millis(5)
    } else {
        Duration::from_millis(25)
    }
}

pub(crate) async fn wait_for_question_request_binding(
    pending_questions: &Arc<Mutex<HashMap<String, PendingQuestionState>>>,
    question_id: &str,
) -> Option<PendingQuestionState> {
    let mut remaining = question_request_binding_grace_duration();

    loop {
        let state = pending_questions.lock().await.get(question_id).cloned();

        match state {
            Some(state) if state.request_id != 0 => return Some(state),
            Some(state) if remaining.is_zero() => return Some(state),
            Some(_) => {
                let sleep_for = question_request_binding_poll_interval().min(remaining);
                tokio::time::sleep(sleep_for).await;
                remaining = remaining.saturating_sub(sleep_for);
            }
            None => return None,
        }
    }
}

pub(crate) async fn take_stream_only_question_state(
    pending_questions: &Arc<Mutex<HashMap<String, PendingQuestionState>>>,
    question_id: &str,
) -> Option<PendingQuestionState> {
    let mut pending_questions = pending_questions.lock().await;
    let state = pending_questions.get(question_id).cloned()?;

    if state.request_id != 0 {
        return None;
    }

    pending_questions.remove(question_id);
    Some(state)
}

pub(crate) async fn has_pending_stream_only_question(
    pending_questions: &Arc<Mutex<HashMap<String, PendingQuestionState>>>,
    session_id: &str,
) -> bool {
    pending_questions
        .lock()
        .await
        .values()
        .any(|state| state.session_id == session_id && state.request_id == 0)
}

pub(crate) async fn should_suppress_update_while_awaiting_stream_only_question(
    pending_questions: &Arc<Mutex<HashMap<String, PendingQuestionState>>>,
    session_id: &str,
    update: &SessionUpdate,
) -> bool {
    let pending_question_ids = pending_questions
        .lock()
        .await
        .iter()
        .filter_map(|(tool_call_id, state)| {
            if state.session_id == session_id && state.request_id == 0 {
                Some(tool_call_id.clone())
            } else {
                None
            }
        })
        .collect::<Vec<_>>();

    if pending_question_ids.is_empty() {
        return false;
    }

    match update {
        SessionUpdate::QuestionRequest { .. } | SessionUpdate::UsageTelemetryUpdate { .. } => false,
        SessionUpdate::ToolCall { tool_call, .. } => !pending_question_ids.contains(&tool_call.id),
        SessionUpdate::ToolCallUpdate { update, .. } => {
            !pending_question_ids.contains(&update.tool_call_id)
        }
        SessionUpdate::AgentMessageChunk { .. }
        | SessionUpdate::AgentThoughtChunk { .. }
        | SessionUpdate::TurnComplete { .. }
        | SessionUpdate::TurnError { .. }
        | SessionUpdate::Plan { .. }
        | SessionUpdate::AvailableCommandsUpdate { .. }
        | SessionUpdate::CurrentModeUpdate { .. }
        | SessionUpdate::ConfigOptionUpdate { .. }
        | SessionUpdate::PermissionRequest { .. }
        | SessionUpdate::UserMessageChunk { .. }
        | SessionUpdate::ConnectionComplete { .. }
        | SessionUpdate::ConnectionFailed { .. } => true,
    }
}

pub(crate) async fn annotate_pending_question_request(
    bridge: &PermissionBridge,
    pending_questions: &Arc<Mutex<HashMap<String, PendingQuestionState>>>,
    update: &mut SessionUpdate,
) -> bool {
    let SessionUpdate::QuestionRequest { question, .. } = update else {
        return true;
    };

    let request_id = if let Some(request_id) = question.json_rpc_request_id {
        Some(request_id)
    } else {
        bridge.request_id_for_question_tool_call(&question.id).await
    };

    let mut pending_questions = pending_questions.lock().await;
    let state = pending_questions
        .entry(question.id.clone())
        .or_insert_with(|| PendingQuestionState {
            request_id: request_id.unwrap_or(0),
            session_id: question.session_id.clone(),
            questions: Some(question.questions.clone()),
            ui_emitted: false,
        });

    if state.questions.is_none() {
        state.questions = Some(question.questions.clone());
    }

    if let Some(request_id) = request_id {
        question.json_rpc_request_id = Some(request_id);
        state.request_id = request_id;
    }

    if state.ui_emitted {
        return false;
    }

    state.ui_emitted = true;
    true
}
