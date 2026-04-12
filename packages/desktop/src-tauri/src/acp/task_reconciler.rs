//! Task reconciler for assembling parent-child tool call relationships.
//!
//! Different agents handle sub-agents differently:
//! - Claude Code: Children arrive as separate events with `parent_tool_use_id`
//! - OpenCode: Children are bundled with parent in `metadata.summary`
//!
//! This module normalizes Claude Code's separate-event pattern into
//! pre-assembled `ToolCallData` with `task_children` populated.

use indexmap::{IndexMap, IndexSet};
use std::collections::HashMap;

use super::session_update::{
    ToolArguments, ToolCallData, ToolCallStatus, ToolCallUpdateData, ToolKind,
};
use super::tool_call_presentation::merge_tool_arguments as merge_canonical_tool_arguments;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum TaskReconciliationPolicy {
    #[default]
    Disabled,
    ExplicitParentIds,
    ImplicitSingleActiveParent,
}

impl TaskReconciliationPolicy {
    pub fn uses_task_reconciler(self) -> bool {
        !matches!(self, Self::Disabled)
    }

    fn infers_implicit_child_parent(self) -> bool {
        matches!(self, Self::ImplicitSingleActiveParent)
    }
}

/// A task being assembled with its children.
#[derive(Debug, Clone)]
struct BufferedTask {
    /// The parent tool call data.
    tool_call: ToolCallData,
    /// Children attached so far, keyed by child ID for fast updates.
    /// IndexMap preserves insertion order.
    children: IndexMap<String, ToolCallData>,
}

/// Reconciles parent-child relationships for tool calls.
///
/// For agents like Claude Code where children arrive as separate events,
/// this buffers parents and attaches children as they arrive, emitting
/// complete `ToolCallData` with `task_children` populated.
///
#[derive(Debug, Default)]
pub struct TaskReconciler {
    /// Active tasks being assembled (parent_id → BufferedTask).
    active_tasks: HashMap<String, BufferedTask>,

    /// Non-task tool calls tracked by ID so repeated same-ID tool_call events can
    /// be normalized into canonical updates instead of leaking provider-specific
    /// placeholder/enrichment sequencing to the frontend.
    active_tool_calls: HashMap<String, ToolCallData>,

    /// Orphaned children waiting for parent (parent_id → Vec<ToolCallData>).
    /// Handles race condition where child arrives before parent.
    pending_children: HashMap<String, Vec<ToolCallData>>,

    /// Child ID → Parent ID for fast lookup during updates.
    child_to_parent: HashMap<String, String>,

    /// Recently terminal tool IDs. Late same-ID traffic after terminal emission
    /// should be ignored rather than resurrecting a finished invocation.
    terminal_tool_call_ids: IndexSet<String>,
}

const MAX_TERMINAL_TOOL_CALL_IDS: usize = 1024;

/// Result of processing a tool call or update.
#[derive(Debug)]
#[allow(clippy::large_enum_variant)]
pub enum ReconcilerOutput {
    /// Emit this tool call to the frontend (may have task_children attached).
    EmitToolCall(ToolCallData),
    /// Emit this tool call update to the frontend.
    EmitToolCallUpdate(ToolCallUpdateData),
    /// No output (child was buffered, waiting for parent).
    Buffered,
}

impl TaskReconciler {
    /// Create a new TaskReconciler.
    pub fn new() -> Self {
        Self::default()
    }

    pub fn parent_for_child(&self, tool_call_id: &str) -> Option<String> {
        self.child_to_parent.get(tool_call_id).cloned()
    }

    /// Process an incoming tool call.
    ///
    /// Returns outputs to emit to the frontend.
    pub fn handle_tool_call(&mut self, tool_call: ToolCallData) -> Vec<ReconcilerOutput> {
        self.handle_tool_call_with_policy(tool_call, TaskReconciliationPolicy::Disabled)
    }

    /// Process an incoming tool call with provider-owned reconciliation policy.
    pub fn handle_tool_call_with_policy(
        &mut self,
        tool_call: ToolCallData,
        policy: TaskReconciliationPolicy,
    ) -> Vec<ReconcilerOutput> {
        self.handle_tool_call_with_options(tool_call, policy.infers_implicit_child_parent())
    }

    fn handle_tool_call_with_options(
        &mut self,
        tool_call: ToolCallData,
        infer_implicit_child_parent: bool,
    ) -> Vec<ReconcilerOutput> {
        if self.terminal_tool_call_ids.contains(&tool_call.id) {
            tracing::warn!(
                tool_call_id = %tool_call.id,
                "Ignoring late same-id tool_call after terminal emission"
            );
            return vec![];
        }

        if self.active_tool_calls.contains_key(&tool_call.id) {
            let (merged_tool_call, should_cleanup) = {
                let existing = self
                    .active_tool_calls
                    .get_mut(&tool_call.id)
                    .expect("tool call should exist when duplicate is detected");
                let merged = merge_tool_call(existing.clone(), tool_call);
                let is_terminal = is_terminal_status(&merged.status);
                *existing = merged.clone();
                (merged, is_terminal)
            };
            if should_cleanup {
                self.active_tool_calls.remove(&merged_tool_call.id);
                self.mark_terminal_tool_call(merged_tool_call.id.clone());
            }
            return vec![ReconcilerOutput::EmitToolCallUpdate(tool_call_to_update(
                &merged_tool_call,
            ))];
        }

        // Case 1: This is a child (has explicit parent_tool_use_id)
        if let Some(parent_id) = &tool_call.parent_tool_use_id {
            return self.handle_child_tool_call(parent_id.clone(), tool_call);
        }

        // Case 2: This is a parent task (has subagent characteristics)
        if self.is_task_tool(&tool_call) {
            return self.handle_parent_task(tool_call);
        }

        if infer_implicit_child_parent {
            if let Some(parent_id) = self.infer_implicit_parent_id(&tool_call) {
                return self.handle_child_tool_call(parent_id, tool_call);
            }
        }

        // Case 3: Regular tool call with no explicit parent - pass through unchanged
        if !is_terminal_status(&tool_call.status) {
            self.active_tool_calls
                .insert(tool_call.id.clone(), tool_call.clone());
        } else {
            self.mark_terminal_tool_call(tool_call.id.clone());
        }
        vec![ReconcilerOutput::EmitToolCall(tool_call)]
    }

    /// Process a tool call update.
    ///
    /// Returns outputs to emit to the frontend.
    pub fn handle_tool_call_update(&mut self, update: ToolCallUpdateData) -> Vec<ReconcilerOutput> {
        let tool_call_id = &update.tool_call_id;

        if self.terminal_tool_call_ids.contains(tool_call_id) {
            tracing::warn!(
                tool_call_id = %tool_call_id,
                "Ignoring late same-id tool_call_update after terminal emission"
            );
            return vec![];
        }

        // Check if this is a child update
        if let Some(parent_id) = self.child_to_parent.get(tool_call_id).cloned() {
            return self.handle_child_update(&parent_id, update);
        }

        // Check if this is a parent task update
        if self.active_tasks.contains_key(tool_call_id) {
            return self.handle_parent_update(update);
        }

        if self.active_tool_calls.contains_key(tool_call_id) {
            let should_cleanup = {
                let tool_call = self
                    .active_tool_calls
                    .get_mut(tool_call_id)
                    .expect("tool call should exist when update arrives");
                apply_update_to_tool_call(tool_call, &update);
                update.status.as_ref().is_some_and(|status| {
                    matches!(status, ToolCallStatus::Completed | ToolCallStatus::Failed)
                })
            };
            if should_cleanup {
                self.active_tool_calls.remove(tool_call_id);
                self.mark_terminal_tool_call(tool_call_id.clone());
            }
        }

        // Regular tool call update - pass through unchanged
        vec![ReconcilerOutput::EmitToolCallUpdate(update)]
    }

    /// Handle a child tool call arriving.
    fn handle_child_tool_call(
        &mut self,
        parent_id: String,
        tool_call: ToolCallData,
    ) -> Vec<ReconcilerOutput> {
        let child_id = tool_call.id.clone();
        let child_is_terminal = is_terminal_status(&tool_call.status);

        // Register the child → parent mapping
        self.child_to_parent
            .insert(child_id.clone(), parent_id.clone());

        let outputs = if let Some(parent) = self.active_tasks.get_mut(&parent_id) {
            // Parent exists → attach child and emit updated parent
            parent.children.insert(child_id.clone(), tool_call);
            if let Some(assembled) = self.assemble_task(&parent_id) {
                vec![ReconcilerOutput::EmitToolCall(assembled)]
            } else {
                tracing::warn!(parent_id = %parent_id, "Task missing while handling child tool call");
                vec![ReconcilerOutput::Buffered]
            }
        } else {
            // Parent not yet seen → buffer as orphan
            self.pending_children
                .entry(parent_id)
                .or_default()
                .push(tool_call);
            vec![ReconcilerOutput::Buffered]
        };

        if child_is_terminal {
            self.mark_terminal_tool_call(child_id);
        }

        outputs
    }

    /// Handle a parent task arriving.
    fn handle_parent_task(&mut self, tool_call: ToolCallData) -> Vec<ReconcilerOutput> {
        let task_id = tool_call.id.clone();
        let task_is_terminal = is_terminal_status(&tool_call.status);

        // Create buffered task
        let mut buffered = BufferedTask {
            tool_call,
            children: IndexMap::new(),
        };

        // Flush any orphaned children waiting for this parent
        if let Some(orphans) = self.pending_children.remove(&task_id) {
            for child in orphans {
                self.child_to_parent
                    .insert(child.id.clone(), task_id.clone());
                buffered.children.insert(child.id.clone(), child);
            }
        }

        self.active_tasks.insert(task_id.clone(), buffered);

        // Emit initial task state (may have children if they arrived early)
        let outputs = if let Some(assembled) = self.assemble_task(&task_id) {
            vec![ReconcilerOutput::EmitToolCall(assembled)]
        } else {
            tracing::warn!(task_id = %task_id, "Task missing after insertion");
            vec![ReconcilerOutput::Buffered]
        };

        if task_is_terminal {
            self.cleanup_task(&task_id);
        }

        outputs
    }

    /// Handle an update to a child tool call.
    ///
    /// The backend owns parent/child assembly semantics, so child mutations
    /// re-emit the assembled parent snapshot after internal state is updated.
    fn handle_child_update(
        &mut self,
        parent_id: &str,
        update: ToolCallUpdateData,
    ) -> Vec<ReconcilerOutput> {
        if let Some(parent) = self.active_tasks.get_mut(parent_id) {
            if let Some(child) = parent.children.get_mut(&update.tool_call_id) {
                // Apply update to child in our internal state
                apply_update_to_tool_call(child, &update);
            }

            if let Some(assembled) = self.assemble_task(parent_id) {
                vec![ReconcilerOutput::EmitToolCall(assembled)]
            } else {
                tracing::warn!(
                    parent_id = %parent_id,
                    child_id = %update.tool_call_id,
                    "Parent missing while re-emitting child mutation"
                );
                vec![ReconcilerOutput::EmitToolCallUpdate(update)]
            }
        } else {
            // Parent not found - pass through
            vec![ReconcilerOutput::EmitToolCallUpdate(update)]
        }
    }

    /// Handle an update to a parent task.
    fn handle_parent_update(&mut self, update: ToolCallUpdateData) -> Vec<ReconcilerOutput> {
        let task_id = update.tool_call_id.clone();
        let is_terminal = update
            .status
            .as_ref()
            .map(|s| matches!(s, ToolCallStatus::Completed | ToolCallStatus::Failed))
            .unwrap_or(false);

        if let Some(parent) = self.active_tasks.get_mut(&task_id) {
            // Apply update to parent
            apply_update_to_tool_call(&mut parent.tool_call, &update);
        }

        let output = if let Some(assembled) = self.assemble_task(&task_id) {
            vec![ReconcilerOutput::EmitToolCall(assembled)]
        } else {
            tracing::warn!(task_id = %task_id, "Task missing while handling parent update");
            vec![ReconcilerOutput::EmitToolCallUpdate(update.clone())]
        };

        // Cleanup if terminal state
        if is_terminal {
            self.cleanup_task(&task_id);
        }

        output
    }

    /// Assemble a task with its children into a complete ToolCallData.
    fn assemble_task(&self, task_id: &str) -> Option<ToolCallData> {
        let parent = self.active_tasks.get(task_id)?;

        let mut tool_call = parent.tool_call.clone();
        tool_call.task_children = if parent.children.is_empty() {
            None
        } else {
            Some(parent.children.values().cloned().collect())
        };

        Some(tool_call)
    }

    /// Check if a tool call is a task (sub-agent spawn).
    ///
    /// Checks both `kind` (derived from tool name by the parser) and arguments.
    /// The kind check is essential because the initial tool_call often arrives
    /// with empty rawInput (arguments are all None), so argument checks alone
    /// would miss it.
    fn is_task_tool(&self, tool_call: &ToolCallData) -> bool {
        // Primary check: kind derived from tool name by agent parser
        if tool_call.kind == Some(ToolKind::Task) {
            return true;
        }
        // Fallback: check arguments for subagent characteristics
        match &tool_call.arguments {
            ToolArguments::Think {
                subagent_type,
                prompt,
                ..
            } => subagent_type.is_some() || prompt.is_some(),
            _ => false,
        }
    }

    fn infer_implicit_parent_id(&self, tool_call: &ToolCallData) -> Option<String> {
        if !matches!(
            tool_call.status,
            ToolCallStatus::Pending | ToolCallStatus::InProgress
        ) {
            return None;
        }

        let mut active_task_ids = self.active_tasks.keys();
        let parent_id = active_task_ids.next()?.clone();

        if active_task_ids.next().is_some() {
            return None;
        }

        Some(parent_id)
    }

    /// Cleanup a completed task and its child mappings.
    fn cleanup_task(&mut self, task_id: &str) {
        if let Some(task) = self.active_tasks.remove(task_id) {
            let child_ids: Vec<_> = task.children.keys().cloned().collect();
            self.mark_terminal_tool_call(task_id.to_string());
            for child_id in child_ids {
                self.mark_terminal_tool_call(child_id.clone());
                self.child_to_parent.remove(&child_id);
            }
        }
    }

    fn mark_terminal_tool_call(&mut self, tool_call_id: String) {
        self.terminal_tool_call_ids.shift_remove(&tool_call_id);
        self.terminal_tool_call_ids.insert(tool_call_id);

        while self.terminal_tool_call_ids.len() > MAX_TERMINAL_TOOL_CALL_IDS {
            self.terminal_tool_call_ids.shift_remove_index(0);
        }
    }
}

fn merge_tool_arguments(current: ToolArguments, incoming: ToolArguments) -> ToolArguments {
    merge_canonical_tool_arguments(current, incoming)
}

/// Apply a tool call update to an existing tool call.
fn apply_update_to_tool_call(tool_call: &mut ToolCallData, update: &ToolCallUpdateData) {
    if let Some(status) = &update.status {
        // Prevent status regression: terminal states should never downgrade.
        // Mirrors frontend's resolveNextStatus() pattern.
        if !is_terminal_status(&tool_call.status) || is_terminal_status(status) {
            tool_call.status = status.clone();
        }
    }
    if let Some(result) = &update.result {
        tool_call.result = Some(result.clone());
    }
    if let Some(title) = &update.title {
        tool_call.title = Some(title.clone());
    }
    if let Some(locations) = &update.locations {
        tool_call.locations = Some(locations.clone());
    }
    if let Some(arguments) = &update.arguments {
        tool_call.arguments = merge_tool_arguments(tool_call.arguments.clone(), arguments.clone());
    }
    // Note: raw_output and content are not applied to ToolCallData
    // as they have different structures
}

fn tool_call_to_update(tool_call: &ToolCallData) -> ToolCallUpdateData {
    ToolCallUpdateData {
        tool_call_id: tool_call.id.clone(),
        status: Some(tool_call.status.clone()),
        result: tool_call.result.clone(),
        content: None,
        raw_output: None,
        title: tool_call.title.clone(),
        locations: tool_call.locations.clone(),
        streaming_input_delta: None,
        normalized_todos: tool_call.normalized_todos.clone(),
        normalized_questions: tool_call.normalized_questions.clone(),
        streaming_arguments: None,
        streaming_plan: None,
        arguments: Some(tool_call.arguments.clone()),
        failure_reason: None,
    }
}

fn merge_tool_call(current: ToolCallData, incoming: ToolCallData) -> ToolCallData {
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
        arguments: merge_tool_arguments(current.arguments, incoming.arguments),
        raw_input: incoming.raw_input.or(current.raw_input),
        status: incoming.status,
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
    use super::*;
    use crate::acp::session_update::ToolKind;

    fn make_task_tool_call(id: &str) -> ToolCallData {
        ToolCallData {
            id: id.to_string(),
            name: "Task".to_string(),
            arguments: ToolArguments::Think {
                description: Some("Test task".to_string()),
                prompt: Some("Do something".to_string()),
                subagent_type: Some("Explore".to_string()),
                skill: None,
                skill_args: None,
                raw: None,
            },
            raw_input: None,
            status: ToolCallStatus::Pending,
            result: None,
            kind: Some(ToolKind::Task),
            title: None,
            locations: None,
            skill_meta: None,
            normalized_questions: None,
            normalized_todos: None,
            parent_tool_use_id: None,
            task_children: None,
            question_answer: None,
            awaiting_plan_approval: false,
            plan_approval_request_id: None,
        }
    }

    /// Simulates a Task tool call as Claude Code ACP actually sends it:
    /// empty rawInput on the initial event, kind derived from tool name.
    fn make_task_tool_call_empty_input(id: &str) -> ToolCallData {
        ToolCallData {
            id: id.to_string(),
            name: "Task".to_string(),
            arguments: ToolArguments::Think {
                description: None,
                prompt: None,
                subagent_type: None,
                skill: None,
                skill_args: None,
                raw: None,
            },
            raw_input: None,
            status: ToolCallStatus::Pending,
            result: None,
            kind: Some(ToolKind::Task),
            title: None,
            locations: None,
            skill_meta: None,
            normalized_questions: None,
            normalized_todos: None,
            parent_tool_use_id: None,
            task_children: None,
            question_answer: None,
            awaiting_plan_approval: false,
            plan_approval_request_id: None,
        }
    }

    fn make_child_tool_call(id: &str, parent_id: &str) -> ToolCallData {
        ToolCallData {
            id: id.to_string(),
            name: "Read".to_string(),
            arguments: ToolArguments::Read {
                file_path: Some("/test/file.rs".to_string()),
            },
            raw_input: None,
            status: ToolCallStatus::Pending,
            result: None,
            kind: Some(ToolKind::Read),
            title: None,
            locations: None,
            skill_meta: None,
            normalized_questions: None,
            normalized_todos: None,
            parent_tool_use_id: Some(parent_id.to_string()),
            task_children: None,
            question_answer: None,
            awaiting_plan_approval: false,
            plan_approval_request_id: None,
        }
    }

    fn make_regular_tool_call(id: &str) -> ToolCallData {
        ToolCallData {
            id: id.to_string(),
            name: "Read".to_string(),
            arguments: ToolArguments::Read {
                file_path: Some("/test/file.rs".to_string()),
            },
            raw_input: None,
            status: ToolCallStatus::Pending,
            result: None,
            kind: Some(ToolKind::Read),
            title: None,
            locations: None,
            skill_meta: None,
            normalized_questions: None,
            normalized_todos: None,
            parent_tool_use_id: None,
            task_children: None,
            question_answer: None,
            awaiting_plan_approval: false,
            plan_approval_request_id: None,
        }
    }

    #[test]
    fn regular_tool_passes_through() {
        let mut reconciler = TaskReconciler::new();
        let tool_call = make_regular_tool_call("tool-1");

        let outputs = reconciler.handle_tool_call(tool_call.clone());

        assert_eq!(outputs.len(), 1);
        match &outputs[0] {
            ReconcilerOutput::EmitToolCall(tc) => {
                assert_eq!(tc.id, "tool-1");
                assert!(tc.task_children.is_none());
            }
            _ => panic!("Expected EmitToolCall"),
        }
    }

    #[test]
    fn parent_task_is_buffered_and_emitted() {
        let mut reconciler = TaskReconciler::new();
        let task = make_task_tool_call("task-1");

        let outputs = reconciler.handle_tool_call(task);

        assert_eq!(outputs.len(), 1);
        match &outputs[0] {
            ReconcilerOutput::EmitToolCall(tc) => {
                assert_eq!(tc.id, "task-1");
                assert!(tc.task_children.is_none()); // No children yet
            }
            _ => panic!("Expected EmitToolCall"),
        }

        // Task should be in active_tasks
        assert!(reconciler.active_tasks.contains_key("task-1"));
    }

    #[test]
    fn child_after_parent_is_attached() {
        let mut reconciler = TaskReconciler::new();

        // Parent arrives first
        let task = make_task_tool_call("task-1");
        reconciler.handle_tool_call(task);

        // Child arrives
        let child = make_child_tool_call("child-1", "task-1");
        let outputs = reconciler.handle_tool_call(child);

        assert_eq!(outputs.len(), 1);
        match &outputs[0] {
            ReconcilerOutput::EmitToolCall(tc) => {
                assert_eq!(tc.id, "task-1");
                let children = tc.task_children.as_ref().unwrap();
                assert_eq!(children.len(), 1);
                assert_eq!(children[0].id, "child-1");
            }
            _ => panic!("Expected EmitToolCall"),
        }
    }

    #[test]
    fn child_before_parent_is_buffered_then_attached() {
        let mut reconciler = TaskReconciler::new();

        // Child arrives first (orphan)
        let child = make_child_tool_call("child-1", "task-1");
        let outputs = reconciler.handle_tool_call(child);

        // Should be buffered, not emitted
        assert_eq!(outputs.len(), 1);
        matches!(&outputs[0], ReconcilerOutput::Buffered);

        // Parent arrives
        let task = make_task_tool_call("task-1");
        let outputs = reconciler.handle_tool_call(task);

        // Parent should have the orphaned child attached
        assert_eq!(outputs.len(), 1);
        match &outputs[0] {
            ReconcilerOutput::EmitToolCall(tc) => {
                assert_eq!(tc.id, "task-1");
                let children = tc.task_children.as_ref().unwrap();
                assert_eq!(children.len(), 1);
                assert_eq!(children[0].id, "child-1");
            }
            _ => panic!("Expected EmitToolCall"),
        }
    }

    #[test]
    fn child_update_emits_update_not_full_parent() {
        let mut reconciler = TaskReconciler::new();

        // Setup: parent with child
        let task = make_task_tool_call("task-1");
        reconciler.handle_tool_call(task);
        let child = make_child_tool_call("child-1", "task-1");
        reconciler.handle_tool_call(child);

        // Update the child
        let update = ToolCallUpdateData {
            tool_call_id: "child-1".to_string(),
            status: Some(ToolCallStatus::Completed),
            result: Some(serde_json::json!({"content": "file contents"})),
            content: None,
            raw_output: None,
            title: Some("Read file.rs".to_string()),
            locations: None,
            streaming_input_delta: None,
            normalized_todos: None,
            normalized_questions: None,
            streaming_arguments: None,
            streaming_plan: None,
            arguments: None,
            failure_reason: None,
        };
        let outputs = reconciler.handle_tool_call_update(update);

        // Child mutations should re-emit the assembled parent so the frontend
        // does not need to own parent/child merge semantics.
        assert_eq!(outputs.len(), 1);
        match &outputs[0] {
            ReconcilerOutput::EmitToolCall(parent) => {
                assert_eq!(parent.id, "task-1");
                let children = parent
                    .task_children
                    .as_ref()
                    .expect("assembled parent should include child state");
                assert_eq!(children.len(), 1);
                assert_eq!(children[0].id, "child-1");
                assert_eq!(children[0].status, ToolCallStatus::Completed);
                assert_eq!(children[0].title, Some("Read file.rs".to_string()));
            }
            _ => panic!("Expected EmitToolCall re-emission, not child update"),
        }

        // Verify internal state is still updated correctly
        let assembled = reconciler.assemble_task("task-1").unwrap();
        let children = assembled.task_children.as_ref().unwrap();
        assert_eq!(children[0].status, ToolCallStatus::Completed);
        assert_eq!(children[0].title, Some("Read file.rs".to_string()));
    }

    #[test]
    fn parent_completion_cleans_up() {
        let mut reconciler = TaskReconciler::new();

        // Setup: parent with child
        let task = make_task_tool_call("task-1");
        reconciler.handle_tool_call(task);
        let child = make_child_tool_call("child-1", "task-1");
        reconciler.handle_tool_call(child);

        // Complete the parent
        let update = ToolCallUpdateData {
            tool_call_id: "task-1".to_string(),
            status: Some(ToolCallStatus::Completed),
            result: Some(serde_json::json!({"summary": "done"})),
            content: None,
            raw_output: None,
            title: None,
            locations: None,
            streaming_input_delta: None,
            normalized_todos: None,
            normalized_questions: None,
            streaming_arguments: None,
            streaming_plan: None,
            arguments: None,
            failure_reason: None,
        };
        reconciler.handle_tool_call_update(update);

        // Task and child mappings should be cleaned up
        assert!(!reconciler.active_tasks.contains_key("task-1"));
        assert!(!reconciler.child_to_parent.contains_key("child-1"));
    }

    #[test]
    fn multiple_children_preserve_order() {
        let mut reconciler = TaskReconciler::new();

        // Parent arrives
        let task = make_task_tool_call("task-1");
        reconciler.handle_tool_call(task);

        // Multiple children arrive
        for i in 1..=3 {
            let child = make_child_tool_call(&format!("child-{}", i), "task-1");
            reconciler.handle_tool_call(child);
        }

        // Get final state
        let assembled = reconciler.assemble_task("task-1").unwrap();
        let children = assembled.task_children.unwrap();

        assert_eq!(children.len(), 3);
        assert_eq!(children[0].id, "child-1");
        assert_eq!(children[1].id, "child-2");
        assert_eq!(children[2].id, "child-3");
    }

    #[test]
    fn task_detected_by_kind_even_with_empty_arguments() {
        let mut reconciler = TaskReconciler::new();
        let task = make_task_tool_call_empty_input("task-1");

        let outputs = reconciler.handle_tool_call(task);

        assert_eq!(outputs.len(), 1);
        match &outputs[0] {
            ReconcilerOutput::EmitToolCall(tc) => {
                assert_eq!(tc.id, "task-1");
            }
            _ => panic!("Expected EmitToolCall"),
        }

        // Should be tracked as active task
        assert!(reconciler.active_tasks.contains_key("task-1"));
    }

    #[test]
    fn implicit_single_active_parent_policy_attaches_unparented_child() {
        let mut reconciler = TaskReconciler::new();

        let task = make_task_tool_call_empty_input("task-1");
        reconciler.handle_tool_call(task);

        let child = make_regular_tool_call("child-1");
        let outputs = reconciler.handle_tool_call_with_options(child, true);

        assert_eq!(outputs.len(), 1);
        match &outputs[0] {
            ReconcilerOutput::EmitToolCall(tc) => {
                assert_eq!(tc.id, "task-1");
                let children = tc
                    .task_children
                    .as_ref()
                    .expect("implicit policy should attach child");
                assert_eq!(children.len(), 1);
                assert_eq!(children[0].id, "child-1");
            }
            _ => panic!("Expected EmitToolCall"),
        }
    }

    #[test]
    fn tool_without_parent_tool_use_id_passes_through_even_when_task_is_active() {
        let mut reconciler = TaskReconciler::new();

        // Task arrives first
        let task = make_task_tool_call_empty_input("task-1");
        reconciler.handle_tool_call(task);

        // Regular tool call arrives without explicit parent
        let child = make_regular_tool_call("child-1");
        let outputs = reconciler.handle_tool_call(child);

        assert_eq!(outputs.len(), 1);
        match &outputs[0] {
            ReconcilerOutput::EmitToolCall(tc) => {
                assert_eq!(tc.id, "child-1");
                assert!(tc.task_children.is_none());
            }
            _ => panic!("Expected EmitToolCall"),
        }
    }

    #[test]
    fn no_active_tasks_passes_through() {
        let mut reconciler = TaskReconciler::new();

        // No active tasks - regular tool call passes through
        let tool = make_regular_tool_call("tool-1");
        let outputs = reconciler.handle_tool_call(tool);

        assert_eq!(outputs.len(), 1);
        match &outputs[0] {
            ReconcilerOutput::EmitToolCall(tc) => {
                assert_eq!(tc.id, "tool-1");
                assert!(tc.task_children.is_none());
            }
            _ => panic!("Expected EmitToolCall"),
        }
    }

    #[test]
    fn repeated_regular_tool_call_is_normalized_into_tool_call_update() {
        let mut reconciler = TaskReconciler::new();
        let initial = ToolCallData {
            id: "tool-1".to_string(),
            name: "Read".to_string(),
            arguments: ToolArguments::Read { file_path: None },
            raw_input: None,
            status: ToolCallStatus::Pending,
            result: None,
            kind: Some(ToolKind::Read),
            title: Some("Read File".to_string()),
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
        let enriched = ToolCallData {
            id: "tool-1".to_string(),
            name: "Read".to_string(),
            arguments: ToolArguments::Read {
                file_path: Some("/tmp/example.rs".to_string()),
            },
            raw_input: None,
            status: ToolCallStatus::Pending,
            result: None,
            kind: Some(ToolKind::Read),
            title: Some("Read `/tmp/example.rs`".to_string()),
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

        let first_outputs = reconciler.handle_tool_call(initial);
        assert!(matches!(
            &first_outputs[0],
            ReconcilerOutput::EmitToolCall(tool_call) if tool_call.id == "tool-1"
        ));

        let second_outputs = reconciler.handle_tool_call(enriched);
        assert_eq!(second_outputs.len(), 1);
        match &second_outputs[0] {
            ReconcilerOutput::EmitToolCallUpdate(update) => {
                assert_eq!(update.tool_call_id, "tool-1");
                assert_eq!(update.title.as_deref(), Some("Read `/tmp/example.rs`"));
                match update.arguments.as_ref() {
                    Some(ToolArguments::Read { file_path }) => {
                        assert_eq!(file_path.as_deref(), Some("/tmp/example.rs"));
                    }
                    other => panic!("Expected read arguments, got {:?}", other),
                }
            }
            other => panic!("Expected EmitToolCallUpdate, got {:?}", other),
        }
    }

    #[test]
    fn merge_tool_call_clears_resolved_plan_approval_state() {
        let current = ToolCallData {
            id: "tool-1".to_string(),
            name: "CreatePlan".to_string(),
            arguments: ToolArguments::Other {
                raw: serde_json::Value::Null,
            },
            raw_input: None,
            status: ToolCallStatus::Pending,
            result: None,
            kind: None,
            title: None,
            locations: None,
            skill_meta: None,
            normalized_questions: None,
            normalized_todos: None,
            parent_tool_use_id: None,
            task_children: None,
            question_answer: None,
            awaiting_plan_approval: true,
            plan_approval_request_id: Some(77),
        };
        let incoming = ToolCallData {
            id: "tool-1".to_string(),
            name: "CreatePlan".to_string(),
            arguments: ToolArguments::Other {
                raw: serde_json::Value::Null,
            },
            raw_input: None,
            status: ToolCallStatus::Pending,
            result: None,
            kind: None,
            title: None,
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

        let merged = merge_tool_call(current, incoming);

        assert!(!merged.awaiting_plan_approval);
        assert_eq!(merged.plan_approval_request_id, None);
    }

    #[test]
    fn repeated_edit_tool_call_preserves_richer_arguments_when_duplicate_is_sparse() {
        let mut reconciler = TaskReconciler::new();
        let initial = ToolCallData {
            id: "tool-1".to_string(),
            name: "Edit".to_string(),
            arguments: ToolArguments::Edit {
                edits: vec![crate::acp::session_update::EditEntry {
                    file_path: Some("/tmp/example.rs".to_string()),
                    move_from: None,
                    old_string: Some("before".to_string()),
                    new_string: Some("after".to_string()),
                    content: None,
                }],
            },
            raw_input: None,
            status: ToolCallStatus::Pending,
            result: None,
            kind: Some(ToolKind::Edit),
            title: Some("Edit /tmp/example.rs".to_string()),
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
        let sparse_duplicate = ToolCallData {
            id: "tool-1".to_string(),
            name: "Edit".to_string(),
            arguments: ToolArguments::Edit {
                edits: vec![crate::acp::session_update::EditEntry {
                    file_path: None,
                    move_from: None,
                    old_string: None,
                    new_string: None,
                    content: None,
                }],
            },
            raw_input: None,
            status: ToolCallStatus::Completed,
            result: None,
            kind: Some(ToolKind::Edit),
            title: Some("Edit File".to_string()),
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

        let first_outputs = reconciler.handle_tool_call(initial);
        assert!(matches!(
            &first_outputs[0],
            ReconcilerOutput::EmitToolCall(tool_call) if tool_call.id == "tool-1"
        ));

        let second_outputs = reconciler.handle_tool_call(sparse_duplicate);
        assert_eq!(second_outputs.len(), 1);
        match &second_outputs[0] {
            ReconcilerOutput::EmitToolCallUpdate(update) => match update.arguments.as_ref() {
                Some(ToolArguments::Edit { edits }) => {
                    let first_edit = edits.first().expect("expected edit entry");
                    assert_eq!(first_edit.file_path.as_deref(), Some("/tmp/example.rs"));
                    assert_eq!(first_edit.old_string.as_deref(), Some("before"));
                    assert_eq!(first_edit.new_string.as_deref(), Some("after"));
                }
                other => panic!("Expected edit arguments, got {:?}", other),
            },
            other => panic!("Expected EmitToolCallUpdate, got {:?}", other),
        }
    }

    #[test]
    fn late_same_id_tool_call_after_terminal_is_ignored() {
        let mut reconciler = TaskReconciler::new();

        let first_outputs = reconciler.handle_tool_call(make_regular_tool_call("tool-1"));
        assert!(matches!(
            &first_outputs[0],
            ReconcilerOutput::EmitToolCall(tool_call) if tool_call.id == "tool-1"
        ));

        let terminal_outputs = reconciler.handle_tool_call_update(ToolCallUpdateData {
            tool_call_id: "tool-1".to_string(),
            status: Some(ToolCallStatus::Completed),
            result: Some(serde_json::json!({"done": true})),
            content: None,
            raw_output: None,
            title: Some("Done".to_string()),
            locations: None,
            streaming_input_delta: None,
            normalized_todos: None,
            normalized_questions: None,
            streaming_arguments: None,
            streaming_plan: None,
            arguments: None,
            failure_reason: None,
        });
        assert_eq!(terminal_outputs.len(), 1);

        let late_outputs = reconciler.handle_tool_call(make_regular_tool_call("tool-1"));
        assert!(late_outputs.is_empty());
    }

    #[test]
    fn late_same_id_tool_call_update_after_terminal_is_ignored() {
        let mut reconciler = TaskReconciler::new();

        reconciler.handle_tool_call(make_regular_tool_call("tool-1"));
        let terminal_outputs = reconciler.handle_tool_call_update(ToolCallUpdateData {
            tool_call_id: "tool-1".to_string(),
            status: Some(ToolCallStatus::Completed),
            result: Some(serde_json::json!({"done": true})),
            content: None,
            raw_output: None,
            title: Some("Done".to_string()),
            locations: None,
            streaming_input_delta: None,
            normalized_todos: None,
            normalized_questions: None,
            streaming_arguments: None,
            streaming_plan: None,
            arguments: None,
            failure_reason: None,
        });
        assert_eq!(terminal_outputs.len(), 1);

        let late_outputs = reconciler.handle_tool_call_update(ToolCallUpdateData {
            tool_call_id: "tool-1".to_string(),
            status: Some(ToolCallStatus::InProgress),
            result: None,
            content: None,
            raw_output: None,
            title: Some("Late replay".to_string()),
            locations: None,
            streaming_input_delta: None,
            normalized_todos: None,
            normalized_questions: None,
            streaming_arguments: None,
            streaming_plan: None,
            arguments: None,
            failure_reason: None,
        });
        assert!(late_outputs.is_empty());
    }

    #[test]
    fn late_child_update_after_parent_completion_is_ignored() {
        let mut reconciler = TaskReconciler::new();

        reconciler.handle_tool_call(make_task_tool_call("task-1"));
        reconciler.handle_tool_call(make_child_tool_call("child-1", "task-1"));

        let terminal_outputs = reconciler.handle_tool_call_update(ToolCallUpdateData {
            tool_call_id: "task-1".to_string(),
            status: Some(ToolCallStatus::Completed),
            result: Some(serde_json::json!({"summary": "done"})),
            content: None,
            raw_output: None,
            title: None,
            locations: None,
            streaming_input_delta: None,
            normalized_todos: None,
            normalized_questions: None,
            streaming_arguments: None,
            streaming_plan: None,
            arguments: None,
            failure_reason: None,
        });
        assert_eq!(terminal_outputs.len(), 1);

        let late_outputs = reconciler.handle_tool_call_update(ToolCallUpdateData {
            tool_call_id: "child-1".to_string(),
            status: Some(ToolCallStatus::Completed),
            result: Some(serde_json::json!({"content": "late"})),
            content: None,
            raw_output: None,
            title: Some("Late child".to_string()),
            locations: None,
            streaming_input_delta: None,
            normalized_todos: None,
            normalized_questions: None,
            streaming_arguments: None,
            streaming_plan: None,
            arguments: None,
            failure_reason: None,
        });
        assert!(late_outputs.is_empty());
    }

    #[test]
    fn completed_task_stops_capturing_children() {
        let mut reconciler = TaskReconciler::new();

        // Task arrives and gets an explicitly parented child
        let task = make_task_tool_call_empty_input("task-1");
        reconciler.handle_tool_call(task);
        let child = make_child_tool_call("child-1", "task-1");
        reconciler.handle_tool_call(child);

        // Complete the task
        let update = ToolCallUpdateData {
            tool_call_id: "task-1".to_string(),
            status: Some(ToolCallStatus::Completed),
            result: Some(serde_json::json!({"summary": "done"})),
            content: None,
            raw_output: None,
            title: None,
            locations: None,
            streaming_input_delta: None,
            normalized_todos: None,
            normalized_questions: None,
            streaming_arguments: None,
            streaming_plan: None,
            arguments: None,
            failure_reason: None,
        };
        reconciler.handle_tool_call_update(update);

        // Now a regular tool call should pass through (no active tasks)
        let after = make_regular_tool_call("tool-after");
        let outputs = reconciler.handle_tool_call(after);

        assert_eq!(outputs.len(), 1);
        match &outputs[0] {
            ReconcilerOutput::EmitToolCall(tc) => {
                assert_eq!(tc.id, "tool-after");
                assert!(tc.task_children.is_none());
            }
            _ => panic!("Expected EmitToolCall pass-through"),
        }
    }

    #[test]
    fn parent_status_does_not_regress_from_completed_to_pending() {
        let mut reconciler = TaskReconciler::new();

        // Setup: parent with child
        let task = make_task_tool_call("task-1");
        reconciler.handle_tool_call(task);
        let child = make_child_tool_call("child-1", "task-1");
        reconciler.handle_tool_call(child);

        // Complete the parent
        let complete_update = ToolCallUpdateData {
            tool_call_id: "task-1".to_string(),
            status: Some(ToolCallStatus::Completed),
            result: Some(serde_json::json!({"summary": "done"})),
            content: None,
            raw_output: None,
            title: None,
            locations: None,
            streaming_input_delta: None,
            normalized_todos: None,
            normalized_questions: None,
            streaming_arguments: None,
            streaming_plan: None,
            arguments: None,
            failure_reason: None,
        };
        let outputs = reconciler.handle_tool_call_update(complete_update);

        // Verify parent emitted as completed
        assert_eq!(outputs.len(), 1);
        match &outputs[0] {
            ReconcilerOutput::EmitToolCall(tc) => {
                assert_eq!(tc.status, ToolCallStatus::Completed);
            }
            _ => panic!("Expected EmitToolCall for completed parent"),
        }
    }

    #[test]
    fn apply_update_does_not_regress_terminal_status() {
        let mut tool_call = make_regular_tool_call("tool-1");
        tool_call.status = ToolCallStatus::Completed;

        // Try to regress status to Pending
        let update = ToolCallUpdateData {
            tool_call_id: "tool-1".to_string(),
            status: Some(ToolCallStatus::Pending),
            result: None,
            content: None,
            raw_output: None,
            title: Some("Updated title".to_string()),
            locations: None,
            streaming_input_delta: None,
            normalized_todos: None,
            normalized_questions: None,
            streaming_arguments: None,
            streaming_plan: None,
            arguments: None,
            failure_reason: None,
        };
        apply_update_to_tool_call(&mut tool_call, &update);

        // Status should remain Completed (regression prevented)
        assert_eq!(tool_call.status, ToolCallStatus::Completed);
        // Other fields should still be updated
        assert_eq!(tool_call.title, Some("Updated title".to_string()));
    }

    #[test]
    fn apply_update_allows_none_status_to_preserve_current() {
        let mut tool_call = make_regular_tool_call("tool-1");
        tool_call.status = ToolCallStatus::InProgress;

        // Update with no status (e.g., hook update with only metadata)
        let update = ToolCallUpdateData {
            tool_call_id: "tool-1".to_string(),
            status: None,
            result: Some(serde_json::json!({"data": "response"})),
            content: None,
            raw_output: None,
            title: None,
            locations: None,
            streaming_input_delta: None,
            normalized_todos: None,
            normalized_questions: None,
            streaming_arguments: None,
            streaming_plan: None,
            arguments: None,
            failure_reason: None,
        };
        apply_update_to_tool_call(&mut tool_call, &update);

        // Status should remain InProgress (None doesn't overwrite)
        assert_eq!(tool_call.status, ToolCallStatus::InProgress);
        // Result should be updated
        assert!(tool_call.result.is_some());
    }

    #[test]
    fn apply_update_preserves_richer_edit_arguments_when_update_is_sparse() {
        let mut tool_call = ToolCallData {
            id: "tool-1".to_string(),
            name: "Edit".to_string(),
            arguments: ToolArguments::Edit {
                edits: vec![crate::acp::session_update::EditEntry {
                    file_path: Some("/tmp/example.rs".to_string()),
                    move_from: None,
                    old_string: Some("before".to_string()),
                    new_string: Some("after".to_string()),
                    content: None,
                }],
            },
            raw_input: None,
            status: ToolCallStatus::InProgress,
            result: None,
            kind: Some(ToolKind::Edit),
            title: Some("Edit /tmp/example.rs".to_string()),
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

        let update = ToolCallUpdateData {
            tool_call_id: "tool-1".to_string(),
            status: Some(ToolCallStatus::Completed),
            result: None,
            content: None,
            raw_output: None,
            title: None,
            locations: None,
            streaming_input_delta: None,
            normalized_todos: None,
            normalized_questions: None,
            streaming_arguments: None,
            streaming_plan: None,
            arguments: Some(ToolArguments::Edit {
                edits: vec![crate::acp::session_update::EditEntry {
                    file_path: None,
                    move_from: None,
                    old_string: None,
                    new_string: None,
                    content: None,
                }],
            }),
            failure_reason: None,
        };

        apply_update_to_tool_call(&mut tool_call, &update);

        match &tool_call.arguments {
            ToolArguments::Edit { edits } => {
                let first_edit = edits.first().expect("expected edit entry");
                assert_eq!(first_edit.file_path.as_deref(), Some("/tmp/example.rs"));
                assert_eq!(first_edit.old_string.as_deref(), Some("before"));
                assert_eq!(first_edit.new_string.as_deref(), Some("after"));
            }
            other => panic!("Expected edit arguments, got {:?}", other),
        }
    }
}
