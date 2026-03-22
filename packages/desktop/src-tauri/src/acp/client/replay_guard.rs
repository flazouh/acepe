use std::sync::Arc as StdArc;

pub(super) struct ReplayGuard {
    flag: StdArc<std::sync::atomic::AtomicBool>,
}

impl ReplayGuard {
    pub(super) fn activate(flag: &StdArc<std::sync::atomic::AtomicBool>) -> Self {
        flag.store(true, std::sync::atomic::Ordering::Release);
        Self { flag: flag.clone() }
    }
}

impl Drop for ReplayGuard {
    fn drop(&mut self) {
        self.flag.store(false, std::sync::atomic::Ordering::Release);
    }
}
