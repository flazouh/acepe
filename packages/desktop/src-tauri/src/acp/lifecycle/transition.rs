use crate::acp::lifecycle::state::LifecycleStatus;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleTransition {
    pub from: LifecycleStatus,
    pub to: LifecycleStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum LifecycleTransitionError {
    IllegalTransition {
        from: LifecycleStatus,
        to: LifecycleStatus,
    },
}

impl LifecycleTransition {
    pub fn validate(
        from: LifecycleStatus,
        to: LifecycleStatus,
    ) -> Result<Self, LifecycleTransitionError> {
        let legal = matches!(
            (from, to),
            (LifecycleStatus::Reserved, LifecycleStatus::Activating)
                | (LifecycleStatus::Reserved, LifecycleStatus::Archived)
                | (LifecycleStatus::Activating, LifecycleStatus::Ready)
                | (LifecycleStatus::Activating, LifecycleStatus::Failed)
                | (LifecycleStatus::Ready, LifecycleStatus::Reconnecting)
                | (LifecycleStatus::Ready, LifecycleStatus::Archived)
                | (LifecycleStatus::Reconnecting, LifecycleStatus::Ready)
                | (LifecycleStatus::Reconnecting, LifecycleStatus::Detached)
                | (LifecycleStatus::Reconnecting, LifecycleStatus::Failed)
                | (LifecycleStatus::Detached, LifecycleStatus::Activating)
                | (LifecycleStatus::Detached, LifecycleStatus::Archived)
                | (LifecycleStatus::Failed, LifecycleStatus::Activating)
                | (LifecycleStatus::Failed, LifecycleStatus::Archived)
        );

        if legal {
            Ok(Self { from, to })
        } else {
            Err(LifecycleTransitionError::IllegalTransition { from, to })
        }
    }
}
