use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};

use serde_json::Value;
use tokio::sync::{oneshot, Mutex};

use super::{extract_question_answer_map, response_outcome_allows, selected_option_id};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum PermissionUiDispatch {
    Emit,
    JoinExisting,
    ResolvedFromCache,
}

impl PermissionUiDispatch {
    pub(super) fn as_str(&self) -> &'static str {
        match self {
            Self::Emit => "emit",
            Self::JoinExisting => "join_existing",
            Self::ResolvedFromCache => "resolved_from_cache",
        }
    }
}

#[derive(Debug, Clone)]
pub(super) struct ToolPermissionRequest {
    pub(super) tool_call_id: String,
    pub(super) tool_name: String,
    pub(super) permission_suggestions: Vec<cc_sdk::PermissionUpdate>,
}

impl ToolPermissionRequest {
    pub(super) fn has_always_option(&self) -> bool {
        self.permission_suggestions
            .iter()
            .any(permission_suggestion_supports_always)
    }
}

#[derive(Debug, Clone)]
pub(super) struct QuestionPermissionRequest {
    pub(super) tool_call_id: String,
    pub(super) original_input: Value,
}

#[derive(Debug, Clone)]
pub(super) struct HookPermissionRequest {
    pub(super) tool_call_id: String,
    pub(super) tool_name: String,
    pub(super) original_input: Value,
    pub(super) permission_suggestions: Vec<cc_sdk::PermissionUpdate>,
}

impl HookPermissionRequest {
    pub(super) fn has_always_option(&self) -> bool {
        self.permission_suggestions
            .iter()
            .any(permission_suggestion_supports_always)
    }
}

#[derive(Debug, Clone)]
pub(super) enum PendingPermissionKind {
    Tool {
        tool_call_id: String,
        tool_name: String,
        permission_suggestions: Vec<cc_sdk::PermissionUpdate>,
    },
    Question {
        tool_call_id: String,
        original_input: Value,
    },
    Hook {
        tool_call_id: String,
        tool_name: String,
        original_input: Value,
        permission_suggestions: Vec<cc_sdk::PermissionUpdate>,
    },
}

impl PendingPermissionKind {
    pub(super) fn tool_call_id(&self) -> &str {
        match self {
            Self::Tool { tool_call_id, .. }
            | Self::Question { tool_call_id, .. }
            | Self::Hook { tool_call_id, .. } => tool_call_id,
        }
    }

    fn approval_group_key(&self) -> Option<String> {
        match self {
            Self::Tool { tool_call_id, .. } | Self::Hook { tool_call_id, .. } => {
                Some(tool_call_id.clone())
            }
            Self::Question { .. } => None,
        }
    }

    pub(super) fn is_question(&self) -> bool {
        matches!(self, Self::Question { .. })
    }

    pub(super) fn label(&self) -> &'static str {
        match self {
            Self::Tool { .. } => "tool",
            Self::Question { .. } => "question",
            Self::Hook { .. } => "hook",
        }
    }
}

impl From<ToolPermissionRequest> for PendingPermissionKind {
    fn from(value: ToolPermissionRequest) -> Self {
        Self::Tool {
            tool_call_id: value.tool_call_id,
            tool_name: value.tool_name,
            permission_suggestions: value.permission_suggestions,
        }
    }
}

impl From<QuestionPermissionRequest> for PendingPermissionKind {
    fn from(value: QuestionPermissionRequest) -> Self {
        Self::Question {
            tool_call_id: value.tool_call_id,
            original_input: value.original_input,
        }
    }
}

impl From<HookPermissionRequest> for PendingPermissionKind {
    fn from(value: HookPermissionRequest) -> Self {
        Self::Hook {
            tool_call_id: value.tool_call_id,
            tool_name: value.tool_name,
            original_input: value.original_input,
            permission_suggestions: value.permission_suggestions,
        }
    }
}

#[derive(Debug)]
struct PendingPermissionRequest {
    sender: PendingPermissionResponder,
    kind: PendingPermissionKind,
    approval_group_key: Option<String>,
}

#[derive(Debug)]
enum PendingPermissionResponder {
    Tool(oneshot::Sender<cc_sdk::PermissionResult>),
    Hook(oneshot::Sender<cc_sdk::HookJSONOutput>),
}

#[derive(Debug, Default)]
struct PermissionBridgeState {
    pending: HashMap<u64, PendingPermissionRequest>,
    approval_groups: HashMap<String, Vec<u64>>,
    resolved_approval_results: HashMap<String, Value>,
}

#[derive(Debug)]
pub(super) struct PendingPermissionRegistration<T> {
    pub(super) receiver: oneshot::Receiver<T>,
    pub(super) ui_dispatch: PermissionUiDispatch,
}

pub(super) struct PermissionBridge {
    state: Mutex<PermissionBridgeState>,
    counter: AtomicU64,
}

impl PermissionBridge {
    pub(super) fn new() -> Self {
        Self {
            state: Mutex::new(PermissionBridgeState::default()),
            counter: AtomicU64::new(1),
        }
    }

    pub(super) fn next_id(&self) -> u64 {
        self.counter.fetch_add(1, Ordering::Relaxed)
    }

    pub(super) async fn register(
        &self,
        id: u64,
        request: impl Into<PendingPermissionKind>,
    ) -> PendingPermissionRegistration<cc_sdk::PermissionResult> {
        let kind = request.into();
        let (tx, rx) = oneshot::channel();
        self.register_pending_request(
            id,
            PendingPermissionRequest {
                sender: PendingPermissionResponder::Tool(tx),
                approval_group_key: kind.approval_group_key(),
                kind,
            },
            rx,
        )
        .await
    }

    pub(super) async fn register_tool(
        &self,
        id: u64,
        request: ToolPermissionRequest,
    ) -> PendingPermissionRegistration<cc_sdk::PermissionResult> {
        self.register(id, request).await
    }

    pub(super) async fn register_question(
        &self,
        id: u64,
        request: QuestionPermissionRequest,
    ) -> PendingPermissionRegistration<cc_sdk::PermissionResult> {
        self.register(id, request).await
    }

    pub(super) async fn register_hook(
        &self,
        id: u64,
        request: impl Into<PendingPermissionKind>,
    ) -> PendingPermissionRegistration<cc_sdk::HookJSONOutput> {
        let kind = request.into();
        let (tx, rx) = oneshot::channel();
        self.register_pending_request(
            id,
            PendingPermissionRequest {
                sender: PendingPermissionResponder::Hook(tx),
                approval_group_key: kind.approval_group_key(),
                kind,
            },
            rx,
        )
        .await
    }

    async fn register_pending_request<T>(
        &self,
        id: u64,
        pending_request: PendingPermissionRequest,
        receiver: oneshot::Receiver<T>,
    ) -> PendingPermissionRegistration<T> {
        let mut pending_request = Some(pending_request);
        let mut immediate_resolution = None;
        let mut state = self.state.lock().await;
        let ui_dispatch = if let Some(group_key) = pending_request
            .as_ref()
            .and_then(|request| request.approval_group_key.as_ref())
        {
            if let Some(resolved_result) = state.resolved_approval_results.get(group_key) {
                immediate_resolution = Some(resolved_result.clone());
                PermissionUiDispatch::ResolvedFromCache
            } else if let Some(existing_request_ids) = state.approval_groups.get_mut(group_key) {
                existing_request_ids.push(id);
                state.pending.insert(
                    id,
                    pending_request
                        .take()
                        .expect("pending permission request should exist"),
                );
                PermissionUiDispatch::JoinExisting
            } else {
                state.approval_groups.insert(group_key.clone(), vec![id]);
                state.pending.insert(
                    id,
                    pending_request
                        .take()
                        .expect("pending permission request should exist"),
                );
                PermissionUiDispatch::Emit
            }
        } else {
            state.pending.insert(
                id,
                pending_request
                    .take()
                    .expect("pending permission request should exist"),
            );
            PermissionUiDispatch::Emit
        };

        drop(state);

        if let Some(result) = immediate_resolution {
            resolve_pending_request_from_ui_result(
                pending_request.expect("pending permission request should exist"),
                &result,
            );
        }

        PendingPermissionRegistration {
            receiver,
            ui_dispatch,
        }
    }

    fn take_request_bundle(
        state: &mut PermissionBridgeState,
        id: u64,
    ) -> Option<Vec<PendingPermissionRequest>> {
        let pending_request = state.pending.remove(&id)?;
        let mut requests = vec![pending_request];

        if let Some(group_key) = requests[0].approval_group_key.clone() {
            if let Some(group_request_ids) = state.approval_groups.remove(&group_key) {
                for request_id in group_request_ids {
                    if request_id == id {
                        continue;
                    }
                    if let Some(sibling_request) = state.pending.remove(&request_id) {
                        requests.push(sibling_request);
                    }
                }
            }
        }

        Some(requests)
    }

    #[cfg(test)]
    pub(super) async fn resolve(&self, id: u64, result: cc_sdk::PermissionResult) {
        let pending = {
            let mut state = self.state.lock().await;
            Self::take_request_bundle(&mut state, id)
                .and_then(|mut requests| requests.drain(..1).next())
        };

        if let Some(pending) = pending {
            if let PendingPermissionResponder::Tool(sender) = pending.sender {
                let _ = sender.send(result);
            }
        }
    }

    pub(super) async fn resolve_from_ui_result(
        &self,
        id: u64,
        result: &Value,
    ) -> Option<PendingPermissionKind> {
        let pending_requests = {
            let mut state = self.state.lock().await;
            let pending_requests = Self::take_request_bundle(&mut state, id)?;
            if let Some(group_key) = pending_requests[0].approval_group_key.clone() {
                state
                    .resolved_approval_results
                    .insert(group_key, result.clone());
            }
            pending_requests
        };
        let kind = pending_requests[0].kind.clone();

        for pending_request in pending_requests {
            resolve_pending_request_from_ui_result(pending_request, result);
        }

        Some(kind)
    }

    pub(super) async fn request_id_for_question_tool_call(
        &self,
        tool_call_id: &str,
    ) -> Option<u64> {
        let state = self.state.lock().await;
        state.pending.iter().find_map(|(request_id, request)| {
            if request.kind.is_question() && request.kind.tool_call_id() == tool_call_id {
                Some(*request_id)
            } else {
                None
            }
        })
    }

    pub(super) async fn clear_request(&self, id: u64, message: &str) {
        let pending_requests = {
            let mut state = self.state.lock().await;
            Self::take_request_bundle(&mut state, id)
        };

        let Some(pending_requests) = pending_requests else {
            return;
        };

        for pending_request in pending_requests {
            match pending_request.sender {
                PendingPermissionResponder::Tool(sender) => {
                    let _ = sender.send(cc_sdk::PermissionResult::Deny(
                        cc_sdk::PermissionResultDeny {
                            message: message.to_string(),
                            interrupt: false,
                        },
                    ));
                }
                PendingPermissionResponder::Hook(sender) => {
                    let _ = sender.send(build_denied_hook_output_from_kind(
                        &pending_request.kind,
                        message,
                    ));
                }
            }
        }
    }

    pub(super) async fn drain_all_as_denied(&self) {
        let pending_requests = {
            let mut state = self.state.lock().await;
            state.approval_groups.clear();
            state.resolved_approval_results.clear();
            state
                .pending
                .drain()
                .map(|(_, pending)| pending)
                .collect::<Vec<_>>()
        };

        for pending in pending_requests {
            match pending.sender {
                PendingPermissionResponder::Tool(sender) => {
                    let _ = sender.send(cc_sdk::PermissionResult::Deny(
                        cc_sdk::PermissionResultDeny {
                            message: "Permission denied or connection closed".to_string(),
                            interrupt: false,
                        },
                    ));
                }
                PendingPermissionResponder::Hook(sender) => {
                    let _ = sender.send(build_denied_hook_output_from_kind(
                        &pending.kind,
                        "Permission denied or connection closed",
                    ));
                }
            }
        }
    }
}

pub(super) fn build_denied_hook_output(
    request: &HookPermissionRequest,
    message: &str,
) -> cc_sdk::HookJSONOutput {
    build_denied_hook_output_from_kind(&PendingPermissionKind::from(request.clone()), message)
}

fn resolve_pending_request_from_ui_result(
    pending_request: PendingPermissionRequest,
    result: &Value,
) {
    match pending_request.sender {
        PendingPermissionResponder::Tool(sender) => {
            let permission_result = permission_result_from_ui_result(&pending_request.kind, result);
            let _ = sender.send(permission_result);
        }
        PendingPermissionResponder::Hook(sender) => {
            let hook_output = hook_output_from_ui_result(&pending_request.kind, result);
            let _ = sender.send(hook_output);
        }
    }
}

fn build_question_updated_input(
    original_input: &Value,
    answers: &serde_json::Map<String, Value>,
) -> Value {
    match original_input {
        Value::Object(object) => {
            let mut updated_input = object.clone();
            updated_input.insert("answers".to_string(), Value::Object(answers.clone()));
            Value::Object(updated_input)
        }
        _ => original_input.clone(),
    }
}

fn permission_result_from_ui_result(
    kind: &PendingPermissionKind,
    result: &Value,
) -> cc_sdk::PermissionResult {
    if response_outcome_allows(result) {
        let updated_input = match kind {
            PendingPermissionKind::Question { original_input, .. } => Some(
                build_question_updated_input(original_input, &extract_question_answer_map(result)),
            ),
            PendingPermissionKind::Tool { .. } | PendingPermissionKind::Hook { .. } => None,
        };

        let updated_permissions = match kind {
            PendingPermissionKind::Tool {
                tool_name,
                permission_suggestions,
                ..
            } if selected_option_id(result) == Some("allow_always") => Some(
                choose_always_permission_updates(tool_name, permission_suggestions),
            ),
            _ => None,
        };

        cc_sdk::PermissionResult::Allow(cc_sdk::PermissionResultAllow {
            updated_input,
            updated_permissions,
        })
    } else {
        cc_sdk::PermissionResult::Deny(cc_sdk::PermissionResultDeny {
            message: if kind.is_question() {
                "Question cancelled by user".to_string()
            } else {
                "Permission denied by user".to_string()
            },
            interrupt: false,
        })
    }
}

fn build_denied_hook_output_from_kind(
    kind: &PendingPermissionKind,
    message: &str,
) -> cc_sdk::HookJSONOutput {
    hook_output_with_decision(
        kind,
        serde_json::json!({
            "behavior": "deny",
            "message": message,
            "interrupt": false,
        }),
    )
}

fn hook_output_from_ui_result(
    kind: &PendingPermissionKind,
    result: &Value,
) -> cc_sdk::HookJSONOutput {
    if !response_outcome_allows(result) {
        return build_denied_hook_output_from_kind(kind, "Permission denied by user");
    }

    let PendingPermissionKind::Hook {
        tool_name,
        original_input,
        permission_suggestions,
        ..
    } = kind
    else {
        return build_denied_hook_output_from_kind(kind, "Unsupported hook permission state");
    };

    let mut decision = serde_json::json!({
        "behavior": "allow",
        "updatedInput": original_input,
    });

    if selected_option_id(result) == Some("allow_always") {
        decision["updatedPermissions"] = serde_json::to_value(choose_always_permission_updates(
            tool_name,
            permission_suggestions,
        ))
        .unwrap_or_else(|_| Value::Array(Vec::new()));
    }

    hook_output_with_decision(kind, decision)
}

fn hook_output_with_decision(
    kind: &PendingPermissionKind,
    decision: Value,
) -> cc_sdk::HookJSONOutput {
    let reason = match kind {
        PendingPermissionKind::Hook { tool_name, .. } => {
            Some(format!("Acepe approval resolved for {tool_name}"))
        }
        _ => None,
    };

    cc_sdk::HookJSONOutput::Sync(cc_sdk::SyncHookJSONOutput {
        continue_: Some(true),
        reason,
        hook_specific_output: Some(cc_sdk::HookSpecificOutput::PermissionRequest(
            cc_sdk::PermissionRequestHookSpecificOutput { decision },
        )),
        ..Default::default()
    })
}

fn permission_suggestion_supports_always(update: &cc_sdk::PermissionUpdate) -> bool {
    matches!(update.behavior, Some(cc_sdk::PermissionBehavior::Allow))
        || matches!(update.update_type, cc_sdk::PermissionUpdateType::SetMode)
}

fn choose_always_permission_updates(
    tool_name: &str,
    suggestions: &[cc_sdk::PermissionUpdate],
) -> Vec<cc_sdk::PermissionUpdate> {
    if let Some(suggestion) = suggestions
        .iter()
        .find(|suggestion| permission_suggestion_supports_always(suggestion))
    {
        return vec![suggestion.clone()];
    }

    vec![cc_sdk::PermissionUpdate {
        update_type: cc_sdk::PermissionUpdateType::AddRules,
        rules: Some(vec![cc_sdk::PermissionRuleValue {
            tool_name: tool_name.to_string(),
            rule_content: None,
        }]),
        behavior: Some(cc_sdk::PermissionBehavior::Allow),
        mode: None,
        directories: None,
        destination: Some(cc_sdk::PermissionUpdateDestination::Session),
    }]
}
