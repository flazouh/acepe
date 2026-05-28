use super::*;

async fn reject_cc_sdk_interaction_request(
    projection_registry: &ProjectionRegistry,
    db: Option<&DbConn>,
    dispatcher: &AcpUiEventDispatcher,
    session_id: &str,
    request_id: u64,
    message: &str,
) {
    apply_interaction_response_for_request(
        projection_registry,
        db,
        Some(dispatcher),
        session_id,
        request_id,
        &serde_json::json!({
            "outcome": { "outcome": "cancelled", "optionId": "reject" },
            "acepeDenyMessage": message,
        }),
        "cc-sdk reject",
    )
    .await;
}

// ---------------------------------------------------------------------------
// AcepePermissionHandler
// ---------------------------------------------------------------------------

/// Implements cc-sdk's CanUseTool by routing permission requests through the Acepe UI.
pub(super) struct AcepePermissionHandler {
    pub(super) session_id: String,
    pub(super) agent_type: AgentType,
    pub(super) bridge: Arc<PermissionBridge>,
    pub(super) dispatcher: AcpUiEventDispatcher,
    pub(super) projection_registry: Arc<ProjectionRegistry>,
    pub(super) db: Option<DbConn>,
    pub(super) session_policy: Arc<SessionPolicyRegistry>,
    pub(super) tool_call_tracker: Arc<ToolCallIdTracker>,
    pub(super) task_reconciler: Arc<std::sync::Mutex<TaskReconciler>>,
    pub(super) approval_callback_tracker: Arc<ApprovalCallbackTracker>,
    pub(super) pending_questions: Arc<Mutex<HashMap<String, PendingQuestionState>>>,
}

#[async_trait]
impl cc_sdk::CanUseTool for AcepePermissionHandler {
    async fn can_use_tool(
        &self,
        tool_name: &str,
        input: &Value,
        _ctx: &cc_sdk::ToolPermissionContext,
    ) -> cc_sdk::PermissionResult {
        let request_id: u64 = self.bridge.next_id();

        // Look up the real tool_use_id (toolu_...) from the stream tracker.
        // The streaming bridge records it before the CLI control channel fires
        // can_use_tool, and enriches the record with the full tool input as soon
        // as the assistant message arrives. Match by tool name + normalized
        // input, falling back to a synthetic ID only when correlation fails.
        let tracked_tool_call_id = self
            .tool_call_tracker
            .take_for_input(tool_name, input)
            .await;
        let tracker_miss = tracked_tool_call_id.is_none();
        let tool_call_id = tracked_tool_call_id.unwrap_or_else(|| format!("cc-sdk-{}", request_id));

        self.approval_callback_tracker
            .note_callback_received(&self.session_id, tool_name, &tool_call_id, "can_use_tool")
            .await;

        if tool_name == "AskUserQuestion" {
            let normalized_questions =
                parse_normalized_questions(tool_name, input, self.agent_type);
            let question_request = QuestionPermissionRequest {
                tool_call_id: tool_call_id.clone(),
                original_input: input.clone(),
            };
            let registration = self
                .bridge
                .register_question(request_id, question_request)
                .await;
            let rx = registration.receiver;

            let (questions_for_ui, question_already_emitted) = {
                let mut pending_questions = self.pending_questions.lock().await;
                let question_already_emitted = pending_questions
                    .get(&tool_call_id)
                    .map(|state| state.ui_emitted)
                    .unwrap_or(false);
                let merged_questions = normalized_questions.clone().or_else(|| {
                    pending_questions
                        .get(&tool_call_id)
                        .and_then(|state| state.questions.clone())
                });

                pending_questions.insert(
                    tool_call_id.clone(),
                    PendingQuestionState {
                        request_id,
                        session_id: self.session_id.clone(),
                        questions: merged_questions.clone(),
                        ui_emitted: question_already_emitted || merged_questions.is_some(),
                    },
                );

                (merged_questions, question_already_emitted)
            };

            if let Some(questions) = questions_for_ui {
                if !question_already_emitted {
                    self.dispatcher.enqueue(AcpUiEvent::session_update(
                        SessionUpdate::QuestionRequest {
                            question: QuestionData {
                                id: tool_call_id.clone(),
                                session_id: self.session_id.clone(),
                                json_rpc_request_id: Some(request_id),
                                reply_handler: Some(
                                    crate::acp::session_update::InteractionReplyHandler::json_rpc(
                                        request_id,
                                    ),
                                ),
                                questions,
                                tool: Some(ToolReference {
                                    message_id: None,
                                    call_id: tool_call_id.clone(),
                                }),
                            },
                            session_id: Some(self.session_id.clone()),
                        },
                    ));
                }
            }

            tracing::info!(
                session_id = %self.session_id,
                request_id = request_id,
                tool_name = %tool_name,
                tool_call_id = %tool_call_id,
                "cc-sdk AskUserQuestion emitted and awaiting UI response"
            );

            return match timeout(Duration::from_secs(15 * 60), rx).await {
                Ok(Ok(result)) => result,
                other => {
                    self.pending_questions.lock().await.remove(&tool_call_id);
                    let cleared_request_ids = self
                        .bridge
                        .clear_request(request_id, "Question timed out or was not answered")
                        .await;
                    for cleared_request_id in cleared_request_ids {
                        reject_cc_sdk_interaction_request(
                            &self.projection_registry,
                            self.db.as_ref(),
                            &self.dispatcher,
                            &self.session_id,
                            cleared_request_id,
                            "Question timed out or was not answered",
                        )
                        .await;
                    }
                    tracing::warn!(
                        session_id = %self.session_id,
                        request_id = request_id,
                        tool_name = %tool_name,
                        tool_call_id = %tool_call_id,
                        timeout_or_error = ?other,
                        "cc-sdk AskUserQuestion denied or timed out"
                    );
                    self.dispatcher.enqueue(AcpUiEvent::session_update(
                        SessionUpdate::ToolCallUpdate {
                            update: ToolCallUpdateData {
                                tool_call_id,
                                status: Some(ToolCallStatus::Failed),
                                failure_reason: Some(
                                    "Question timed out or was not answered".to_string(),
                                ),
                                ..Default::default()
                            },
                            session_id: Some(self.session_id.clone()),
                        },
                    ));
                    cc_sdk::PermissionResult::Deny(cc_sdk::PermissionResultDeny {
                        message: "Question timed out or was not answered".to_string(),
                        interrupt: false,
                    })
                }
            };
        }

        let tool_request = ToolPermissionRequest {
            tool_call_id: tool_call_id.clone(),
            tool_name: tool_name.to_string(),
            reusable_approval_key: build_reusable_permission_key(tool_name, input),
            permission_suggestions: _ctx.suggestions.clone(),
        };
        let has_always_option = tool_request.has_always_option();
        let auto_accept_reason = self.auto_accept_reason(tool_name, &tool_call_id);
        if let Some(auto_accept_reason) = auto_accept_reason {
            tracing::info!(
                session_id = %self.session_id,
                request_id = request_id,
                tool_name = %tool_name,
                tool_call_id = %tool_call_id,
                auto_accept_reason = auto_accept_reason,
                "cc-sdk permission request auto-accepted"
            );
            log_debug_event(
                &self.session_id,
                "permission.auto_accepted",
                &serde_json::json!({
                    "source": "can_use_tool",
                    "requestId": request_id,
                    "toolName": tool_name,
                    "toolCallId": tool_call_id,
                    "reason": auto_accept_reason,
                }),
            );
            self.dispatcher
                .enqueue(AcpUiEvent::session_update(build_permission_request_update(
                    &self.session_id,
                    &tool_call_id,
                    request_id,
                    tool_name,
                    input,
                    has_always_option,
                    self.agent_type,
                    true,
                )));
            return allow_permission_result();
        }
        let registration = self
            .bridge
            .register_tool(request_id, tool_request.clone())
            .await;
        let rx = registration.receiver;
        log_debug_event(
            &self.session_id,
            "permission.can_use_tool.registered",
            &serde_json::json!({
                "requestId": request_id,
                "toolName": tool_name,
                "toolCallId": tool_call_id,
                "trackerMiss": tracker_miss,
                "uiDispatch": registration.ui_dispatch.as_str(),
                "suggestionCount": _ctx.suggestions.len(),
                "patterns": build_permission_patterns(input),
            }),
        );
        match registration.ui_dispatch {
            PermissionUiDispatch::Emit => {
                tracing::info!(
                    session_id = %self.session_id,
                    request_id = request_id,
                    tool_name = %tool_name,
                    tool_call_id = %tool_call_id,
                    "cc-sdk permission request emitted"
                );
                log_debug_event(
                    &self.session_id,
                    "permission.ui.emit",
                    &serde_json::json!({
                        "source": "can_use_tool",
                        "channel": "session_update",
                        "requestId": request_id,
                        "toolName": tool_name,
                        "toolCallId": tool_call_id,
                    }),
                );
                self.dispatcher.enqueue(AcpUiEvent::session_update(
                    build_permission_request_update(
                        &self.session_id,
                        &tool_call_id,
                        request_id,
                        tool_name,
                        input,
                        has_always_option,
                        self.agent_type,
                        false,
                    ),
                ));
            }
            PermissionUiDispatch::JoinExisting => {
                tracing::info!(
                    session_id = %self.session_id,
                    request_id = request_id,
                    tool_name = %tool_name,
                    tool_call_id = %tool_call_id,
                    "cc-sdk permission request joined existing pending approval"
                );
                log_debug_event(
                    &self.session_id,
                    "permission.ui.join",
                    &serde_json::json!({
                        "source": "can_use_tool",
                        "requestId": request_id,
                        "toolName": tool_name,
                        "toolCallId": tool_call_id,
                    }),
                );
            }
            PermissionUiDispatch::ResolvedFromCache => {
                tracing::info!(
                    session_id = %self.session_id,
                    request_id = request_id,
                    tool_name = %tool_name,
                    tool_call_id = %tool_call_id,
                    "cc-sdk permission request reused resolved approval"
                );
                log_debug_event(
                    &self.session_id,
                    "permission.ui.reused",
                    &serde_json::json!({
                        "source": "can_use_tool",
                        "requestId": request_id,
                        "toolName": tool_name,
                        "toolCallId": tool_call_id,
                    }),
                );
            }
        }

        match rx.await {
            Ok(result) => result,
            Err(error) => {
                tracing::warn!(
                    session_id = %self.session_id,
                    request_id = request_id,
                    tool_name = %tool_name,
                    receiver_error = ?error,
                    "cc-sdk permission request receiver closed"
                );
                let cleared_request_ids = self
                    .bridge
                    .clear_request(request_id, "Permission request was cancelled")
                    .await;
                for cleared_request_id in cleared_request_ids {
                    reject_cc_sdk_interaction_request(
                        &self.projection_registry,
                        self.db.as_ref(),
                        &self.dispatcher,
                        &self.session_id,
                        cleared_request_id,
                        "Permission request was cancelled",
                    )
                    .await;
                }
                cc_sdk::PermissionResult::Deny(cc_sdk::PermissionResultDeny {
                    message: "Permission request was cancelled".to_string(),
                    interrupt: true,
                })
            }
        }
    }
}

pub(super) struct AcepePermissionRequestHook {
    pub(super) session_id: String,
    pub(super) agent_type: AgentType,
    pub(super) bridge: Arc<PermissionBridge>,
    pub(super) dispatcher: AcpUiEventDispatcher,
    pub(super) projection_registry: Arc<ProjectionRegistry>,
    pub(super) db: Option<DbConn>,
    pub(super) session_policy: Arc<SessionPolicyRegistry>,
    pub(super) task_reconciler: Arc<std::sync::Mutex<TaskReconciler>>,
    pub(super) approval_callback_tracker: Arc<ApprovalCallbackTracker>,
}

#[async_trait]
impl cc_sdk::HookCallback for AcepePermissionRequestHook {
    async fn execute(
        &self,
        input: &cc_sdk::HookInput,
        tool_use_id: Option<&str>,
        _context: &cc_sdk::HookContext,
    ) -> Result<cc_sdk::HookJSONOutput, cc_sdk::SdkError> {
        let cc_sdk::HookInput::PermissionRequest(request) = input else {
            return Ok(cc_sdk::HookJSONOutput::Sync(cc_sdk::SyncHookJSONOutput {
                continue_: Some(true),
                ..Default::default()
            }));
        };

        if request.tool_name == "AskUserQuestion" {
            tracing::info!(
                session_id = %self.session_id,
                tool_name = %request.tool_name,
                tool_call_id = ?tool_use_id,
                "cc-sdk PermissionRequest hook ignored for AskUserQuestion"
            );
            return Ok(cc_sdk::HookJSONOutput::Sync(cc_sdk::SyncHookJSONOutput {
                continue_: Some(true),
                ..Default::default()
            }));
        }

        let request_id = self.bridge.next_id();
        let tool_call_id = tool_use_id
            .map(str::to_string)
            .unwrap_or_else(|| format!("cc-sdk-hook-{request_id}"));
        self.approval_callback_tracker
            .note_callback_received(
                &self.session_id,
                &request.tool_name,
                &tool_call_id,
                "PermissionRequest",
            )
            .await;
        if let Some(auto_accept_reason) = auto_accept_reason(
            &self.session_id,
            self.agent_type,
            &self.session_policy,
            &self.task_reconciler,
            &request.tool_name,
            &tool_call_id,
        ) {
            tracing::info!(
                session_id = %self.session_id,
                request_id = request_id,
                tool_name = %request.tool_name,
                tool_call_id = %tool_call_id,
                auto_accept_reason = auto_accept_reason,
                "cc-sdk PermissionRequest hook auto-accepted"
            );
            log_debug_event(
                &self.session_id,
                "permission.auto_accepted",
                &serde_json::json!({
                    "source": "PermissionRequest",
                    "requestId": request_id,
                    "toolName": request.tool_name,
                    "toolCallId": tool_call_id,
                    "reason": auto_accept_reason,
                }),
            );
            return Ok(cc_sdk::HookJSONOutput::Sync(cc_sdk::SyncHookJSONOutput {
                continue_: Some(true),
                reason: Some(format!(
                    "Acepe approval auto-accepted for {}",
                    request.tool_name
                )),
                hook_specific_output: Some(cc_sdk::HookSpecificOutput::PermissionRequest(
                    cc_sdk::PermissionRequestHookSpecificOutput {
                        decision: serde_json::json!({
                            "behavior": "allow",
                            "updatedInput": request.tool_input,
                        }),
                    },
                )),
                ..Default::default()
            }));
        }
        let permission_suggestions = parse_permission_suggestions(&request.permission_suggestions);
        let hook_request = HookPermissionRequest {
            tool_call_id: tool_call_id.clone(),
            tool_name: request.tool_name.clone(),
            reusable_approval_key: build_reusable_permission_key(
                &request.tool_name,
                &request.tool_input,
            ),
            original_input: request.tool_input.clone(),
            permission_suggestions: permission_suggestions.clone(),
        };
        let has_always_option = hook_request.has_always_option();
        let registration = self
            .bridge
            .register_hook(request_id, hook_request.clone())
            .await;
        let rx = registration.receiver;
        log_debug_event(
            &self.session_id,
            "permission.hook.registered",
            &serde_json::json!({
                "requestId": request_id,
                "toolName": request.tool_name,
                "toolCallId": tool_call_id,
                "uiDispatch": registration.ui_dispatch.as_str(),
                "suggestionCount": permission_suggestions.len(),
                "patterns": build_permission_patterns(&request.tool_input),
            }),
        );

        match registration.ui_dispatch {
            PermissionUiDispatch::Emit => {
                tracing::info!(
                    session_id = %self.session_id,
                    request_id = request_id,
                    tool_name = %request.tool_name,
                    tool_call_id = %tool_call_id,
                    suggestion_count = permission_suggestions.len(),
                    "cc-sdk PermissionRequest hook emitted"
                );
                log_debug_event(
                    &self.session_id,
                    "permission.ui.emit",
                    &serde_json::json!({
                        "source": "PermissionRequest",
                        "channel": "session_update",
                        "requestId": request_id,
                        "toolName": request.tool_name,
                        "toolCallId": tool_call_id,
                    }),
                );

                self.dispatcher.enqueue(AcpUiEvent::session_update(
                    build_permission_request_update(
                        &self.session_id,
                        &tool_call_id,
                        request_id,
                        &request.tool_name,
                        &request.tool_input,
                        has_always_option,
                        self.agent_type,
                        false,
                    ),
                ));
            }
            PermissionUiDispatch::JoinExisting => {
                tracing::info!(
                    session_id = %self.session_id,
                    request_id = request_id,
                    tool_name = %request.tool_name,
                    tool_call_id = %tool_call_id,
                    suggestion_count = permission_suggestions.len(),
                    "cc-sdk PermissionRequest hook joined existing pending approval"
                );
                log_debug_event(
                    &self.session_id,
                    "permission.ui.join",
                    &serde_json::json!({
                        "source": "PermissionRequest",
                        "requestId": request_id,
                        "toolName": request.tool_name,
                        "toolCallId": tool_call_id,
                    }),
                );
            }
            PermissionUiDispatch::ResolvedFromCache => {
                tracing::info!(
                    session_id = %self.session_id,
                    request_id = request_id,
                    tool_name = %request.tool_name,
                    tool_call_id = %tool_call_id,
                    suggestion_count = permission_suggestions.len(),
                    "cc-sdk PermissionRequest hook reused resolved approval"
                );
                log_debug_event(
                    &self.session_id,
                    "permission.ui.reused",
                    &serde_json::json!({
                        "source": "PermissionRequest",
                        "requestId": request_id,
                        "toolName": request.tool_name,
                        "toolCallId": tool_call_id,
                    }),
                );
            }
        }

        match rx.await {
            Ok(result) => Ok(result),
            Err(error) => {
                tracing::warn!(
                    session_id = %self.session_id,
                    request_id = request_id,
                    tool_name = %request.tool_name,
                    receiver_error = ?error,
                    "cc-sdk PermissionRequest hook receiver closed"
                );
                let cleared_request_ids = self
                    .bridge
                    .clear_request(request_id, "Permission request was cancelled")
                    .await;
                for cleared_request_id in cleared_request_ids {
                    reject_cc_sdk_interaction_request(
                        &self.projection_registry,
                        self.db.as_ref(),
                        &self.dispatcher,
                        &self.session_id,
                        cleared_request_id,
                        "Permission request was cancelled",
                    )
                    .await;
                }
                Ok(build_denied_hook_output(
                    &hook_request,
                    "Permission request was cancelled",
                ))
            }
        }
    }
}

fn parse_permission_suggestions(suggestions: &Option<Vec<Value>>) -> Vec<cc_sdk::PermissionUpdate> {
    suggestions
        .iter()
        .flatten()
        .filter_map(|value| serde_json::from_value::<cc_sdk::PermissionUpdate>(value.clone()).ok())
        .collect()
}

#[allow(clippy::too_many_arguments)]
pub(super) fn build_permission_request_update(
    session_id: &str,
    tool_call_id: &str,
    request_id: u64,
    tool_name: &str,
    diagnostic_input: &Value,
    has_always_option: bool,
    agent_type: AgentType,
    auto_accepted: bool,
) -> SessionUpdate {
    SessionUpdate::PermissionRequest {
        permission: crate::acp::session_update::PermissionData {
            id: request_id.to_string(),
            session_id: session_id.to_string(),
            json_rpc_request_id: Some(request_id),
            reply_handler: Some(
                crate::acp::session_update::InteractionReplyHandler::json_rpc(request_id),
            ),
            permission: tool_name.to_string(),
            patterns: build_permission_patterns(diagnostic_input),
            metadata: build_permission_metadata(tool_name, diagnostic_input, agent_type),
            always: if has_always_option {
                vec!["allow_always".to_string()]
            } else {
                Vec::new()
            },
            auto_accepted,
            tool: Some(ToolReference {
                message_id: None,
                call_id: tool_call_id.to_string(),
            }),
        },
        session_id: Some(session_id.to_string()),
    }
}

fn allow_permission_result() -> cc_sdk::PermissionResult {
    cc_sdk::PermissionResult::Allow(cc_sdk::PermissionResultAllow {
        updated_input: None,
        updated_permissions: None,
    })
}

impl AcepePermissionHandler {
    fn auto_accept_reason(&self, tool_name: &str, tool_call_id: &str) -> Option<&'static str> {
        auto_accept_reason(
            &self.session_id,
            self.agent_type,
            &self.session_policy,
            &self.task_reconciler,
            tool_name,
            tool_call_id,
        )
    }
}

fn auto_accept_reason(
    session_id: &str,
    agent_type: AgentType,
    session_policy: &SessionPolicyRegistry,
    task_reconciler: &std::sync::Mutex<TaskReconciler>,
    tool_name: &str,
    tool_call_id: &str,
) -> Option<&'static str> {
    if is_exit_plan_permission(tool_name, agent_type) {
        return None;
    }

    if session_policy.is_autonomous(session_id) {
        return Some("autonomous");
    }

    let task_reconciler = task_reconciler
        .lock()
        .expect("task reconciler lock should not be poisoned");
    task_reconciler
        .parent_for_child(tool_call_id)
        .map(|_| "child_tool_call")
}

fn is_exit_plan_permission(tool_name: &str, agent_type: AgentType) -> bool {
    get_parser(agent_type).detect_tool_kind(tool_name) == ToolKind::ExitPlanMode
}

fn build_permission_patterns(diagnostic_input: &Value) -> Vec<String> {
    ["command", "file_path", "filePath", "path", "query"]
        .into_iter()
        .filter_map(|key| diagnostic_input.get(key).and_then(Value::as_str))
        .map(ToString::to_string)
        .collect()
}

fn build_reusable_permission_key_from_patterns(
    permission_name: &str,
    patterns: &[String],
) -> Option<String> {
    if patterns.is_empty() {
        return None;
    }

    let mut patterns = patterns.to_vec();
    patterns.sort();
    Some(format!("{permission_name}::{}", patterns.join("||")))
}

pub(super) fn build_reusable_permission_key(
    tool_name: &str,
    diagnostic_input: &Value,
) -> Option<String> {
    build_reusable_permission_key_from_patterns(
        tool_name,
        &build_permission_patterns(diagnostic_input),
    )
}

pub(super) fn build_permission_metadata(
    tool_name: &str,
    diagnostic_input: &Value,
    agent_type: AgentType,
) -> Value {
    let parser = get_parser(agent_type);
    let parsed_arguments = serde_json::to_value(
        classify_raw_tool_call(
            parser,
            tool_name,
            diagnostic_input,
            ToolClassificationHints {
                name: Some(tool_name),
                title: Some(tool_name),
                kind: Some(parser.detect_tool_kind(tool_name)),
                kind_hint: None,
                locations: None,
            },
        )
        .arguments,
    )
    .ok();

    let mut metadata = serde_json::Map::from_iter([
        ("diagnosticRawInput".to_string(), diagnostic_input.clone()),
        ("options".to_string(), Value::Array(Vec::new())),
    ]);

    if let Some(parsed_arguments) = parsed_arguments {
        metadata.insert("parsedArguments".to_string(), parsed_arguments);
    }

    Value::Object(metadata)
}
