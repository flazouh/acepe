use std::mem::size_of;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HardLimit {
    Finite(u64),
    Infinite,
}

const MAX_OPEN_FILES_SOFT_LIMIT: u64 = 65_536;

fn desired_soft_limit(
    current_soft: u64,
    hard_limit: HardLimit,
    per_process_limit: Option<u64>,
) -> Option<u64> {
    let target = match hard_limit {
        HardLimit::Finite(limit) => limit.min(MAX_OPEN_FILES_SOFT_LIMIT),
        HardLimit::Infinite => per_process_limit
            .unwrap_or(MAX_OPEN_FILES_SOFT_LIMIT)
            .min(MAX_OPEN_FILES_SOFT_LIMIT),
    };

    if target <= current_soft {
        return None;
    }

    Some(target)
}

fn read_fd_limits() -> std::io::Result<(u64, HardLimit)> {
    let mut limits = libc::rlimit {
        rlim_cur: 0,
        rlim_max: 0,
    };

    let status = unsafe { libc::getrlimit(libc::RLIMIT_NOFILE, &mut limits) };
    if status != 0 {
        return Err(std::io::Error::last_os_error());
    }

    let hard_limit = if limits.rlim_max == libc::RLIM_INFINITY {
        HardLimit::Infinite
    } else {
        HardLimit::Finite(limits.rlim_max)
    };

    Ok((limits.rlim_cur, hard_limit))
}

fn read_maxfiles_per_process() -> std::io::Result<u64> {
    let mut value: libc::c_int = 0;
    let mut length = size_of::<libc::c_int>();
    let name = b"kern.maxfilesperproc\0";

    let status = unsafe {
        libc::sysctlbyname(
            name.as_ptr().cast(),
            (&mut value as *mut libc::c_int).cast(),
            &mut length,
            std::ptr::null_mut(),
            0,
        )
    };

    if status != 0 {
        return Err(std::io::Error::last_os_error());
    }

    if value <= 0 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "kern.maxfilesperproc returned a non-positive value",
        ));
    }

    Ok(value as u64)
}

fn set_soft_limit(target_soft_limit: u64, hard_limit: HardLimit) -> std::io::Result<()> {
    let limits = libc::rlimit {
        rlim_cur: target_soft_limit,
        rlim_max: match hard_limit {
            HardLimit::Finite(limit) => limit,
            HardLimit::Infinite => libc::RLIM_INFINITY,
        },
    };

    let status = unsafe { libc::setrlimit(libc::RLIMIT_NOFILE, &limits) };
    if status != 0 {
        return Err(std::io::Error::last_os_error());
    }

    Ok(())
}

pub fn raise_fd_limits() {
    let (current_soft_limit, hard_limit) = match read_fd_limits() {
        Ok(limits) => limits,
        Err(error) => {
            tracing::warn!(error = %error, "Failed to read macOS fd limits");
            return;
        }
    };

    let per_process_limit = if matches!(hard_limit, HardLimit::Infinite) {
        match read_maxfiles_per_process() {
            Ok(limit) => Some(limit),
            Err(error) => {
                tracing::debug!(
                    error = %error,
                    "Failed to read kern.maxfilesperproc, falling back to default cap"
                );
                None
            }
        }
    } else {
        None
    };

    tracing::debug!(
        current_soft_limit,
        hard_limit = ?hard_limit,
        per_process_limit,
        "Read macOS fd limits"
    );

    let Some(target_soft_limit) =
        desired_soft_limit(current_soft_limit, hard_limit, per_process_limit)
    else {
        tracing::debug!(
            current_soft_limit,
            "macOS fd soft limit already meets the startup target"
        );
        return;
    };

    match set_soft_limit(target_soft_limit, hard_limit) {
        Ok(()) => {
            tracing::info!(
                from = current_soft_limit,
                to = target_soft_limit,
                "Raised macOS fd soft limit"
            );
        }
        Err(error) => {
            tracing::warn!(
                from = current_soft_limit,
                to = target_soft_limit,
                error = %error,
                "Failed to raise macOS fd soft limit"
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{desired_soft_limit, HardLimit, MAX_OPEN_FILES_SOFT_LIMIT};

    #[test]
    fn raises_to_finite_hard_limit_when_it_is_lower_than_cap() {
        assert_eq!(
            desired_soft_limit(256, HardLimit::Finite(4096), Some(8192)),
            Some(4096)
        );
    }

    #[test]
    fn caps_finite_hard_limits_at_reasonable_maximum() {
        assert_eq!(
            desired_soft_limit(256, HardLimit::Finite(200_000), Some(200_000)),
            Some(MAX_OPEN_FILES_SOFT_LIMIT)
        );
    }

    #[test]
    fn uses_per_process_limit_when_hard_limit_is_infinite() {
        assert_eq!(
            desired_soft_limit(256, HardLimit::Infinite, Some(16_384)),
            Some(16_384)
        );
    }

    #[test]
    fn falls_back_to_reasonable_cap_when_infinite_limit_has_no_sysctl_value() {
        assert_eq!(
            desired_soft_limit(256, HardLimit::Infinite, None),
            Some(MAX_OPEN_FILES_SOFT_LIMIT)
        );
    }

    #[test]
    fn does_not_lower_an_already_high_soft_limit() {
        assert_eq!(
            desired_soft_limit(70_000, HardLimit::Finite(80_000), Some(80_000)),
            None
        );
    }
}
