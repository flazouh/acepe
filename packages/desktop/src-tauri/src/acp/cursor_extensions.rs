use crate::acp::provider_extensions::{
    InboundResponseAdapter, ProviderExtensionEvent, QuestionOptionResponseAdapter,
    QuestionResponseAdapter,
};
use crate::acp::session_update::{
    ContentChunk, PlanConfidence, PlanData, PlanSource, PlanStep, PlanStepStatus, QuestionData,
    QuestionItem, QuestionOption, SessionUpdate, TodoItem, TodoStatus, ToolArguments, ToolCallData,
    ToolCallStatus, ToolCallUpdateData, ToolKind, ToolReference,
};
use crate::acp::types::ContentBlock;
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::path::Path;

const CURSOR_ASK_QUESTION: &str = "cursor/ask_question";
const CURSOR_CREATE_PLAN: &str = "cursor/create_plan";
const CURSOR_UPDATE_TODOS: &str = "cursor/update_todos";
const CURSOR_TASK: &str = "cursor/task";
const CURSOR_GENERATE_IMAGE: &str = "cursor/generate_image";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CursorExtensionKind {
    Request,
    Notification,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AskQuestionParams {
    tool_call_id: Option<String>,
    title: Option<String>,
    #[serde(default)]
    questions: Vec<AskQuestionItem>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AskQuestionItem {
    id: Option<String>,
    prompt: Option<String>,
    #[serde(default)]
    options: Vec<AskQuestionOption>,
    #[serde(default)]
    allow_multiple: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AskQuestionOption {
    id: Option<String>,
    label: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreatePlanParams {
    tool_call_id: Option<String>,
    name: Option<String>,
    #[allow(dead_code)]
    overview: Option<String>,
    plan: Option<String>,
    #[serde(default)]
    todos: Vec<CreatePlanTodo>,
    #[serde(default)]
    phases: Vec<CreatePlanPhase>,
    #[serde(default)]
    plan_uri: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreatePlanPhase {
    name: Option<String>,
    #[serde(default)]
    todos: Vec<CreatePlanTodo>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreatePlanTodo {
    content: Option<String>,
    status: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateTodosParams {
    tool_call_id: Option<String>,
    #[serde(default)]
    todos: Vec<CreatePlanTodo>,
    #[serde(default)]
    merge: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskParams {
    tool_call_id: Option<String>,
    description: Option<String>,
    prompt: Option<String>,
    subagent_type: Option<String>,
    model: Option<String>,
    agent_id: Option<String>,
    duration_ms: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenerateImageParams {
    tool_call_id: Option<String>,
    description: Option<String>,
    file_path: Option<String>,
    reference_image_paths: Option<Vec<String>>,
}

/// Strip the leading underscore prefix that some Cursor ACP versions add
/// (e.g. `_cursor/create_plan` → `cursor/create_plan`).
fn strip_underscore_prefix(method: &str) -> &str {
    method.strip_prefix('_').unwrap_or(method)
}

/// Map a camelCase `_toolName` value from a Cursor pre-tool notification
/// to the corresponding `cursor/snake_case` extension method string.
fn tool_name_to_extension_method(tool_name: &str) -> Option<&'static str> {
    match tool_name {
        "askQuestion" => Some(CURSOR_ASK_QUESTION),
        "createPlan" => Some(CURSOR_CREATE_PLAN),
        "updateTodos" => Some(CURSOR_UPDATE_TODOS),
        "task" => Some(CURSOR_TASK),
        "generateImage" => Some(CURSOR_GENERATE_IMAGE),
        _ => None,
    }
}

/// Check if a session/update notification is a Cursor pre-tool signal for a
/// known extension method (askQuestion, createPlan, generateImage, etc.).
///
/// Cursor sends a regular `tool_call` notification with `rawInput._toolName`
/// ~861ms before the actual extension method JSON-RPC request. These create
/// phantom UI cards that the extension handler will replace with proper events.
///
/// Returns `true` if this notification should be suppressed.
pub fn is_cursor_extension_pre_tool(json: &Value) -> bool {
    // Only match session/update notifications with sessionUpdate: "tool_call"
    let update = match json.pointer("/params/update") {
        Some(u) => u,
        None => return false,
    };
    if update.get("sessionUpdate").and_then(|v| v.as_str()) != Some("tool_call") {
        return false;
    }
    let tool_name = match update
        .get("rawInput")
        .and_then(|ri| ri.get("_toolName"))
        .and_then(|v| v.as_str())
    {
        Some(name) => name,
        None => return false,
    };
    tool_name_to_extension_method(tool_name).is_some()
}

pub fn cursor_extension_kind(method: &str) -> Option<CursorExtensionKind> {
    match strip_underscore_prefix(method) {
        CURSOR_ASK_QUESTION | CURSOR_CREATE_PLAN => Some(CursorExtensionKind::Request),
        CURSOR_UPDATE_TODOS | CURSOR_TASK | CURSOR_GENERATE_IMAGE => {
            Some(CursorExtensionKind::Notification)
        }
        _ => None,
    }
}

pub fn normalize_cursor_extension(
    method: &str,
    params: &Value,
    request_id: Option<u64>,
    current_session_id: Option<&str>,
) -> Result<ProviderExtensionEvent, String> {
    let session_id = current_session_id
        .filter(|value| !value.is_empty())
        .unwrap_or("unknown")
        .to_string();

    match strip_underscore_prefix(method) {
        CURSOR_ASK_QUESTION => normalize_cursor_ask_question(params, request_id, session_id),
        CURSOR_CREATE_PLAN => normalize_cursor_create_plan(params, request_id, session_id),
        CURSOR_UPDATE_TODOS => normalize_cursor_update_todos(params, session_id),
        CURSOR_TASK => normalize_cursor_task(params, session_id),
        CURSOR_GENERATE_IMAGE => normalize_cursor_generate_image(params, session_id),
        _ => Err(format!("Unsupported Cursor extension method: {method}")),
    }
}

pub fn adapt_cursor_response(adapter: &InboundResponseAdapter, result: &Value) -> Value {
    let outcome = result
        .pointer("/outcome/outcome")
        .and_then(|value| value.as_str())
        .unwrap_or("selected");

    match adapter {
        InboundResponseAdapter::AskQuestion { questions } => {
            if outcome == "cancelled" {
                return json!({
                    "outcome": {
                        "outcome": "skipped",
                        "reason": "User cancelled questions",
                    }
                });
            }

            let answers = extract_answer_map(result);
            let mapped_answers = questions
                .iter()
                .filter_map(|question| {
                    let selected_labels = answers.get(&question.question)?;
                    let selected_option_ids = selected_values(selected_labels)
                        .iter()
                        .filter_map(|label| {
                            question
                                .options
                                .iter()
                                .find(|option| option.label == *label)
                                .map(|option| option.option_id.clone())
                        })
                        .collect::<Vec<_>>();

                    Some(json!({
                        "questionId": question.question_id,
                        "selectedOptionIds": selected_option_ids,
                    }))
                })
                .collect::<Vec<_>>();

            json!({
                "outcome": {
                    "outcome": "answered",
                    "answers": mapped_answers,
                }
            })
        }
        InboundResponseAdapter::CreatePlan { plan_uri } => {
            if outcome == "cancelled" {
                return json!({
                    "outcome": {
                        "outcome": "cancelled",
                        "reason": "User cancelled plan approval",
                    }
                });
            }

            // Frontend sends { "approved": true } or { "approved": false }.
            let approved = result
                .get("approved")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

            if approved {
                json!({
                    "outcome": {
                        "outcome": "accepted",
                        "planUri": plan_uri,
                    }
                })
            } else {
                json!({
                    "outcome": {
                        "outcome": "rejected",
                        "reason": "User rejected plan",
                    }
                })
            }
        }
    }
}

fn normalize_cursor_ask_question(
    params: &Value,
    request_id: Option<u64>,
    session_id: String,
) -> Result<ProviderExtensionEvent, String> {
    let parsed: AskQuestionParams =
        serde_json::from_value(params.clone()).map_err(|error| error.to_string())?;

    let header = parsed.title.unwrap_or_else(|| "Question".to_string());
    let mut adapter_questions = Vec::new();
    let mut canonical_questions = Vec::new();

    for (index, question) in parsed.questions.into_iter().enumerate() {
        let question_text = question.prompt.unwrap_or_else(|| header.clone());
        let question_id = question
            .id
            .unwrap_or_else(|| format!("cursor-question-{index}"));

        let mut adapter_options = Vec::new();
        let mut canonical_options = Vec::new();

        for (option_index, option) in question.options.into_iter().enumerate() {
            let label = option.label.unwrap_or_else(|| {
                option
                    .id
                    .clone()
                    .unwrap_or_else(|| format!("Option {}", option_index + 1))
            });
            let option_id = option.id.unwrap_or_else(|| label.clone());
            adapter_options.push(QuestionOptionResponseAdapter {
                label: label.clone(),
                option_id,
            });
            canonical_options.push(QuestionOption {
                label,
                description: String::new(),
            });
        }

        adapter_questions.push(QuestionResponseAdapter {
            question: question_text.clone(),
            question_id,
            options: adapter_options,
        });
        canonical_questions.push(QuestionItem {
            question: question_text,
            header: header.clone(),
            options: canonical_options,
            multi_select: question.allow_multiple,
        });
    }

    Ok(ProviderExtensionEvent {
        updates: vec![SessionUpdate::QuestionRequest {
            question: QuestionData {
                id: parsed
                    .tool_call_id
                    .clone()
                    .unwrap_or_else(|| format!("cursor-question-{request_id:?}")),
                session_id: session_id.clone(),
                json_rpc_request_id: request_id,
                reply_handler: request_id
                    .map(crate::acp::session_update::InteractionReplyHandler::json_rpc)
                    .or_else(|| {
                        Some(crate::acp::session_update::InteractionReplyHandler::http(
                            parsed
                                .tool_call_id
                                .clone()
                                .unwrap_or_else(|| format!("cursor-question-{request_id:?}")),
                        ))
                    }),
                questions: canonical_questions,
                tool: parsed.tool_call_id.as_ref().map(|id| ToolReference {
                    message_id: String::new(),
                    call_id: id.clone(),
                }),
            },
            session_id: Some(session_id),
        }],
        response_adapter: Some(InboundResponseAdapter::AskQuestion {
            questions: adapter_questions,
        }),
    })
}

fn normalize_cursor_create_plan(
    params: &Value,
    request_id: Option<u64>,
    session_id: String,
) -> Result<ProviderExtensionEvent, String> {
    let parsed: CreatePlanParams =
        serde_json::from_value(params.clone()).map_err(|error| error.to_string())?;
    let plan_steps = create_plan_steps(&parsed.todos, &parsed.phases);
    let tool_call_id = parsed
        .tool_call_id
        .clone()
        .unwrap_or_else(|| format!("cursor-plan-{request_id:?}"));

    let mut updates = vec![SessionUpdate::Plan {
        plan: PlanData {
            steps: plan_steps,
            has_plan: true,
            current_step: None,
            streaming: false,
            content: parsed.plan.clone(),
            content_markdown: parsed.plan,
            file_path: None,
            title: parsed.name.clone(),
            source: Some(PlanSource::Deterministic),
            confidence: Some(PlanConfidence::High),
            agent_id: Some("cursor".to_string()),
            updated_at: None,
        },
        session_id: Some(session_id.clone()),
    }];

    // Only emit a ToolCall awaiting approval when there is a request_id to respond to.
    // Notifications (request_id == None) do not require a response.
    if request_id.is_some() {
        updates.push(SessionUpdate::ToolCall {
            tool_call: ToolCallData {
                id: tool_call_id,
                name: CURSOR_CREATE_PLAN.to_string(),
                arguments: ToolArguments::Other {
                    raw: params.clone(),
                },
                raw_input: Some(params.clone()),
                status: ToolCallStatus::Completed,
                result: None,
                kind: Some(ToolKind::CreatePlan),
                title: parsed.name,
                locations: None,
                skill_meta: None,
                normalized_questions: None,
                normalized_todos: None,
                normalized_todo_update: None,
                parent_tool_use_id: None,
                task_children: None,
                question_answer: None,
                awaiting_plan_approval: true,
                plan_approval_request_id: request_id,
            },
            session_id: Some(session_id),
        });
    }

    let response_adapter = request_id.map(|_| InboundResponseAdapter::CreatePlan {
        plan_uri: parsed.plan_uri,
    });

    Ok(ProviderExtensionEvent {
        updates,
        response_adapter,
    })
}

fn normalize_cursor_update_todos(
    params: &Value,
    session_id: String,
) -> Result<ProviderExtensionEvent, String> {
    let parsed: UpdateTodosParams =
        serde_json::from_value(params.clone()).map_err(|error| error.to_string())?;
    let tool_call_id = parsed
        .tool_call_id
        .ok_or_else(|| "cursor/update_todos missing toolCallId".to_string())?;

    Ok(ProviderExtensionEvent {
        updates: vec![SessionUpdate::ToolCallUpdate {
            update: ToolCallUpdateData {
                tool_call_id,
                status: if parsed.merge {
                    Some(ToolCallStatus::InProgress)
                } else {
                    None
                },
                normalized_todos: Some(
                    parsed
                        .todos
                        .into_iter()
                        .map(|todo| {
                            let content = todo.content.unwrap_or_default();
                            let status = todo.status;
                            TodoItem {
                                active_form: active_form_for_status(&content, status.as_deref()),
                                content,
                                status: todo_status_from_str(status.as_deref()),
                                started_at: None,
                                completed_at: None,
                                duration: None,
                            }
                        })
                        .collect(),
                ),
                ..Default::default()
            },
            session_id: Some(session_id),
        }],
        response_adapter: None,
    })
}

fn normalize_cursor_task(
    params: &Value,
    session_id: String,
) -> Result<ProviderExtensionEvent, String> {
    let parsed: TaskParams =
        serde_json::from_value(params.clone()).map_err(|error| error.to_string())?;
    let tool_call_id = parsed
        .tool_call_id
        .ok_or_else(|| "cursor/task missing toolCallId".to_string())?;

    let summary = [parsed.subagent_type.clone(), parsed.model, parsed.agent_id]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(" · ");

    // Emit think-typed arguments so the frontend can show the subagent card instead of generic "Tool".
    // Placeholder entries are created from tool_call_update (in_progress) without name/kind; this update
    // upgrades them with arguments so resolveTaskSubagent and task routing work.
    let arguments = ToolArguments::Think {
        description: parsed.description.clone(),
        prompt: parsed.prompt.clone(),
        subagent_type: parsed.subagent_type.clone(),
        skill: None,
        skill_args: None,
        raw: None,
    };

    Ok(ProviderExtensionEvent {
        updates: vec![SessionUpdate::ToolCallUpdate {
            update: ToolCallUpdateData {
                tool_call_id,
                status: Some(ToolCallStatus::Completed),
                title: parsed.description.clone(),
                arguments: Some(arguments),
                result: Some(json!({
                    "description": parsed.description,
                    "prompt": parsed.prompt,
                    "summary": if summary.is_empty() { Value::Null } else { Value::String(summary) },
                    "durationMs": parsed.duration_ms,
                })),
                ..Default::default()
            },
            session_id: Some(session_id),
        }],
        response_adapter: None,
    })
}

fn normalize_cursor_generate_image(
    params: &Value,
    session_id: String,
) -> Result<ProviderExtensionEvent, String> {
    let parsed: GenerateImageParams =
        serde_json::from_value(params.clone()).map_err(|error| error.to_string())?;
    let tool_call_id = parsed
        .tool_call_id
        .ok_or_else(|| "cursor/generate_image missing toolCallId".to_string())?;
    let file_path = parsed
        .file_path
        .ok_or_else(|| "cursor/generate_image missing filePath".to_string())?;

    Ok(ProviderExtensionEvent {
        updates: vec![
            SessionUpdate::AgentMessageChunk {
                chunk: ContentChunk {
                    content: ContentBlock::Image {
                        data: String::new(),
                        mime_type: mime_type_for_path(&file_path).to_string(),
                        uri: Some(file_path.clone()),
                    },
                    aggregation_hint: None,
                },
                part_id: None,
                message_id: None,
                session_id: Some(session_id.clone()),
            },
            SessionUpdate::ToolCallUpdate {
                update: ToolCallUpdateData {
                    tool_call_id,
                    status: Some(ToolCallStatus::Completed),
                    title: parsed.description,
                    result: Some(json!({
                        "filePath": file_path,
                        "referenceImagePaths": parsed.reference_image_paths.unwrap_or_default(),
                    })),
                    ..Default::default()
                },
                session_id: Some(session_id),
            },
        ],
        response_adapter: None,
    })
}

fn create_plan_steps(todos: &[CreatePlanTodo], phases: &[CreatePlanPhase]) -> Vec<PlanStep> {
    let phase_steps = phases
        .iter()
        .flat_map(|phase| {
            phase
                .todos
                .iter()
                .map(move |todo| create_plan_step(todo, phase.name.as_deref()))
        })
        .collect::<Vec<_>>();

    if !phase_steps.is_empty() {
        return phase_steps;
    }

    todos
        .iter()
        .map(|todo| create_plan_step(todo, None))
        .collect::<Vec<_>>()
}

fn create_plan_step(todo: &CreatePlanTodo, phase_name: Option<&str>) -> PlanStep {
    let content = todo.content.clone().unwrap_or_default();
    let description = match phase_name {
        Some(phase) if !phase.is_empty() => format!("{phase}: {content}"),
        _ => content,
    };

    PlanStep {
        description,
        status: plan_step_status_from_str(todo.status.as_deref()),
    }
}

fn todo_status_from_str(status: Option<&str>) -> TodoStatus {
    match status.unwrap_or("pending") {
        "completed" => TodoStatus::Completed,
        "in_progress" => TodoStatus::InProgress,
        "cancelled" => TodoStatus::Cancelled,
        _ => TodoStatus::Pending,
    }
}

fn plan_step_status_from_str(status: Option<&str>) -> PlanStepStatus {
    match status.unwrap_or("pending") {
        "completed" => PlanStepStatus::Completed,
        "in_progress" => PlanStepStatus::InProgress,
        "failed" => PlanStepStatus::Failed,
        _ => PlanStepStatus::Pending,
    }
}

fn active_form_for_status(content: &str, status: Option<&str>) -> String {
    match status.unwrap_or("pending") {
        "completed" => format!("Completed {content}"),
        "in_progress" => format!("Working on {content}"),
        "cancelled" => format!("Cancelled {content}"),
        _ => format!("Pending {content}"),
    }
}

fn mime_type_for_path(path: &str) -> &'static str {
    match Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .as_deref()
    {
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        _ => "image/png",
    }
}

fn extract_answer_map(result: &Value) -> Map<String, Value> {
    result
        .pointer("/_meta/answers")
        .and_then(|value| value.as_object())
        .cloned()
        .unwrap_or_default()
}

fn selected_values(value: &Value) -> Vec<String> {
    match value {
        Value::String(single) => vec![single.clone()],
        Value::Array(values) => values
            .iter()
            .filter_map(|entry| entry.as_str().map(ToString::to_string))
            .collect(),
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_cursor_ask_question_to_canonical_question_request() {
        let event = normalize_cursor_extension(
            CURSOR_ASK_QUESTION,
            &json!({
                "toolCallId": "tool-1",
                "title": "Pick one",
                "questions": [{
                    "id": "question-1",
                    "prompt": "Select an option",
                    "options": [
                        { "id": "a", "label": "Option A" },
                        { "id": "b", "label": "Option B" }
                    ],
                    "allowMultiple": false
                }]
            }),
            Some(42),
            Some("session-1"),
        )
        .expect("event should normalize");

        match &event.updates[0] {
            SessionUpdate::QuestionRequest { question, .. } => {
                assert_eq!(question.json_rpc_request_id, Some(42));
                assert_eq!(
                    question.reply_handler,
                    Some(crate::acp::session_update::InteractionReplyHandler::json_rpc(42))
                );
                assert_eq!(question.questions[0].question, "Select an option");
                assert_eq!(question.questions[0].options[0].label, "Option A");
                // tool reference must link to the streaming tool call
                let tool_ref = question
                    .tool
                    .as_ref()
                    .expect("tool reference should be set");
                assert_eq!(tool_ref.call_id, "tool-1");
            }
            other => panic!("unexpected update: {other:?}"),
        }

        match event.response_adapter {
            Some(InboundResponseAdapter::AskQuestion { questions }) => {
                assert_eq!(questions[0].question_id, "question-1");
                assert_eq!(questions[0].options[0].option_id, "a");
            }
            other => panic!("unexpected adapter: {other:?}"),
        }
    }

    #[test]
    fn normalizes_cursor_create_plan_to_plan_and_question_updates() {
        let event = normalize_cursor_extension(
            CURSOR_CREATE_PLAN,
            &json!({
                "toolCallId": "plan-tool",
                "name": "Implementation Plan",
                "overview": "Approve this plan",
                "plan": "# Plan",
                "todos": [{ "content": "Ship it", "status": "pending" }],
                "planUri": "/tmp/plan.md"
            }),
            Some(7),
            Some("session-1"),
        )
        .expect("event should normalize");

        assert_eq!(event.updates.len(), 2);
        match &event.updates[1] {
            SessionUpdate::ToolCall { tool_call, .. } => {
                assert_eq!(tool_call.id, "plan-tool");
                assert!(tool_call.awaiting_plan_approval);
                assert_eq!(tool_call.plan_approval_request_id, Some(7));
                assert_eq!(tool_call.kind, Some(ToolKind::CreatePlan));
            }
            other => panic!("unexpected update: {other:?}"),
        }

        match event.response_adapter {
            Some(InboundResponseAdapter::CreatePlan { plan_uri }) => {
                assert_eq!(plan_uri.as_deref(), Some("/tmp/plan.md"));
            }
            other => panic!("unexpected adapter: {other:?}"),
        }
    }

    #[test]
    fn adapts_cursor_question_response_from_generic_answers() {
        let adapter = InboundResponseAdapter::AskQuestion {
            questions: vec![QuestionResponseAdapter {
                question: "Select an option".to_string(),
                question_id: "question-1".to_string(),
                options: vec![
                    QuestionOptionResponseAdapter {
                        label: "Option A".to_string(),
                        option_id: "a".to_string(),
                    },
                    QuestionOptionResponseAdapter {
                        label: "Option B".to_string(),
                        option_id: "b".to_string(),
                    },
                ],
            }],
        };

        let adapted = adapt_cursor_response(
            &adapter,
            &json!({
                "outcome": { "outcome": "selected", "optionId": "allow" },
                "_meta": { "answers": { "Select an option": "Option B" } }
            }),
        );

        assert_eq!(
            adapted,
            json!({
                "outcome": {
                    "outcome": "answered",
                    "answers": [{
                        "questionId": "question-1",
                        "selectedOptionIds": ["b"]
                    }]
                }
            })
        );
    }

    #[test]
    fn adapts_cursor_plan_response_approved() {
        let adapter = InboundResponseAdapter::CreatePlan {
            plan_uri: Some("/tmp/plan.md".to_string()),
        };

        let adapted = adapt_cursor_response(&adapter, &json!({ "approved": true }));

        assert_eq!(
            adapted,
            json!({
                "outcome": {
                    "outcome": "accepted",
                    "planUri": "/tmp/plan.md"
                }
            })
        );
    }

    #[test]
    fn adapts_cursor_plan_response_rejected() {
        let adapter = InboundResponseAdapter::CreatePlan {
            plan_uri: Some("/tmp/plan.md".to_string()),
        };

        let adapted = adapt_cursor_response(&adapter, &json!({ "approved": false }));

        assert_eq!(
            adapted,
            json!({
                "outcome": {
                    "outcome": "rejected",
                    "reason": "User rejected plan",
                }
            })
        );
    }

    #[test]
    fn normalizes_cursor_generate_image_to_image_chunk() {
        let event = normalize_cursor_extension(
            CURSOR_GENERATE_IMAGE,
            &json!({
                "toolCallId": "image-tool",
                "filePath": "/tmp/example.png"
            }),
            None,
            Some("session-1"),
        )
        .expect("event should normalize");

        match &event.updates[0] {
            SessionUpdate::AgentMessageChunk { chunk, .. } => match &chunk.content {
                ContentBlock::Image { uri, mime_type, .. } => {
                    assert_eq!(uri.as_deref(), Some("/tmp/example.png"));
                    assert_eq!(mime_type, "image/png");
                }
                other => panic!("unexpected content: {other:?}"),
            },
            other => panic!("unexpected update: {other:?}"),
        }
    }

    #[test]
    fn recognizes_underscore_prefixed_cursor_methods() {
        assert_eq!(
            cursor_extension_kind("_cursor/create_plan"),
            Some(CursorExtensionKind::Request)
        );
        assert_eq!(
            cursor_extension_kind("_cursor/ask_question"),
            Some(CursorExtensionKind::Request)
        );
        assert_eq!(
            cursor_extension_kind("_cursor/update_todos"),
            Some(CursorExtensionKind::Notification)
        );
        assert_eq!(
            cursor_extension_kind("_cursor/task"),
            Some(CursorExtensionKind::Notification)
        );
        assert_eq!(
            cursor_extension_kind("_cursor/generate_image"),
            Some(CursorExtensionKind::Notification)
        );
    }

    #[test]
    fn detects_cursor_extension_pre_tool_notifications() {
        // createPlan pre-tool notification
        assert!(is_cursor_extension_pre_tool(&json!({
            "method": "session/update",
            "params": {
                "sessionId": "s1",
                "update": {
                    "sessionUpdate": "tool_call",
                    "rawInput": { "_toolName": "createPlan" },
                    "kind": "other",
                    "status": "pending",
                    "title": "Create Plan",
                    "toolCallId": "tool_abc"
                }
            }
        })));

        // askQuestion pre-tool notification
        assert!(is_cursor_extension_pre_tool(&json!({
            "method": "session/update",
            "params": {
                "sessionId": "s1",
                "update": {
                    "sessionUpdate": "tool_call",
                    "rawInput": { "_toolName": "askQuestion" },
                    "kind": "think",
                    "status": "pending",
                    "title": "Ask Question",
                    "toolCallId": "tool_def"
                }
            }
        })));

        // generateImage pre-tool notification
        assert!(is_cursor_extension_pre_tool(&json!({
            "method": "session/update",
            "params": {
                "sessionId": "s1",
                "update": {
                    "sessionUpdate": "tool_call",
                    "rawInput": { "_toolName": "generateImage" },
                    "kind": "other",
                    "status": "pending",
                    "toolCallId": "tool_ghi"
                }
            }
        })));
    }

    #[test]
    fn does_not_suppress_regular_tool_calls() {
        // Normal tool call without _toolName
        assert!(!is_cursor_extension_pre_tool(&json!({
            "method": "session/update",
            "params": {
                "sessionId": "s1",
                "update": {
                    "sessionUpdate": "tool_call",
                    "rawInput": {},
                    "kind": "read",
                    "status": "pending",
                    "title": "Read File",
                    "toolCallId": "tool_xyz"
                }
            }
        })));

        // Unknown _toolName
        assert!(!is_cursor_extension_pre_tool(&json!({
            "method": "session/update",
            "params": {
                "sessionId": "s1",
                "update": {
                    "sessionUpdate": "tool_call",
                    "rawInput": { "_toolName": "unknownTool" },
                    "kind": "other",
                    "status": "pending",
                    "toolCallId": "tool_unk"
                }
            }
        })));

        // tool_call_update (not tool_call)
        assert!(!is_cursor_extension_pre_tool(&json!({
            "method": "session/update",
            "params": {
                "sessionId": "s1",
                "update": {
                    "sessionUpdate": "tool_call_update",
                    "rawInput": { "_toolName": "createPlan" },
                    "toolCallId": "tool_abc"
                }
            }
        })));

        // Missing params/update entirely
        assert!(!is_cursor_extension_pre_tool(&json!({
            "method": "session/update",
            "params": { "sessionId": "s1" }
        })));
    }

    #[test]
    fn normalizes_underscore_prefixed_create_plan() {
        let event = normalize_cursor_extension(
            "_cursor/create_plan",
            &json!({
                "toolCallId": "plan-tool",
                "name": "My Plan",
                "overview": "Approve this",
                "todos": [{ "content": "Step 1", "status": "incomplete" }]
            }),
            Some(1),
            Some("session-1"),
        )
        .expect("underscore-prefixed method should normalize");

        assert!(!event.updates.is_empty());
        assert!(event.response_adapter.is_some());
    }
}
