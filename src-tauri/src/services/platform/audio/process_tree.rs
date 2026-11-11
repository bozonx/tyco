//! Which processes make up an application: a browser plays its sound from
//! a child process, so an application is recorded from the root of its tree.
#![cfg_attr(not(target_os = "windows"), allow(dead_code))]

/// A running process, as a process snapshot lists it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ProcessEntry {
    pub pid: u32,
    pub parent_pid: u32,
    /// The full executable path on Windows; empty when access is denied.
    pub exe_name: String,
}

/// The id of the application a process belongs to: the executable name of
/// the root of its tree, see `AudioAppId`.
pub(crate) fn app_root(processes: &[ProcessEntry], pid: u32) -> Option<&ProcessEntry> {
    let mut current = processes.iter().find(|process| process.pid == pid)?;
    if current.exe_name.is_empty() {
        return None;
    }
    // Executables in the same installation directory share an application: walk up to
    // the topmost one, guarding against a loop of reused ids
    for _ in 0..processes.len() {
        let parent = processes.iter().find(|process| {
            process.pid == current.parent_pid
                && process.pid != current.pid
                && same_application(&process.exe_name, &current.exe_name)
        });
        match parent {
            Some(parent) => current = parent,
            None => break,
        }
    }
    Some(current)
}

fn same_application(left: &str, right: &str) -> bool {
    if left.is_empty() || right.is_empty() {
        return false;
    }
    if left.eq_ignore_ascii_case(right) {
        return true;
    }
    let directory = |path: &str| {
        path.rsplit_once('\\')
            .map(|(directory, _)| directory.to_ascii_lowercase())
    };
    matches!((directory(left), directory(right)), (Some(left), Some(right)) if left == right && !left.ends_with("\\windows\\system32"))
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
    let exe_name = exe_name.rsplit(['\\', '/']).next().unwrap_or(exe_name);
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
    fn full_paths_isolate_installations_and_group_helpers() {
        let processes = vec![
            process(10, 0, r"C:\Apps\One\app.exe"),
            process(11, 10, r"C:\Apps\One\helper.exe"),
            process(12, 11, r"C:\Apps\One\app.exe"),
            process(20, 0, r"C:\Apps\Two\app.exe"),
        ];
        assert_eq!(app_root(&processes, 11).unwrap().pid, 10);
        assert_eq!(app_roots(&processes, r"C:\Apps\One\app.exe"), vec![10]);
        assert_eq!(app_label(r"C:\Apps\One\app.exe"), "app");
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
