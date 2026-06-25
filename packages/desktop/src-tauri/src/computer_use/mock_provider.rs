use async_trait::async_trait;
use tokio::sync::Mutex;

use super::ids::{computer_element_fingerprint, computer_element_id};
use super::runtime::ComputerProvider;
use super::types::{
    ComputerActionInput, ComputerBounds, ComputerError, ComputerProviderElement,
    ComputerProviderEnvironment, ComputerProviderSnapshot,
};

pub struct MockComputerProvider {
    state: Mutex<MockComputerState>,
}

#[derive(Debug, Clone)]
struct MockComputerState {
    revision: u64,
    elements: Vec<ComputerProviderElement>,
}

impl MockComputerProvider {
    pub fn new(elements: Vec<ComputerProviderElement>) -> Self {
        Self {
            state: Mutex::new(MockComputerState {
                revision: 0,
                elements,
            }),
        }
    }

    pub fn default_desktop() -> Self {
        Self::new(vec![
            ComputerProviderElement {
                scope_key: Some("app:Acepe/window:Main".to_string()),
                identity_key: Some("mock/window:acepe".to_string()),
                role: "window".to_string(),
                label: "Acepe".to_string(),
                value: None,
                bounds: Some(ComputerBounds {
                    x: 0,
                    y: 0,
                    width: 1200,
                    height: 800,
                }),
                enabled: true,
                focused: false,
            },
            ComputerProviderElement {
                scope_key: Some("app:Acepe/window:Main".to_string()),
                identity_key: Some("mock/window:acepe/button:run".to_string()),
                role: "button".to_string(),
                label: "Run".to_string(),
                value: None,
                bounds: Some(ComputerBounds {
                    x: 1040,
                    y: 720,
                    width: 96,
                    height: 40,
                }),
                enabled: true,
                focused: true,
            },
        ])
    }
}

#[async_trait]
impl ComputerProvider for MockComputerProvider {
    async fn environment(&self) -> Result<ComputerProviderEnvironment, ComputerError> {
        Ok(ComputerProviderEnvironment {
            app: Some("Acepe".to_string()),
            window: Some("Main".to_string()),
            busy: Some(false),
        })
    }

    async fn observe(
        &self,
        _action: &ComputerActionInput,
    ) -> Result<ComputerProviderSnapshot, ComputerError> {
        let state = self.state.lock().await;
        Ok(ComputerProviderSnapshot {
            revision: state.revision,
            settled_ms: None,
            environment: ComputerProviderEnvironment {
                app: Some("Acepe".to_string()),
                window: Some("Main".to_string()),
                busy: Some(false),
            },
            elements: state.elements.clone(),
            changed_fingerprints: Vec::new(),
            screenshot_ref: Some(format!("mock://computer/s_{}", state.revision)),
        })
    }

    async fn act(
        &self,
        action: &ComputerActionInput,
    ) -> Result<ComputerProviderSnapshot, ComputerError> {
        let mut state = self.state.lock().await;
        state.revision += 1;
        let revision = state.revision;
        let mut changed_fingerprints = Vec::new();
        if let Some(target_id) = action.target_id.as_ref() {
            if let Some(element) = state
                .elements
                .iter_mut()
                .find(|element| computer_element_id(element) == *target_id)
            {
                element.value = Some(format!("changed:{revision}"));
                changed_fingerprints.push(computer_element_fingerprint(element));
            }
        }

        Ok(ComputerProviderSnapshot {
            revision: state.revision,
            settled_ms: Some(0),
            environment: ComputerProviderEnvironment {
                app: Some("Acepe".to_string()),
                window: Some("Main".to_string()),
                busy: Some(false),
            },
            elements: state.elements.clone(),
            changed_fingerprints,
            screenshot_ref: Some(format!("mock://computer/s_{}", state.revision)),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::computer_use::runtime::ComputerRuntime;
    use crate::computer_use::types::{ComputerActionInput, ComputerActionVerb};

    #[tokio::test]
    async fn epoch_changes_after_mutation() {
        let runtime = ComputerRuntime::new(Box::new(MockComputerProvider::default_desktop()));
        let observed = runtime
            .execute(ComputerActionInput {
                verb: ComputerActionVerb::Observe,
                target_id: None,
                epoch: None,
                text: None,
                key: None,
                delta_x: None,
                delta_y: None,
                include_bounds: false,
                include_screenshot: false,
            })
            .await
            .expect("observe");
        let target_id = observed.elements[1].id.clone();

        let clicked = runtime
            .execute(ComputerActionInput {
                verb: ComputerActionVerb::Click,
                target_id: Some(target_id),
                epoch: Some(observed.epoch.clone()),
                text: None,
                key: None,
                delta_x: None,
                delta_y: None,
                include_bounds: false,
                include_screenshot: false,
            })
            .await
            .expect("click");

        assert_ne!(observed.epoch, clicked.epoch);
    }

    #[tokio::test]
    async fn observation_includes_compact_environment_summary() {
        let runtime = ComputerRuntime::new(Box::new(MockComputerProvider::default_desktop()));
        let observed = runtime
            .execute(ComputerActionInput {
                verb: ComputerActionVerb::Observe,
                target_id: None,
                epoch: None,
                text: None,
                key: None,
                delta_x: None,
                delta_y: None,
                include_bounds: false,
                include_screenshot: false,
            })
            .await
            .expect("observe");
        let focused_id = observed.elements[1].id.clone();
        let environment = observed.environment.expect("environment");

        assert_eq!(environment.app.as_deref(), Some("Acepe"));
        assert_eq!(environment.window.as_deref(), Some("Main"));
        assert_eq!(
            environment.focused_target_id.as_deref(),
            Some(focused_id.as_str())
        );
        assert_eq!(environment.busy, Some(false));
    }

    #[tokio::test]
    async fn action_output_returns_changed_elements_only() {
        let runtime = ComputerRuntime::new(Box::new(MockComputerProvider::default_desktop()));
        let observed = runtime
            .execute(ComputerActionInput {
                verb: ComputerActionVerb::Observe,
                target_id: None,
                epoch: None,
                text: None,
                key: None,
                delta_x: None,
                delta_y: None,
                include_bounds: false,
                include_screenshot: false,
            })
            .await
            .expect("observe");
        let target_id = observed.elements[1].id.clone();

        let clicked = runtime
            .execute(ComputerActionInput {
                verb: ComputerActionVerb::Click,
                target_id: Some(target_id.clone()),
                epoch: Some(observed.epoch),
                text: None,
                key: None,
                delta_x: None,
                delta_y: None,
                include_bounds: false,
                include_screenshot: false,
            })
            .await
            .expect("click");

        assert_eq!(clicked.changed, vec![target_id.clone()]);
        assert_eq!(clicked.elements.len(), 1);
        assert_eq!(clicked.elements[0].id, target_id);
    }
}
