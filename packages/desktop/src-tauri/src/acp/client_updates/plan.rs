use crate::acp::parsers::provider_capabilities::provider_capabilities;
use crate::acp::parsers::AgentType;
use crate::acp::provider::AgentProvider;
use crate::acp::session_update::{PlanConfidence, PlanData, PlanSource, SessionUpdate};

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
        .unwrap_or_else(|| agent_type.as_str().to_string());

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
        plan.source = Some(
            provider
                .map(AgentProvider::default_plan_source)
                .unwrap_or(provider_capabilities(agent_type).default_plan_source),
        );
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::providers::claude_code::ClaudeCodeProvider;
    use crate::acp::providers::codex::adapt_codex_wrapper_plan_update;
    use crate::acp::session_update::PlanStep;
    use crate::acp::session_update::PlanStepStatus;
    use crate::acp::session_update::{ContentChunk, SessionUpdate};
    use crate::acp::streaming_accumulator::cleanup_codex_plan_streaming;
    use crate::acp::types::ContentBlock;

    fn empty_plan() -> PlanData {
        PlanData::from_steps(Vec::new())
    }

    #[test]
    fn enrich_plan_data_uses_registry_defaults_without_provider() {
        let plan = enrich_plan_data(empty_plan(), AgentType::Cursor, None);

        assert_eq!(plan.source, Some(PlanSource::Deterministic));
        assert_eq!(plan.confidence, Some(PlanConfidence::High));
        assert_eq!(plan.agent_id.as_deref(), Some("cursor"));
    }

    #[test]
    fn enrich_plan_data_preserves_provider_owned_defaults() {
        let provider = ClaudeCodeProvider;
        let plan = enrich_plan_data(empty_plan(), AgentType::OpenCode, Some(&provider));

        assert_eq!(plan.source, Some(PlanSource::Deterministic));
        assert_eq!(plan.confidence, Some(PlanConfidence::High));
        assert_eq!(plan.agent_id.as_deref(), Some("claude-code"));
    }

    #[test]
    fn enrich_plan_data_renders_steps_markdown_when_content_missing() {
        let plan = enrich_plan_data(
            PlanData::from_steps(vec![PlanStep {
                description: "Ship the refactor".to_string(),
                status: PlanStepStatus::InProgress,
            }]),
            AgentType::Codex,
            None,
        );

        assert_eq!(
            plan.content_markdown.as_deref(),
            Some("# Plan\n\n- [-] Ship the refactor\n")
        );
    }

    #[test]
    fn provider_owned_codex_wrapper_chunk_keeps_shared_enrichment_parity() {
        let session_id = "plan-test-provider-wrapper-chunk";
        let adapted = adapt_codex_wrapper_plan_update(&SessionUpdate::AgentMessageChunk {
            chunk: ContentChunk {
                content: ContentBlock::Text {
                    text: "<proposed_plan># Plan\n\n- ship it\n</proposed_plan>".to_string(),
                },
                aggregation_hint: None,
            },
            part_id: Some("msg-1".to_string()),
            message_id: Some("msg-1".to_string()),
            session_id: Some(session_id.to_string()),
        })
        .expect("wrapper plan should adapt");

        let enriched = enrich_plan_update(adapted, AgentType::Codex, None);
        match enriched {
            SessionUpdate::Plan {
                plan,
                session_id: emitted_session_id,
            } => {
                assert_eq!(emitted_session_id.as_deref(), Some(session_id));
                assert!(!plan.streaming);
                assert_eq!(plan.content.as_deref(), Some("# Plan\n\n- ship it\n"));
                assert_eq!(
                    plan.content_markdown.as_deref(),
                    Some("# Plan\n\n- ship it\n")
                );
                assert_eq!(plan.source, Some(PlanSource::Heuristic));
                assert_eq!(plan.confidence, Some(PlanConfidence::Medium));
                assert_eq!(plan.agent_id.as_deref(), Some("codex"));
                assert!(plan.updated_at.is_some());
            }
            other => panic!("expected plan update, got {other:?}"),
        }

        cleanup_codex_plan_streaming(session_id);
    }

    #[test]
    fn provider_owned_codex_wrapper_turn_end_flushes_partial_plan() {
        let session_id = "plan-test-provider-wrapper-turn-end";
        let streamed = adapt_codex_wrapper_plan_update(&SessionUpdate::AgentThoughtChunk {
            chunk: ContentChunk {
                content: ContentBlock::Text {
                    text: "<proposed_plan># Partial".to_string(),
                },
                aggregation_hint: None,
            },
            part_id: Some("reason-1".to_string()),
            message_id: Some("reason-1".to_string()),
            session_id: Some(session_id.to_string()),
        })
        .expect("opening wrapper should stream plan");

        match streamed {
            SessionUpdate::Plan { plan, .. } => {
                assert!(plan.streaming);
                assert_eq!(plan.content.as_deref(), Some(""));
            }
            other => panic!("expected streaming plan, got {other:?}"),
        }

        let finalized = adapt_codex_wrapper_plan_update(&SessionUpdate::TurnComplete {
            session_id: Some(session_id.to_string()),
            turn_id: None,
        })
        .expect("turn end should flush plan");
        let enriched = enrich_plan_update(finalized, AgentType::Codex, None);

        match enriched {
            SessionUpdate::Plan { plan, .. } => {
                assert!(!plan.streaming);
                assert_eq!(plan.content.as_deref(), Some("# Partial"));
                assert_eq!(plan.source, Some(PlanSource::Heuristic));
                assert_eq!(plan.confidence, Some(PlanConfidence::Medium));
            }
            other => panic!("expected finalized plan, got {other:?}"),
        }
    }

    #[test]
    fn provider_owned_codex_wrapper_adapter_noops_for_non_plan_and_malformed_updates() {
        let session_id = "plan-test-provider-wrapper-noop";

        let non_plan = adapt_codex_wrapper_plan_update(&SessionUpdate::AgentMessageChunk {
            chunk: ContentChunk {
                content: ContentBlock::Text {
                    text: "plain assistant text".to_string(),
                },
                aggregation_hint: None,
            },
            part_id: Some("msg-plain".to_string()),
            message_id: Some("msg-plain".to_string()),
            session_id: Some(session_id.to_string()),
        });
        assert!(non_plan.is_none());

        let malformed = adapt_codex_wrapper_plan_update(&SessionUpdate::AgentMessageChunk {
            chunk: ContentChunk {
                content: ContentBlock::Text {
                    text: "</proposed_plan>".to_string(),
                },
                aggregation_hint: None,
            },
            part_id: Some("msg-malformed".to_string()),
            message_id: Some("msg-malformed".to_string()),
            session_id: Some(session_id.to_string()),
        });
        assert!(malformed.is_none());

        cleanup_codex_plan_streaming(session_id);
    }
}
