use super::*;

#[derive(Debug, Clone)]
pub(super) struct PendingQuestionState {
    pub(super) request_id: u64,
    pub(super) session_id: String,
    pub(super) questions: Option<Vec<QuestionItem>>,
    pub(super) ui_emitted: bool,
}

// ---------------------------------------------------------------------------
// ToolCallIdTracker
// ---------------------------------------------------------------------------

/// Shared state between the streaming bridge and the permission handler.
///
#[derive(Debug, Clone, PartialEq, Eq)]
struct ToolCallTrackerEntry {
    tool_use_id: String,
    input_signature: Option<String>,
}

fn stable_json_signature(value: &Value) -> String {
    match value {
        Value::Null => "null".to_string(),
        Value::Bool(boolean) => boolean.to_string(),
        Value::Number(number) => number.to_string(),
        Value::String(string) => serde_json::to_string(string).unwrap_or_default(),
        Value::Array(items) => {
            let parts = items
                .iter()
                .map(stable_json_signature)
                .collect::<Vec<_>>()
                .join(",");
            format!("[{parts}]")
        }
        Value::Object(object) => {
            let parts = object
                .iter()
                .map(|(key, item)| (key.as_str(), stable_json_signature(item)))
                .collect::<std::collections::BTreeMap<_, _>>()
                .into_iter()
                .map(|(key, item)| {
                    let encoded_key = serde_json::to_string(key).unwrap_or_default();
                    format!("{encoded_key}:{item}")
                })
                .collect::<Vec<_>>()
                .join(",");
            format!("{{{parts}}}")
        }
    }
}

/// The bridge records `(tool_name, tool_use_id, input_signature)` as stream
/// events arrive. Permission callbacks then resolve the real `toolu_...` ID by
/// tool name plus normalized input, falling back to heuristics only when the
/// stream has not surfaced enough input yet.
///
/// Uses a `VecDeque` per tool name to handle parallel tool calls where Claude
/// may invoke the same tool multiple times in a single response.
pub(super) struct ToolCallIdTracker {
    /// Maps tool_name → queue of tool uses in arrival order.
    map: Mutex<HashMap<String, std::collections::VecDeque<ToolCallTrackerEntry>>>,
}

impl ToolCallIdTracker {
    pub(super) fn new() -> Self {
        Self {
            map: Mutex::new(HashMap::new()),
        }
    }

    #[cfg(test)]
    /// Record a tool_name → tool_use_id mapping from a stream event.
    pub(super) async fn record(&self, tool_name: String, tool_use_id: String) {
        self.record_with_input(tool_name, tool_use_id, None).await;
    }

    pub(super) async fn record_with_input(
        &self,
        tool_name: String,
        tool_use_id: String,
        input: Option<&Value>,
    ) {
        let input_signature = input.map(stable_json_signature);
        let mut map = self.map.lock().await;
        let queue = map.entry(tool_name).or_default();
        if let Some(existing) = queue
            .iter_mut()
            .find(|entry| entry.tool_use_id == tool_use_id)
        {
            if input_signature.is_some() {
                existing.input_signature = input_signature;
            }
            return;
        }

        queue.push_back(ToolCallTrackerEntry {
            tool_use_id,
            input_signature,
        });
    }

    /// Pop the best matching tool_use_id for a given tool name + input.
    pub(super) async fn take_for_input(&self, tool_name: &str, input: &Value) -> Option<String> {
        let target_signature = stable_json_signature(input);
        let mut map = self.map.lock().await;
        let queue = map.get_mut(tool_name)?;
        let match_index = queue
            .iter()
            .position(|entry| entry.input_signature.as_deref() == Some(target_signature.as_str()))
            .or_else(|| {
                queue
                    .iter()
                    .enumerate()
                    .rev()
                    .find_map(|(index, entry)| entry.input_signature.is_none().then_some(index))
            })
            .or_else(|| (queue.len() == 1).then_some(0))?;

        let id = queue.remove(match_index)?.tool_use_id;
        if queue.is_empty() {
            map.remove(tool_name);
        }
        Some(id)
    }

    #[cfg(test)]
    /// Pop the oldest tool_use_id for a given tool name (FIFO).
    pub(super) async fn take(&self, tool_name: &str) -> Option<String> {
        let mut map = self.map.lock().await;
        let queue = map.get_mut(tool_name)?;
        let id = queue.pop_front().map(|entry| entry.tool_use_id);
        if queue.is_empty() {
            map.remove(tool_name);
        }
        id
    }
}

#[derive(Debug, Clone)]
pub(super) struct PendingApprovalCallbackDiagnostic {
    pub(super) session_id: String,
    tool_name: String,
}

pub(super) struct ApprovalCallbackTracker {
    pub(super) pending: Mutex<HashMap<String, PendingApprovalCallbackDiagnostic>>,
}

impl ApprovalCallbackTracker {
    pub(super) fn new() -> Self {
        Self {
            pending: Mutex::new(HashMap::new()),
        }
    }

    pub(super) async fn note_tool_use_started(
        &self,
        session_id: &str,
        tool_name: &str,
        tool_call_id: &str,
    ) {
        if !tool_name_expects_permission_callback(tool_name) {
            return;
        }

        let mut pending = self.pending.lock().await;
        if pending.contains_key(tool_call_id) {
            return;
        }
        pending.insert(
            tool_call_id.to_string(),
            PendingApprovalCallbackDiagnostic {
                session_id: session_id.to_string(),
                tool_name: tool_name.to_string(),
            },
        );
        drop(pending);

        tracing::info!(
            session_id = %session_id,
            tool_name = %tool_name,
            tool_call_id = %tool_call_id,
            "cc-sdk approval diagnostics: tool use started; awaiting permission callback"
        );
        log_debug_event(
            session_id,
            "permission.callback.expected",
            &serde_json::json!({
                "toolName": tool_name,
                "toolCallId": tool_call_id,
            }),
        );
    }

    pub(super) async fn note_callback_received(
        &self,
        session_id: &str,
        tool_name: &str,
        tool_call_id: &str,
        source: &str,
    ) {
        let removed = self.pending.lock().await.remove(tool_call_id);
        let had_pending_diagnostic = removed.is_some();
        tracing::info!(
            session_id = %session_id,
            tool_name = %tool_name,
            tool_call_id = %tool_call_id,
            source = %source,
            had_pending_diagnostic = had_pending_diagnostic,
            "cc-sdk approval diagnostics: permission callback received"
        );
        log_debug_event(
            session_id,
            "permission.callback.received",
            &serde_json::json!({
                "toolName": tool_name,
                "toolCallId": tool_call_id,
                "source": source,
                "hadPendingDiagnostic": had_pending_diagnostic,
            }),
        );
    }

    pub(super) async fn warn_if_callback_missing(&self, session_id: &str, tool_call_id: &str) {
        let pending = self.pending.lock().await.get(tool_call_id).cloned();
        if let Some(pending) = pending {
            tracing::warn!(
                session_id = %session_id,
                tool_name = %pending.tool_name,
                tool_call_id = %tool_call_id,
                "cc-sdk approval diagnostics: tool use is still waiting for can_use_tool/PermissionRequest callback"
            );
            log_debug_event(
                session_id,
                "permission.callback.missing",
                &serde_json::json!({
                    "toolName": pending.tool_name,
                    "toolCallId": tool_call_id,
                }),
            );
        }
    }

    pub(super) async fn clear_if_pending(&self, tool_call_id: &str) -> bool {
        self.pending.lock().await.remove(tool_call_id).is_some()
    }

    pub(super) async fn log_pending_for_session(&self, session_id: &str, reason: &str) {
        let pending = self
            .pending
            .lock()
            .await
            .iter()
            .filter_map(|(tool_call_id, pending)| {
                if pending.session_id == session_id {
                    Some((tool_call_id.clone(), pending.tool_name.clone()))
                } else {
                    None
                }
            })
            .collect::<Vec<_>>();

        if pending.is_empty() {
            return;
        }

        tracing::warn!(
            session_id = %session_id,
            reason = %reason,
            pending_tool_calls = ?pending,
            "cc-sdk approval diagnostics: session still has tool uses with no permission callback"
        );
    }
}

fn tool_name_expects_permission_callback(tool_name: &str) -> bool {
    matches!(
        tool_name,
        "Bash" | "Edit" | "MultiEdit" | "Write" | "NotebookEdit" | "NotebookWrite"
    )
}

pub(super) async fn clear_pending_approval_callback_diagnostic_for_terminal_update(
    approval_callback_tracker: &ApprovalCallbackTracker,
    update: &SessionUpdate,
) {
    let SessionUpdate::ToolCallUpdate { update, .. } = update else {
        return;
    };

    if !matches!(
        update.status,
        Some(ToolCallStatus::Completed) | Some(ToolCallStatus::Failed)
    ) {
        return;
    }

    approval_callback_tracker
        .clear_if_pending(&update.tool_call_id)
        .await;
}
