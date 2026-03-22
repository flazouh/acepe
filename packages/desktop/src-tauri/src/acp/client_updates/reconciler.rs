use super::*;

pub(super) fn process_through_reconciler(
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
            // Seed tool name for streaming accumulator (streaming deltas lack toolName)
            if let Some(ref sid) = session_id {
                crate::acp::streaming_accumulator::seed_tool_name(
                    sid,
                    &tool_call.id,
                    &tool_call.name,
                );
            }
            let outputs = reconciler_guard.handle_tool_call(tool_call.clone());
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
