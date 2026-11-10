//! Which processes make up an application: a browser plays its sound from
//! a child process, so an application is recorded from the root of its tree.
#![cfg_attr(not(target_os = "windows"), allow(dead_code))]

/// A running process, as a process snapshot lists it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ProcessEntry {
    pub pid: u32,
    pub parent_pid: u32,
    /// The executable file name, e.g. `Telegram.exe`.
    pub exe_name: String,
}

/// The id of the application a process belongs to: the executable name of
/// the root of its tree, see `AudioAppId`.
pub(crate) fn app_root(processes: &[ProcessEntry], pid: u32) -> Option<&ProcessEntry> {
    let mut current = processes.iter().find(|process| process.pid == pid)?;
    // a parent of the same executable is the same application: walk up to
    // the topmost one, guarding against a loop of reused ids
    for _ in 0..processes.len() {
        let parent = processes.iter().find(|process| {
            process.pid == current.parent_pid
                && process.pid != current.pid
                && process.exe_name.eq_ignore_ascii_case(&current.exe_name)
        });
        match parent {
            Some(parent) => current = parent,
            None => break,
        }
    }
    Some(current)
}

/// The roots of the trees of the application `app_id`, an executable name.
pub(crate) fn app_roots(processes: &[ProcessEntry], app_id: &str) -> Vec<u32> {
    processes
        .iter()
        .filter(|process| process.exe_name.eq_ignore_ascii_case(app_id))
        .filter_map(|process| app_root(processes, process.pid))
        .map(|root| root.pid)
        .fold(Vec::new(), |mut roots, pid| {
            if !roots.contains(&pid) {
                roots.push(pid);
            }
            roots
        })
}

/// Whether `pid` is `ancestor` or one of its descendants.
pub(crate) fn is_in_tree(processes: &[ProcessEntry], pid: u32, ancestor: u32) -> bool {
    let mut current = pid;
    for _ in 0..=processes.len() {
        if current == ancestor {
            return true;
        }
        match processes.iter().find(|process| process.pid == current) {
            Some(process) if process.parent_pid != current => current = process.parent_pid,
            _ => return false,
        }
    }
    false
}

/// What the user sees for an executable: `Telegram` for `Telegram.exe`.
pub(crate) fn app_label(exe_name: &str) -> String {
    let stem = exe_name
        .strip_suffix(".exe")
        .or_else(|| exe_name.strip_suffix(".EXE"))
        .unwrap_or(exe_name);
    stem.to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn process(pid: u32, parent_pid: u32, exe_name: &str) -> ProcessEntry {
        ProcessEntry {
            pid,
            parent_pid,
            exe_name: exe_name.into(),
        }
    }

    fn browser() -> Vec<ProcessEntry> {
        vec![
            process(1, 0, "explorer.exe"),
            process(10, 1, "chrome.exe"),
            process(11, 10, "chrome.exe"),
            process(12, 10, "chrome.exe"),
            process(20, 1, "Telegram.exe"),
        ]
    }

    #[test]
    fn a_child_of_a_browser_belongs_to_its_root() {
        let processes = browser();
        assert_eq!(app_root(&processes, 12).unwrap().pid, 10);
        assert_eq!(app_root(&processes, 20).unwrap().pid, 20);
    }

    #[test]
    fn an_application_is_found_by_its_executable_in_any_case() {
        let processes = browser();
        assert_eq!(app_roots(&processes, "CHROME.EXE"), vec![10]);
        assert_eq!(app_roots(&processes, "telegram.exe"), vec![20]);
        assert!(app_roots(&processes, "firefox.exe").is_empty());
    }

    #[test]
    fn independent_instances_are_all_captured_without_duplicate_children() {
        let mut processes = browser();
        processes.push(process(30, 1, "chrome.exe"));
        processes.push(process(31, 30, "chrome.exe"));
        assert_eq!(app_roots(&processes, "chrome.exe"), vec![10, 30]);
    }

    #[test]
    fn a_tree_holds_its_descendants_only() {
        let processes = browser();
        assert!(is_in_tree(&processes, 12, 10));
        assert!(!is_in_tree(&processes, 20, 10));
    }

    #[test]
    fn a_loop_of_parents_ends() {
        let processes = vec![process(5, 6, "a.exe"), process(6, 5, "a.exe")];
        assert!(app_root(&processes, 5).is_some());
        assert!(!is_in_tree(&processes, 5, 7));
    }

    #[test]
    fn the_label_drops_the_extension() {
        assert_eq!(app_label("Telegram.exe"), "Telegram");
        assert_eq!(app_label("vlc"), "vlc");
    }
}
