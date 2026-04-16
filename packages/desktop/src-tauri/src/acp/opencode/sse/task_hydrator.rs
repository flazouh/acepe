use indexmap::IndexMap;
use serde_json::Value;
use std::collections::HashMap;

use crate::acp::session_update::{
    SessionUpdate, ToolArguments, ToolCallData, ToolCallStatus, ToolCallUpdateData, ToolKind,
};
use crate::session_converter::merge_tool_call_update;

#[derive(Debug, Clone)]
struct ParentTaskState {
    session_id: String,
    tool_call: ToolCallData,
    children: IndexMap<String, ToolCallData>,
}

impl ParentTaskState {
    fn assembled_tool_call(&self) -> ToolCallData {
        if self.children.is_empty() {
            return self.tool_call.clone();
        }

        let mut tool_call = self.tool_call.clone();
        tool_call.task_children = Some(self.children.values().cloned().collect());
        tool_call
    }
}

#[derive(Debug, Default)]
pub(super) struct OpenCodeTaskHydrator {
    parent_tasks: HashMap<String, ParentTaskState>,
    active_tasks_by_session: HashMap<String, IndexMap<String, ()>>,
    child_session_to_parent: HashMap<String, String>,
    child_tool_to_parent: HashMap<String, String>,
}

impl OpenCodeTaskHydrator {
    pub(super) fn apply_session_created(&mut self, properties: &Value) {
        let Some(child_session_id) = properties
            .get("info")
            .and_then(|info| info.get("id"))
            .and_then(|session_id| session_id.as_str())
        else {
            return;
        };

        let Some(parent_session_id) = properties
            .get("info")
            .and_then(|info| info.get("parentID").or_else(|| info.get("parentId")))
            .and_then(|parent_id| parent_id.as_str())
        else {
            return;
        };

        let Some(parent_id) = self
            .active_tasks_by_session
            .get(parent_session_id)
            .and_then(|tasks| tasks.last().map(|(task_id, _)| task_id.clone()))
        else {
            return;
        };

        self.child_session_to_parent
            .insert(child_session_id.to_string(), parent_id);
    }

    pub(super) fn apply_message_part_update(
        &mut self,
        properties: &Value,
        update: &SessionUpdate,
    ) -> Vec<SessionUpdate> {
        match update {
            SessionUpdate::ToolCall {
                tool_call,
                session_id,
            } => {
                self.track_parent_tool_call(properties, tool_call, session_id.as_deref());
                self.synthesize_parent_from_child_tool_call(tool_call, session_id.as_deref())
            }
            SessionUpdate::ToolCallUpdate { update, session_id } => {
                self.track_parent_tool_call_update(properties, update);
                self.synthesize_parent_from_child_tool_update(update, session_id.as_deref())
            }
            _ => Vec::new(),
        }
    }

    pub(super) fn apply_session_update(&mut self, update: &SessionUpdate) {
        if let SessionUpdate::TurnComplete {
            session_id: Some(session_id),
            ..
        } = update
        {
            self.cleanup_child_session(session_id);
        }
    }

    fn track_parent_tool_call(
        &mut self,
        properties: &Value,
        tool_call: &ToolCallData,
        session_id: Option<&str>,
    ) {
        if !is_task_tool(tool_call) {
            return;
        }

        let Some(parent_session_id) = session_id else {
            return;
        };

        let entry = self
            .parent_tasks
            .entry(tool_call.id.clone())
            .or_insert_with(|| ParentTaskState {
                session_id: parent_session_id.to_string(),
                tool_call: tool_call.clone(),
                children: IndexMap::new(),
            });

        entry.session_id = parent_session_id.to_string();
        entry.tool_call = merge_tool_call(entry.tool_call.clone(), tool_call.clone());
        self.active_tasks_by_session
            .entry(parent_session_id.to_string())
            .or_default()
            .insert(tool_call.id.clone(), ());

        if let Some(child_session_id) = extract_task_child_session_id(properties) {
            self.child_session_to_parent
                .insert(child_session_id, tool_call.id.clone());
        }
    }

    fn track_parent_tool_call_update(&mut self, properties: &Value, update: &ToolCallUpdateData) {
        if !is_task_tool_part(properties) {
            return;
        }

        if let Some(parent) = self.parent_tasks.get_mut(&update.tool_call_id) {
            merge_tool_call_update(&mut parent.tool_call, update);

            if update.status.as_ref().is_some_and(is_terminal_status) {
                remove_active_task(
                    &mut self.active_tasks_by_session,
                    &parent.session_id,
                    &update.tool_call_id,
                );
            }
        }

        if let Some(child_session_id) = extract_task_child_session_id(properties) {
            self.child_session_to_parent
                .insert(child_session_id, update.tool_call_id.clone());
        }
    }

    fn synthesize_parent_from_child_tool_call(
        &mut self,
        tool_call: &ToolCallData,
        session_id: Option<&str>,
    ) -> Vec<SessionUpdate> {
        let Some(parent_id) = session_id
            .and_then(|sid| self.child_session_to_parent.get(sid))
            .cloned()
        else {
            return Vec::new();
        };

        let Some(parent) = self.parent_tasks.get_mut(&parent_id) else {
            return Vec::new();
        };

        let mut child_tool = tool_call.clone();
        child_tool.parent_tool_use_id = Some(parent_id.clone());

        let merged_child = parent
            .children
            .get(&child_tool.id)
            .cloned()
            .map(|current| merge_tool_call(current, child_tool.clone()))
            .unwrap_or(child_tool.clone());

        parent
            .children
            .insert(child_tool.id.clone(), merged_child.clone());
        self.child_tool_to_parent
            .insert(child_tool.id.clone(), parent_id.clone());

        vec![SessionUpdate::ToolCall {
            tool_call: parent.assembled_tool_call(),
            session_id: Some(parent.session_id.clone()),
        }]
    }

    fn synthesize_parent_from_child_tool_update(
        &mut self,
        update: &ToolCallUpdateData,
        session_id: Option<&str>,
    ) -> Vec<SessionUpdate> {
        let Some(parent_id) = self
            .child_tool_to_parent
            .get(&update.tool_call_id)
            .cloned()
            .or_else(|| {
                session_id
                    .and_then(|sid| self.child_session_to_parent.get(sid))
                    .cloned()
            })
        else {
            return Vec::new();
        };

        let Some(parent) = self.parent_tasks.get_mut(&parent_id) else {
            return Vec::new();
        };

        let Some(child_tool) = parent.children.get_mut(&update.tool_call_id) else {
            return Vec::new();
        };

        merge_tool_call_update(child_tool, update);

        vec![SessionUpdate::ToolCall {
            tool_call: parent.assembled_tool_call(),
            session_id: Some(parent.session_id.clone()),
        }]
    }

    fn cleanup_child_session(&mut self, session_id: &str) {
        let Some(parent_id) = self.child_session_to_parent.remove(session_id) else {
            return;
        };

        if let Some(parent) = self.parent_tasks.remove(&parent_id) {
            remove_active_task(
                &mut self.active_tasks_by_session,
                &parent.session_id,
                &parent_id,
            );
            for child_id in parent.children.keys() {
                self.child_tool_to_parent.remove(child_id);
            }
        }
    }
}

fn remove_active_task(
    active_tasks_by_session: &mut HashMap<String, IndexMap<String, ()>>,
    session_id: &str,
    task_id: &str,
) {
    let should_remove_session = if let Some(tasks) = active_tasks_by_session.get_mut(session_id) {
        tasks.shift_remove(task_id);
        tasks.is_empty()
    } else {
        false
    };

    if should_remove_session {
        active_tasks_by_session.remove(session_id);
    }
}

fn extract_task_child_session_id(properties: &Value) -> Option<String> {
    if !is_task_tool_part(properties) {
        return None;
    }

    properties
        .get("part")
        .and_then(|part| part.get("state"))
        .and_then(|state| state.get("metadata"))
        .and_then(|metadata| metadata.get("sessionId"))
        .and_then(|session_id| session_id.as_str())
        .map(ToString::to_string)
}

fn is_task_tool_part(properties: &Value) -> bool {
    let tool_name = properties
        .get("part")
        .and_then(|part| part.get("tool").or_else(|| part.get("name")))
        .and_then(|tool| tool.as_str());

    matches!(tool_name, Some(name) if name.eq_ignore_ascii_case("task"))
}

fn is_task_tool(tool_call: &ToolCallData) -> bool {
    if tool_call.kind == Some(ToolKind::Task) {
        return true;
    }

    matches!(
        &tool_call.arguments,
        ToolArguments::Think {
            prompt,
            subagent_type,
            ..
        } if prompt.is_some() || subagent_type.is_some()
    )
}

fn merge_tool_call(current: ToolCallData, incoming: ToolCallData) -> ToolCallData {
    let next_status =
        if is_terminal_status(&current.status) && !is_terminal_status(&incoming.status) {
            current.status.clone()
        } else {
            incoming.status.clone()
        };
    let next_plan_approval_request_id = if incoming.awaiting_plan_approval {
        incoming
            .plan_approval_request_id
            .or(current.plan_approval_request_id)
    } else {
        None
    };

    ToolCallData {
        id: current.id,
        name: incoming.name,
        arguments: incoming.arguments,
        raw_input: incoming.raw_input.or(current.raw_input),
        status: next_status,
        result: incoming.result.or(current.result),
        kind: incoming.kind.or(current.kind),
        title: incoming.title.or(current.title),
        locations: incoming.locations.or(current.locations),
        skill_meta: incoming.skill_meta.or(current.skill_meta),
        normalized_questions: incoming
            .normalized_questions
            .or(current.normalized_questions),
        normalized_todos: incoming.normalized_todos.or(current.normalized_todos),
        parent_tool_use_id: incoming.parent_tool_use_id.or(current.parent_tool_use_id),
        task_children: incoming.task_children.or(current.task_children),
        question_answer: incoming.question_answer.or(current.question_answer),
        awaiting_plan_approval: incoming.awaiting_plan_approval,
        plan_approval_request_id: next_plan_approval_request_id,
    }
}

fn is_terminal_status(status: &ToolCallStatus) -> bool {
    matches!(status, ToolCallStatus::Completed | ToolCallStatus::Failed)
}

#[cfg(test)]
mod tests {
    use super::OpenCodeTaskHydrator;
    use crate::acp::opencode::sse::convert_message_part_to_session_update;
    use crate::acp::session_update::{SessionUpdate, ToolCallStatus};
    use serde_json::json;

    #[test]
    fn child_session_tools_rehydrate_parent_task_children() {
        let mut hydrator = OpenCodeTaskHydrator::default();

        let parent_running = json!({
            "part": {
                "id": "prt_task_parent",
                "sessionID": "ses_parent",
                "messageID": "msg_parent",
                "type": "tool",
                "callID": "call_task_parent",
                "tool": "task",
                "state": {
                    "status": "running",
                    "input": {
                        "description": "Explain codebase",
                        "prompt": "Inspect the repo",
                        "subagent_type": "repo-research-analyst"
                    }
                }
            }
        });

        let running_update = convert_message_part_to_session_update(&parent_running).unwrap();
        assert!(hydrator
            .apply_message_part_update(&parent_running, &running_update)
            .is_empty());

        let parent_completed = json!({
            "part": {
                "id": "prt_task_parent",
                "sessionID": "ses_parent",
                "messageID": "msg_parent",
                "type": "tool",
                "callID": "call_task_parent",
                "tool": "task",
                "state": {
                    "status": "completed",
                    "input": {
                        "description": "Explain codebase",
                        "prompt": "Inspect the repo",
                        "subagent_type": "repo-research-analyst"
                    },
                    "metadata": {
                        "sessionId": "ses_child"
                    },
                    "output": "<task_result>done</task_result>"
                }
            }
        });

        let completed_update = convert_message_part_to_session_update(&parent_completed).unwrap();
        assert!(matches!(
            completed_update,
            SessionUpdate::ToolCallUpdate { .. }
        ));
        assert!(hydrator
            .apply_message_part_update(&parent_completed, &completed_update)
            .is_empty());

        let child_tool_running = json!({
            "part": {
                "id": "prt_child_glob",
                "sessionID": "ses_child",
                "messageID": "msg_child",
                "type": "tool",
                "callID": "call_child_glob",
                "tool": "glob",
                "state": {
                    "status": "running",
                    "input": {
                        "path": "/Users/alex/Documents/acepe",
                        "pattern": "*"
                    }
                }
            }
        });

        let child_running_update =
            convert_message_part_to_session_update(&child_tool_running).unwrap();
        let synthesized =
            hydrator.apply_message_part_update(&child_tool_running, &child_running_update);

        assert_eq!(synthesized.len(), 1);
        match &synthesized[0] {
            SessionUpdate::ToolCall {
                tool_call,
                session_id,
            } => {
                assert_eq!(session_id.as_deref(), Some("ses_parent"));
                assert_eq!(tool_call.id, "call_task_parent");
                let children = tool_call.task_children.as_ref().expect("children");
                assert_eq!(children.len(), 1);
                assert_eq!(children[0].id, "call_child_glob");
                assert_eq!(
                    children[0].parent_tool_use_id.as_deref(),
                    Some("call_task_parent")
                );
            }
            other => panic!("Expected synthesized parent tool call, got {:?}", other),
        }

        let child_tool_completed = json!({
            "part": {
                "id": "prt_child_glob",
                "sessionID": "ses_child",
                "messageID": "msg_child",
                "type": "tool",
                "callID": "call_child_glob",
                "tool": "glob",
                "state": {
                    "status": "completed",
                    "input": {
                        "path": "/Users/alex/Documents/acepe",
                        "pattern": "*"
                    },
                    "output": "/Users/alex/Documents/acepe/README.md"
                }
            }
        });

        let child_completed_update =
            convert_message_part_to_session_update(&child_tool_completed).unwrap();
        let completed_parent =
            hydrator.apply_message_part_update(&child_tool_completed, &child_completed_update);

        assert_eq!(completed_parent.len(), 1);
        match &completed_parent[0] {
            SessionUpdate::ToolCall { tool_call, .. } => {
                let children = tool_call.task_children.as_ref().expect("children");
                assert_eq!(children[0].status, ToolCallStatus::Completed);
            }
            other => panic!("Expected synthesized parent tool call, got {:?}", other),
        }
    }

    #[test]
    fn child_session_created_before_parent_completion_still_hydrates_children() {
        let mut hydrator = OpenCodeTaskHydrator::default();

        let parent_running = json!({
            "part": {
                "id": "prt_task_parent",
                "sessionID": "ses_parent",
                "messageID": "msg_parent",
                "type": "tool",
                "callID": "call_task_parent",
                "tool": "task",
                "state": {
                    "status": "running",
                    "input": {
                        "description": "Explain codebase",
                        "prompt": "Inspect the repo",
                        "subagent_type": "repo-research-analyst"
                    }
                }
            }
        });

        let running_update = convert_message_part_to_session_update(&parent_running).unwrap();
        assert!(hydrator
            .apply_message_part_update(&parent_running, &running_update)
            .is_empty());

        hydrator.apply_session_created(&json!({
            "info": {
                "id": "ses_child",
                "parentID": "ses_parent"
            },
            "sessionID": "ses_child"
        }));

        let child_tool_running = json!({
            "part": {
                "id": "prt_child_glob",
                "sessionID": "ses_child",
                "messageID": "msg_child",
                "type": "tool",
                "callID": "call_child_glob",
                "tool": "glob",
                "state": {
                    "status": "running",
                    "input": {
                        "path": "/Users/alex/Documents/acepe",
                        "pattern": "*"
                    }
                }
            }
        });

        let child_running_update =
            convert_message_part_to_session_update(&child_tool_running).unwrap();
        let synthesized =
            hydrator.apply_message_part_update(&child_tool_running, &child_running_update);

        assert_eq!(synthesized.len(), 1);
        match &synthesized[0] {
            SessionUpdate::ToolCall {
                tool_call,
                session_id,
            } => {
                assert_eq!(session_id.as_deref(), Some("ses_parent"));
                assert_eq!(tool_call.id, "call_task_parent");
                let children = tool_call.task_children.as_ref().expect("children");
                assert_eq!(children.len(), 1);
                assert_eq!(children[0].id, "call_child_glob");
            }
            other => panic!("Expected synthesized parent tool call, got {:?}", other),
        }
    }
}
