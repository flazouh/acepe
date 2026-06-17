use crate::acp::provider_extensions::{InboundResponseAdapter, ProviderExtensionEvent};
use crate::acp::session_update::{
    PlanConfidence, PlanData, PlanSource, PlanStep, SessionUpdate, ToolArguments, ToolCallData,
    ToolCallStatus, ToolKind,
};
use serde::Deserialize;
use serde_json::Value;

use super::shared::{create_plan_step, CreatePlanTodo};
use super::CURSOR_CREATE_PLAN;

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

pub(crate) fn normalize(
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

    if request_id.is_some() {
        updates.push(SessionUpdate::ToolCall {
            tool_call: ToolCallData {
                id: tool_call_id,
                name: CURSOR_CREATE_PLAN.to_string(),
                arguments: ToolArguments::Other {
                    raw: params.clone(),
                    intent: None,
                },
                diagnostic_input: Some(params.clone()),
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
