use crate::acp::parsers::types::infer_operation_family_from_payload;
use crate::acp::parsers::{get_parser, AgentParser, AgentType, OpenCodeParser, ParsedTodoStatus};
use crate::acp::session_update::{
    InteractionReplyHandler, OperationFamily, QuestionData, QuestionItem, QuestionOption,
    TodoItem, TodoStatus, ToolArguments, ToolCallData, ToolCallStatus, ToolKind, ToolReference,
};

#[derive(Debug, Clone, Default)]
pub(crate) struct OperationReadModelProjection {
    pub normalized_questions: Option<Vec<QuestionItem>>,
    pub normalized_todos: Option<Vec<TodoItem>>,
}

#[derive(Debug, Clone)]
pub(crate) struct ProjectedQuestionInteraction {
    pub question: QuestionData,
    pub answered_at_event_seq: Option<i64>,
    pub answers: Option<serde_json::Value>,
}

pub(crate) fn project_operation_read_model(
    family: OperationFamily,
    name: &str,
    raw_input: &serde_json::Value,
    agent_type: AgentType,
) -> OperationReadModelProjection {
    match family {
        OperationFamily::QuestionPrompt => OperationReadModelProjection {
            normalized_questions: project_normalized_questions(name, raw_input, agent_type),
            normalized_todos: None,
        },
        OperationFamily::TodoRead | OperationFamily::TodoWrite => OperationReadModelProjection {
            normalized_questions: None,
            normalized_todos: project_normalized_todos(name, raw_input, agent_type),
        },
        _ => OperationReadModelProjection::default(),
    }
}

pub(crate) fn project_read_model_for_kind(
    kind: ToolKind,
    name: &str,
    raw_input: &serde_json::Value,
    agent_type: AgentType,
) -> OperationReadModelProjection {
    project_operation_read_model(
        OperationFamily::from_tool_kind(kind),
        name,
        raw_input,
        agent_type,
    )
}

pub(crate) fn project_question_interaction(
    session_id: &str,
    tool_call: &crate::acp::session_update::ToolCallData,
    event_seq: i64,
) -> Option<ProjectedQuestionInteraction> {
    let question_items = if let Some(normalized_questions) = tool_call.normalized_questions.clone() {
        normalized_questions
    } else if let Some(question_answer) = tool_call.question_answer.clone() {
        question_answer.questions
    } else {
        return None;
    };

    let answers = tool_call
        .question_answer
        .as_ref()
        .map(|question_answer| serde_json::to_value(&question_answer.answers).unwrap_or(serde_json::Value::Null));

    Some(ProjectedQuestionInteraction {
        question: QuestionData {
            id: tool_call.id.clone(),
            session_id: session_id.to_string(),
            json_rpc_request_id: None,
            reply_handler: Some(InteractionReplyHandler::http(tool_call.id.clone())),
            questions: question_items,
            tool: Some(ToolReference {
                message_id: String::new(),
                call_id: tool_call.id.clone(),
            }),
        },
        answered_at_event_seq: answers.as_ref().map(|_| event_seq),
        answers,
    })
}

pub(crate) fn project_opencode_task_children_from_metadata(
    parent_id: &str,
    metadata: Option<&serde_json::Value>,
) -> Option<Vec<ToolCallData>> {
    let summary = metadata?.get("summary")?.as_array()?;
    if summary.is_empty() {
        return None;
    }

    let mut children = Vec::with_capacity(summary.len());
    for (index, item) in summary.iter().enumerate() {
        let tool_name = item.get("tool").and_then(|value| value.as_str()).unwrap_or("Tool");
        let state = item.get("state");
        let title = state
            .and_then(|value| value.get("title"))
            .and_then(|value| value.as_str())
            .map(ToString::to_string);
        let status = map_opencode_summary_status(
            state
                .and_then(|value| value.get("status"))
                .and_then(|value| value.as_str())
                .unwrap_or("pending"),
        );
        let tool_input = state
            .and_then(|value| value.get("input"))
            .cloned()
            .unwrap_or_else(|| serde_json::Value::Object(Default::default()));
        let arguments = OpenCodeParser
            .parse_typed_tool_arguments(Some(tool_name), &tool_input, None)
            .unwrap_or(ToolArguments::Other {
                raw: tool_input.clone(),
            });
        let detected_kind = OpenCodeParser.detect_tool_kind(tool_name);
        let argument_kind = arguments.tool_kind();
        let tool_kind = if argument_kind == ToolKind::WebSearch && detected_kind == ToolKind::Fetch {
            argument_kind
        } else if detected_kind != ToolKind::Other {
            detected_kind
        } else {
            argument_kind
        };
        let projection =
            project_read_model_for_kind(tool_kind, tool_name, &tool_input, AgentType::OpenCode);

        children.push(ToolCallData {
            id: format!("{parent_id}:summary-{index}"),
            name: tool_name.to_string(),
            arguments,
            raw_input: Some(tool_input),
            status,
            result: None,
            kind: Some(tool_kind),
            title,
            locations: None,
            skill_meta: None,
            normalized_questions: projection.normalized_questions,
            normalized_todos: projection.normalized_todos,
            parent_tool_use_id: Some(parent_id.to_string()),
            task_children: None,
            question_answer: None,
            awaiting_plan_approval: false,
            plan_approval_request_id: None,
        });
    }

    Some(children)
}

fn map_opencode_summary_status(status: &str) -> ToolCallStatus {
    match status {
        "completed" => ToolCallStatus::Completed,
        "error" | "failed" => ToolCallStatus::Failed,
        "running" => ToolCallStatus::InProgress,
        _ => ToolCallStatus::Pending,
    }
}

pub(crate) fn infer_operation_family_for_tool_call(tool_call: &ToolCallData) -> OperationFamily {
    let kind = tool_call.kind.unwrap_or_else(|| tool_call.arguments.tool_kind());
    let raw_arguments = tool_call
        .raw_input
        .as_ref()
        .cloned()
        .or_else(|| match &tool_call.arguments {
            ToolArguments::Think { raw, .. } => raw.clone(),
            ToolArguments::Other { raw } | ToolArguments::Browser { raw } => Some(raw.clone()),
            _ => None,
        });

    raw_arguments
        .as_ref()
        .map(|raw| infer_operation_family_from_payload(kind, raw))
        .unwrap_or_else(|| OperationFamily::from_tool_kind(kind))
}

pub(crate) fn project_normalized_questions(
    name: &str,
    raw_input: &serde_json::Value,
    agent_type: AgentType,
) -> Option<Vec<QuestionItem>> {
    let parser = get_parser(agent_type);
    let parsed_questions = parser.parse_questions(name, raw_input);

    parsed_questions.map(|questions| {
        questions
            .into_iter()
            .map(|question| QuestionItem {
                question: question.question,
                header: question.header,
                options: question
                    .options
                    .into_iter()
                    .map(|option| QuestionOption {
                        label: option.label,
                        description: option.description,
                    })
                    .collect(),
                multi_select: question.multi_select,
            })
            .collect()
    })
}

pub(crate) fn project_normalized_todos(
    name: &str,
    raw_input: &serde_json::Value,
    agent_type: AgentType,
) -> Option<Vec<TodoItem>> {
    let parser = get_parser(agent_type);
    let parsed_todos = parser.parse_todos(name, raw_input);

    parsed_todos.map(|todos| {
        todos
            .into_iter()
            .map(|todo| TodoItem {
                content: todo.content,
                active_form: todo.active_form,
                status: match todo.status {
                    ParsedTodoStatus::Pending => TodoStatus::Pending,
                    ParsedTodoStatus::InProgress => TodoStatus::InProgress,
                    ParsedTodoStatus::Completed => TodoStatus::Completed,
                    ParsedTodoStatus::Cancelled => TodoStatus::Cancelled,
                },
                started_at: None,
                completed_at: None,
                duration: None,
            })
            .collect()
    })
}

#[cfg(test)]
mod tests {
    use super::{
        infer_operation_family_for_tool_call, project_opencode_task_children_from_metadata,
        project_operation_read_model, project_question_interaction,
    };
    use crate::acp::parsers::AgentType;
    use crate::acp::session_update::{OperationFamily, ToolArguments, ToolCallData, ToolCallStatus, ToolKind};
    use crate::session_jsonl::types::QuestionAnswer;
    use serde_json::json;
    use std::collections::HashMap;

    #[test]
    fn todo_projector_only_emits_todos() {
        let projection = project_operation_read_model(
            OperationFamily::TodoWrite,
            "TodoWrite",
            &json!({
                "todos": [
                    {
                        "content": "Ship unit 3",
                        "activeForm": "Shipping unit 3",
                        "status": "in_progress"
                    }
                ]
            }),
            AgentType::ClaudeCode,
        );

        assert!(projection.normalized_questions.is_none());
        let todos = projection
            .normalized_todos
            .expect("todo projection should be present");
        assert_eq!(todos.len(), 1);
        assert_eq!(todos[0].content, "Ship unit 3");
    }

    #[test]
    fn question_projector_only_emits_questions() {
        let projection = project_operation_read_model(
            OperationFamily::QuestionPrompt,
            "AskUserQuestion",
            &json!({
                "questions": [
                    {
                        "question": "Proceed?",
                        "header": "Choose a path",
                        "options": [
                            { "label": "Yes", "description": "Continue the refactor" },
                            { "label": "No", "description": "Stop here" }
                        ],
                        "multiSelect": false
                    }
                ]
            }),
            AgentType::ClaudeCode,
        );

        assert!(projection.normalized_todos.is_none());
        let questions = projection
            .normalized_questions
            .expect("question projection should be present");
        assert_eq!(questions.len(), 1);
        assert_eq!(questions[0].question, "Proceed?");
    }

    #[test]
    fn question_interaction_projector_marks_answered_questions() {
        let mut answers = HashMap::new();
        answers.insert("Proceed?".to_string(), json!("Yes"));
        let tool_call = ToolCallData {
            id: "tool-question".to_string(),
            name: "AskUserQuestion".to_string(),
            arguments: ToolArguments::Other { raw: json!({}) },
            raw_input: None,
            status: ToolCallStatus::Completed,
            kind: Some(ToolKind::Question),
            result: None,
            title: None,
            locations: None,
            skill_meta: None,
            normalized_questions: Some(vec![crate::acp::session_update::QuestionItem {
                question: "Proceed?".to_string(),
                header: "Choose a path".to_string(),
                options: vec![],
                multi_select: false,
            }]),
            normalized_todos: None,
            parent_tool_use_id: None,
            task_children: None,
            question_answer: Some(QuestionAnswer {
                questions: vec![crate::acp::session_update::QuestionItem {
                    question: "Proceed?".to_string(),
                    header: "Choose a path".to_string(),
                    options: vec![],
                    multi_select: false,
                }],
                answers,
            }),
            awaiting_plan_approval: false,
            plan_approval_request_id: None,
        };

        let projection =
            project_question_interaction("session-1", &tool_call, 7).expect("question projection");

        assert_eq!(projection.question.session_id, "session-1");
        assert_eq!(projection.answered_at_event_seq, Some(7));
        assert_eq!(projection.answers, Some(json!({ "Proceed?": "Yes" })));
    }

    #[test]
    fn opencode_task_child_projector_preserves_richer_child_shape() {
        let children = project_opencode_task_children_from_metadata(
            "task-parent",
            Some(&json!({
                "summary": [
                    {
                        "tool": "todowrite",
                        "state": {
                            "title": "Track work",
                            "status": "running",
                            "input": {
                                "todos": [
                                    {
                                        "content": "Finish unit 3",
                                        "activeForm": "Finishing unit 3",
                                        "status": "in_progress"
                                    }
                                ]
                            }
                        }
                    }
                ]
            })),
        )
        .expect("task child projection should exist");

        assert_eq!(children.len(), 1);
        let child = &children[0];
        assert_eq!(child.parent_tool_use_id.as_deref(), Some("task-parent"));
        assert_eq!(child.status, ToolCallStatus::InProgress);
        assert_eq!(child.kind, Some(ToolKind::Todo));
        assert!(child.raw_input.is_some());
        let todos = child
            .normalized_todos
            .as_ref()
            .expect("todo summary should be projected");
        assert_eq!(todos[0].content, "Finish unit 3");
    }

    #[test]
    fn operation_family_projector_preserves_todo_read_semantics() {
        let tool_call = ToolCallData {
            id: "tool-sql-read".to_string(),
            name: "Search".to_string(),
            arguments: ToolArguments::Think {
                description: None,
                prompt: None,
                subagent_type: None,
                skill: None,
                skill_args: None,
                raw: Some(json!({
                    "query": "SELECT id, title, status FROM todos ORDER BY created_at ASC;"
                })),
            },
            raw_input: Some(json!({
                "query": "SELECT id, title, status FROM todos ORDER BY created_at ASC;"
            })),
            status: ToolCallStatus::Completed,
            kind: Some(ToolKind::Todo),
            result: None,
            title: Some("Searched".to_string()),
            locations: None,
            skill_meta: None,
            normalized_questions: None,
            normalized_todos: None,
            parent_tool_use_id: None,
            task_children: None,
            question_answer: None,
            awaiting_plan_approval: false,
            plan_approval_request_id: None,
        };

        assert_eq!(
            infer_operation_family_for_tool_call(&tool_call),
            OperationFamily::TodoRead
        );
    }
}
