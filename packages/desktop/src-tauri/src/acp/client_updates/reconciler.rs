use super::*;
use crate::acp::streaming_log::log_debug_event;
use crate::acp::task_reconciler::TaskReconciliationPolicy;

fn log_unclassified_tool_call(
    session_id: &str,
    tool_call: &crate::acp::session_update::ToolCallData,
) {
    if let crate::acp::session_update::ToolArguments::Unclassified {
        raw_name,
        raw_kind_hint,
        title,
        arguments_preview,
        signals_tried,
    } = &tool_call.arguments
    {
        log_debug_event(
            session_id,
            "tool_call.unclassified",
            &serde_json::json!({
                "toolCallId": tool_call.id,
                "displayName": tool_call.name,
                "displayTitle": tool_call.title,
                "rawName": raw_name,
                "rawKindHint": raw_kind_hint,
                "rawTitle": title,
                "argumentsPreview": arguments_preview,
                "signalsTried": signals_tried,
            }),
        );
    }
}

fn log_unclassified_tool_update(
    session_id: &str,
    update: &crate::acp::session_update::ToolCallUpdateData,
) {
    let Some(arguments) = update
        .arguments
        .as_ref()
        .or(update.streaming_arguments.as_ref())
    else {
        return;
    };

    if let crate::acp::session_update::ToolArguments::Unclassified {
        raw_name,
        raw_kind_hint,
        title,
        arguments_preview,
        signals_tried,
    } = arguments
    {
        log_debug_event(
            session_id,
            "tool_call_update.unclassified",
            &serde_json::json!({
                "toolCallId": update.tool_call_id,
                "title": update.title,
                "rawName": raw_name,
                "rawKindHint": raw_kind_hint,
                "rawTitle": title,
                "argumentsPreview": arguments_preview,
                "signalsTried": signals_tried,
            }),
        );
    }
}

pub(crate) fn process_through_reconciler(
    update: &SessionUpdate,
    reconciler: &StdArc<std::sync::Mutex<TaskReconciler>>,
    agent_type: AgentType,
    provider: Option<&dyn AgentProvider>,
) -> Vec<SessionUpdate> {
    let mut reconciler_guard = match reconciler.lock() {
        Ok(guard) => guard,
        Err(_) => {
            // Mutex poisoned - pass through unchanged
            tracing::error!("TaskReconciler mutex poisoned");
            return vec![update.clone()];
        }
    };

    match update {
        SessionUpdate::ToolCall {
            tool_call,
            session_id,
        } => {
            if let Some(ref sid) = session_id {
                log_unclassified_tool_call(sid, tool_call);
            }
            // Seed tool name for streaming accumulator (streaming deltas lack toolName)
            if let Some(ref sid) = session_id {
                crate::acp::streaming_accumulator::seed_tool_name(
                    sid,
                    &tool_call.id,
                    &tool_call.name,
                    agent_type,
                );
            }
            let policy = provider
                .map(|provider| provider.task_reconciliation_policy())
                .unwrap_or(TaskReconciliationPolicy::Disabled);
            let outputs = reconciler_guard.handle_tool_call_with_policy(tool_call.clone(), policy);
            outputs
                .into_iter()
                .filter_map(|output| match output {
                    ReconcilerOutput::EmitToolCall(tc) => Some(SessionUpdate::ToolCall {
                        tool_call: tc,
                        session_id: session_id.clone(),
                    }),
                    ReconcilerOutput::EmitToolCallUpdate(upd) => {
                        Some(SessionUpdate::ToolCallUpdate {
                            update: upd,
                            session_id: session_id.clone(),
                        })
                    }
                    ReconcilerOutput::Buffered => None,
                })
                .collect()
        }
        SessionUpdate::ToolCallUpdate {
            update: tool_update,
            session_id,
        } => {
            if let Some(ref sid) = session_id {
                log_unclassified_tool_update(sid, tool_update);
            }
            // Check for streaming plan data before reconciling
            let streaming_plan = tool_update.streaming_plan.clone();

            let outputs = reconciler_guard.handle_tool_call_update(tool_update.clone());
            let mut results: Vec<SessionUpdate> = outputs
                .into_iter()
                .filter_map(|output| match output {
                    ReconcilerOutput::EmitToolCall(tc) => Some(SessionUpdate::ToolCall {
                        tool_call: tc,
                        session_id: session_id.clone(),
                    }),
                    ReconcilerOutput::EmitToolCallUpdate(upd) => {
                        Some(SessionUpdate::ToolCallUpdate {
                            update: upd,
                            session_id: session_id.clone(),
                        })
                    }
                    ReconcilerOutput::Buffered => None,
                })
                .collect();

            // If there's streaming plan data, also emit a Plan event
            if let Some(plan) = streaming_plan {
                results.push(SessionUpdate::Plan {
                    plan: enrich_plan_data(plan, agent_type, provider),
                    session_id: session_id.clone(),
                });
            }

            results
        }
        // Enrich plan events with derived markdown content and metadata
        SessionUpdate::Plan { .. } => {
            vec![enrich_plan_update(update.clone(), agent_type, provider)]
        }
        // All other update types pass through unchanged
        _ => vec![update.clone()],
    }
}

#[cfg(test)]
mod tests {
    use super::process_through_reconciler;
    use crate::acp::parsers::AgentType;
    use crate::acp::provider::{AgentProvider, SpawnConfig};
    use crate::acp::session_update::{
        SessionUpdate, ToolArguments, ToolCallData, ToolCallStatus, ToolKind,
    };
    use crate::acp::task_reconciler::{TaskReconciler, TaskReconciliationPolicy};
    use std::collections::HashMap;
    use std::sync::{Arc as StdArc, Mutex};

    struct CopilotTaskReconcilerProvider;

    impl AgentProvider for CopilotTaskReconcilerProvider {
        fn id(&self) -> &str {
            "copilot"
        }

        fn name(&self) -> &str {
            "GitHub Copilot"
        }

        fn spawn_config(&self) -> SpawnConfig {
            SpawnConfig {
                command: "copilot".to_string(),
                args: Vec::new(),
                env: HashMap::new(),
                env_strategy: None,
            }
        }

        fn task_reconciliation_policy(&self) -> TaskReconciliationPolicy {
            TaskReconciliationPolicy::ImplicitSingleActiveParent
        }
    }

    fn make_task_tool_call(id: &str) -> SessionUpdate {
        SessionUpdate::ToolCall {
            tool_call: ToolCallData {
                id: id.to_string(),
                name: "Task".to_string(),
                arguments: ToolArguments::Think {
                    description: Some("Explain the codebase".to_string()),
                    prompt: Some("Explore the repository and summarize it.".to_string()),
                    subagent_type: Some("explore".to_string()),
                    skill: None,
                    skill_args: None,
                    raw: None,
                },
                raw_input: None,
                status: ToolCallStatus::Pending,
                result: None,
                kind: Some(ToolKind::Task),
                title: Some("Explain the codebase".to_string()),
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

    fn make_parentless_child_tool_call(id: &str) -> SessionUpdate {
        SessionUpdate::ToolCall {
            tool_call: ToolCallData {
                id: id.to_string(),
                name: "Read".to_string(),
                arguments: ToolArguments::Read {
                    file_path: Some("/repo/README.md".to_string()),
                    source_context: None,
                },
                raw_input: None,
                status: ToolCallStatus::Pending,
                result: None,
                kind: Some(ToolKind::Read),
                title: Some("Read README".to_string()),
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
    fn copilot_parentless_child_is_attached_to_single_active_task() {
        let reconciler = StdArc::new(Mutex::new(TaskReconciler::new()));
        let provider = CopilotTaskReconcilerProvider;

        let parent_outputs = process_through_reconciler(
            &make_task_tool_call("task-1"),
            &reconciler,
            AgentType::Copilot,
            Some(&provider),
        );
        assert_eq!(parent_outputs.len(), 1);

        let child_outputs = process_through_reconciler(
            &make_parentless_child_tool_call("child-1"),
            &reconciler,
            AgentType::Copilot,
            Some(&provider),
        );

        assert_eq!(child_outputs.len(), 1);
        match &child_outputs[0] {
            SessionUpdate::ToolCall { tool_call, .. } => {
                assert_eq!(tool_call.id, "task-1");
                let children = tool_call
                    .task_children
                    .as_ref()
                    .expect("task children should be attached");
                assert_eq!(children.len(), 1);
                assert_eq!(children[0].id, "child-1");
            }
            other => panic!("expected parent task tool call, got {:?}", other),
        }
    }

    #[test]
    fn copilot_parentless_child_is_not_attached_when_multiple_tasks_are_active() {
        let reconciler = StdArc::new(Mutex::new(TaskReconciler::new()));
        let provider = CopilotTaskReconcilerProvider;

        process_through_reconciler(
            &make_task_tool_call("task-1"),
            &reconciler,
            AgentType::Copilot,
            Some(&provider),
        );
        process_through_reconciler(
            &make_task_tool_call("task-2"),
            &reconciler,
            AgentType::Copilot,
            Some(&provider),
        );

        let child_outputs = process_through_reconciler(
            &make_parentless_child_tool_call("child-1"),
            &reconciler,
            AgentType::Copilot,
            Some(&provider),
        );

        assert_eq!(child_outputs.len(), 1);
        match &child_outputs[0] {
            SessionUpdate::ToolCall { tool_call, .. } => {
                assert_eq!(tool_call.id, "child-1");
                assert!(tool_call.task_children.is_none());
            }
            other => panic!("expected standalone child tool call, got {:?}", other),
        }
    }
}
