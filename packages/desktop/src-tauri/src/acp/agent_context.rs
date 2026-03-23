use crate::acp::parsers::AgentType;

tokio::task_local! {
    static TASK_AGENT: AgentType;
}

pub fn with_agent<F, R>(agent: AgentType, f: F) -> R
where
    F: FnOnce() -> R,
{
    TASK_AGENT.sync_scope(agent, f)
}

pub fn current_agent() -> AgentType {
    TASK_AGENT
        .try_with(|agent| *agent)
        .unwrap_or(AgentType::ClaudeCode)
}

#[cfg(test)]
mod tests {
    use super::{current_agent, with_agent};
    use crate::acp::parsers::AgentType;

    #[test]
    fn defaults_to_claude_and_restores_after_nesting() {
        assert_eq!(current_agent(), AgentType::ClaudeCode);

        with_agent(AgentType::Codex, || {
            assert_eq!(current_agent(), AgentType::Codex);
            with_agent(AgentType::Cursor, || {
                assert_eq!(current_agent(), AgentType::Cursor)
            });
            assert_eq!(current_agent(), AgentType::Codex);
        });

        assert_eq!(current_agent(), AgentType::ClaudeCode);
    }

    #[tokio::test]
    async fn maintains_context_across_await_points() {
        // Default context
        assert_eq!(current_agent(), AgentType::ClaudeCode);

        // Set context and verify it persists across .await
        let result = super::TASK_AGENT
            .scope(AgentType::Codex, async {
                assert_eq!(current_agent(), AgentType::Codex);

                // Simulate async work
                tokio::time::sleep(tokio::time::Duration::from_millis(1)).await;

                // Context should still be Codex after .await
                assert_eq!(current_agent(), AgentType::Codex);

                // Nested context
                let nested = super::TASK_AGENT
                    .scope(AgentType::Cursor, async {
                        assert_eq!(current_agent(), AgentType::Cursor);

                        tokio::time::sleep(tokio::time::Duration::from_millis(1)).await;

                        assert_eq!(current_agent(), AgentType::Cursor);
                        42
                    })
                    .await;

                // After nested scope, should be back to Codex
                assert_eq!(current_agent(), AgentType::Codex);

                nested
            })
            .await;

        assert_eq!(result, 42);

        // Back to default
        assert_eq!(current_agent(), AgentType::ClaudeCode);
    }
}
