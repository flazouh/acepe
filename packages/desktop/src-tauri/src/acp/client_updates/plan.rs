use super::*;

pub(super) fn extract_streaming_plan(
    update: &SessionUpdate,
    agent_type: AgentType,
    provider: Option<&dyn AgentProvider>,
) -> Option<(PlanData, Option<String>)> {
    match update {
        SessionUpdate::ToolCallUpdate {
            update: tool_update,
            session_id,
        } => tool_update.streaming_plan.clone().map(|plan| {
            (
                enrich_plan_data(plan, agent_type, provider),
                session_id.clone(),
            )
        }),
        _ => None,
    }
}

pub(super) fn extract_codex_wrapper_plan(
    update: &SessionUpdate,
) -> Option<(PlanData, Option<String>)> {
    let session_id = update.session_id()?.to_string();
    let text = match update {
        SessionUpdate::AgentMessageChunk { chunk, .. }
        | SessionUpdate::AgentThoughtChunk { chunk, .. } => extract_text(chunk),
        _ => None,
    }?;

    let plan = crate::acp::streaming_accumulator::process_codex_plan_chunk(&session_id, text)?;
    Some((
        enrich_plan_data(plan, AgentType::Codex, None),
        Some(session_id),
    ))
}

pub(super) fn finalize_codex_wrapper_on_turn_end(
    update: &SessionUpdate,
) -> Option<(PlanData, Option<String>)> {
    match update {
        SessionUpdate::TurnComplete { session_id }
        | SessionUpdate::TurnError { session_id, .. } => {
            let sid = session_id.as_ref()?;
            let plan = crate::acp::streaming_accumulator::finalize_codex_plan_streaming(sid)?;
            Some((
                enrich_plan_data(plan, AgentType::Codex, None),
                Some(sid.clone()),
            ))
        }
        _ => None,
    }
}

fn extract_text(chunk: &crate::acp::session_update::ContentChunk) -> Option<&str> {
    match &chunk.content {
        ContentBlock::Text { text } => Some(text.as_str()),
        _ => None,
    }
}

pub(super) fn enrich_plan_update(
    update: SessionUpdate,
    agent_type: AgentType,
    provider: Option<&dyn AgentProvider>,
) -> SessionUpdate {
    match update {
        SessionUpdate::Plan { plan, session_id } => SessionUpdate::Plan {
            plan: enrich_plan_data(plan, agent_type, provider),
            session_id,
        },
        other => other,
    }
}

pub(super) fn enrich_plan_data(
    mut plan: PlanData,
    agent_type: AgentType,
    provider: Option<&dyn AgentProvider>,
) -> PlanData {
    let canonical_agent = provider
        .map(|provider| provider.id().to_string())
        .unwrap_or_else(|| agent_id_for_agent(agent_type).to_string());

    plan.has_plan = plan.has_plan
        || plan.content.is_some()
        || plan.content_markdown.is_some()
        || !plan.steps.is_empty();

    if plan.content_markdown.is_none() {
        plan.content_markdown = plan
            .content
            .clone()
            .or_else(|| render_steps_markdown(&plan.steps));
    }
    if plan.content.is_none() {
        plan.content = plan.content_markdown.clone();
    }

    if plan.source.is_none() {
        plan.source = Some(provider.map(AgentProvider::default_plan_source).unwrap_or(
            match agent_type {
                AgentType::ClaudeCode | AgentType::Cursor => PlanSource::Deterministic,
                AgentType::OpenCode | AgentType::Codex => PlanSource::Heuristic,
            },
        ));
    }
    if plan.confidence.is_none() {
        plan.confidence = Some(
            provider
                .map(|provider| {
                    provider.default_plan_confidence(
                        plan.source
                            .unwrap_or_else(|| provider.default_plan_source()),
                    )
                })
                .unwrap_or(match plan.source {
                    Some(PlanSource::Deterministic) => PlanConfidence::High,
                    Some(PlanSource::Heuristic) | None => PlanConfidence::Medium,
                }),
        );
    }
    if plan.agent_id.is_none() {
        plan.agent_id = Some(canonical_agent);
    }
    if plan.updated_at.is_none() {
        plan.updated_at = Some(chrono::Utc::now().timestamp_millis());
    }

    plan
}

fn render_steps_markdown(steps: &[crate::acp::session_update::PlanStep]) -> Option<String> {
    if steps.is_empty() {
        return None;
    }

    let mut markdown = String::from("# Plan\n\n");
    for step in steps {
        let prefix = match step.status {
            crate::acp::session_update::PlanStepStatus::Completed => "[x]",
            crate::acp::session_update::PlanStepStatus::InProgress => "[-]",
            crate::acp::session_update::PlanStepStatus::Pending => "[ ]",
            crate::acp::session_update::PlanStepStatus::Failed => "[!]",
        };
        markdown.push_str("- ");
        markdown.push_str(prefix);
        markdown.push(' ');
        markdown.push_str(step.description.as_str());
        markdown.push('\n');
    }

    Some(markdown)
}

fn agent_id_for_agent(agent_type: AgentType) -> &'static str {
    match agent_type {
        AgentType::ClaudeCode => "claude-code",
        AgentType::OpenCode => "opencode",
        AgentType::Cursor => "cursor",
        AgentType::Codex => "codex",
    }
}
