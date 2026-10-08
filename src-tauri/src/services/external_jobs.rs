//! Bounded, in-memory lifecycle of external command invocations.
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tyco_activation_protocol::{Job, JobState, OutputMode, RunRequest};

const MAX_JOBS: usize = 128;
const MAX_ACTIVE: usize = 32;
const JOB_TIMEOUT: Duration = Duration::from_secs(300);
const MAX_OUTPUT: usize = 512 * 1024;

struct Entry {
    job: Job,
    request: RunRequest,
    created: Instant,
    selection: Option<u64>,
    command_snapshot: Option<serde_json::Value>,
    pending_completion: Option<Job>,
}

#[derive(Default)]
pub struct ExternalJobs {
    next: AtomicU64,
    entries: Mutex<BTreeMap<String, Entry>>,
}

impl ExternalJobs {
    pub fn create(
        &self,
        command_id: String,
        request: RunRequest,
        selection: Option<u64>,
    ) -> Result<Job, &'static str> {
        let mut entries = self
            .entries
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if entries
            .values()
            .filter(|entry| !entry.job.state.is_terminal())
            .count()
            >= MAX_ACTIVE
        {
            return Err("Too many active jobs");
        }
        while entries.len() >= MAX_JOBS {
            let oldest = entries
                .iter()
                .filter(|(_, entry)| entry.job.state.is_terminal())
                .min_by_key(|(_, entry)| entry.created)
                .map(|(id, _)| id.clone());
            if let Some(id) = oldest {
                entries.remove(&id);
            } else {
                return Err("Too many jobs");
            }
        }
        let id = format!(
            "job-{}-{}",
            std::process::id(),
            self.next.fetch_add(1, Ordering::Relaxed) + 1
        );
        let job = Job {
            id: id.clone(),
            command_id,
            state: JobState::Accepted,
            output: None,
            error: None,
            code: None,
        };
        entries.insert(
            id,
            Entry {
                job: job.clone(),
                request,
                created: Instant::now(),
                selection,
                command_snapshot: None,
                pending_completion: None,
            },
        );
        Ok(job)
    }

    pub fn remember_command(&self, id: &str, command: serde_json::Value) {
        if let Some(entry) = self
            .entries
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .get_mut(id)
        {
            entry.command_snapshot = Some(command);
        }
    }

    pub fn command_unchanged(&self, id: &str, command: Option<&serde_json::Value>) -> bool {
        self.entries
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .get(id)
            .is_some_and(|entry| entry.command_snapshot.as_ref() == command)
    }

    pub fn get(&self, id: &str) -> Option<Job> {
        self.entries
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .get(id)
            .map(|entry| entry.job.clone())
    }

    pub fn claim(&self, id: &str) -> Option<(String, RunRequest)> {
        let mut entries = self
            .entries
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let entry = entries.get_mut(id)?;
        if entry.job.state != JobState::Accepted {
            return None;
        }
        entry.job.state = JobState::Running;
        Some((entry.job.command_id.clone(), entry.request.clone()))
    }

    pub fn finish(
        &self,
        id: &str,
        state: JobState,
        output: Option<String>,
        error: Option<String>,
        code: Option<String>,
    ) -> Option<(Job, Option<u64>, OutputMode)> {
        let mut entries = self
            .entries
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let entry = entries.get_mut(id)?;
        if entry.job.state.is_terminal() || entry.pending_completion.is_some() {
            return None;
        }
        entry.job.state = state;
        if output
            .as_ref()
            .is_some_and(|output| output.len() > MAX_OUTPUT)
        {
            entry.job.state = JobState::Failed;
            entry.job.error = Some("Command output is too large".into());
            entry.job.code = Some("OutputTooLarge".into());
        } else {
            entry.job.output = output;
            entry.job.error = error;
            entry.job.code = code;
        }
        if serde_json::to_vec(&tyco_activation_protocol::Response::json(&entry.job))
            .map_or(true, |bytes| {
                bytes.len() >= tyco_activation_protocol::MAX_MESSAGE_BYTES
            })
        {
            entry.job.state = JobState::Failed;
            entry.job.output = None;
            entry.job.error = Some("Serialized command output is too large".into());
            entry.job.code = Some("OutputTooLarge".into());
        }
        let job = entry.job.clone();
        let selection = entry.selection.take();
        if selection.is_some() {
            entry.pending_completion = Some(job.clone());
            entry.job.state = JobState::Running;
        }
        let output_mode = entry.request.output;
        entry.request.text = None;
        entry.request.input = None;
        entry.command_snapshot = None;
        Some((job, selection, output_mode))
    }

    pub fn publish_selection(&self, id: &str, error: Option<String>) {
        let mut entries = self
            .entries
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if let Some(entry) = entries.get_mut(id) {
            if let Some(mut job) = entry.pending_completion.take() {
                if let Some(error) = error {
                    job.state = JobState::Failed;
                    job.code = Some("SelectionFailed".into());
                    job.error = Some(error);
                }
                entry.job = job;
            }
        }
    }

    pub fn selection_input(&self, id: &str) -> Option<String> {
        self.entries
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .get(id)
            .filter(|entry| entry.request.replace)
            .and_then(|entry| entry.request.text.clone())
    }

    pub fn replace_requested(&self, id: &str) -> bool {
        self.entries
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .get(id)
            .is_some_and(|entry| entry.request.replace)
    }

    pub fn expired(&self) -> Vec<String> {
        self.entries
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .iter()
            .filter(|(_, entry)| {
                !entry.job.state.is_terminal() && entry.created.elapsed() >= JOB_TIMEOUT
            })
            .map(|(id, _)| id.clone())
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn claim_and_completion_are_single_use() {
        let jobs = ExternalJobs::default();
        let job = jobs
            .create("test".into(), RunRequest::default(), None)
            .unwrap();
        assert!(jobs.claim(&job.id).is_some());
        assert!(jobs.claim(&job.id).is_none());
        jobs.finish(
            &job.id,
            JobState::Cancelled,
            None,
            Some("Cancelled".into()),
            Some("Cancelled".into()),
        )
        .unwrap();
        assert!(jobs
            .finish(
                &job.id,
                JobState::Succeeded,
                Some("late".into()),
                None,
                None
            )
            .is_none());
        assert_eq!(jobs.get(&job.id).unwrap().state, JobState::Cancelled);
    }
    #[test]
    fn active_jobs_are_bounded_and_terminal_jobs_are_evicted() {
        let jobs = ExternalJobs::default();
        for _ in 0..MAX_ACTIVE {
            jobs.create("test".into(), RunRequest::default(), None)
                .unwrap();
        }
        assert!(jobs
            .create("test".into(), RunRequest::default(), None)
            .is_err());
        let ids = jobs
            .entries
            .lock()
            .unwrap()
            .keys()
            .cloned()
            .collect::<Vec<_>>();
        for id in ids {
            jobs.finish(&id, JobState::Succeeded, None, None, None);
        }
        for _ in 0..MAX_JOBS {
            let job = jobs
                .create("test".into(), RunRequest::default(), None)
                .unwrap();
            jobs.finish(&job.id, JobState::Succeeded, None, None, None);
        }
        assert_eq!(jobs.entries.lock().unwrap().len(), MAX_JOBS);
    }
    #[test]
    fn selection_completion_is_not_visible_until_insertion_finishes() {
        let jobs = ExternalJobs::default();
        let job = jobs
            .create("test".into(), RunRequest::default(), Some(1))
            .unwrap();
        jobs.finish(
            &job.id,
            JobState::Succeeded,
            Some("result".into()),
            None,
            None,
        )
        .unwrap();
        assert_eq!(jobs.get(&job.id).unwrap().state, JobState::Running);
        assert!(jobs
            .finish(&job.id, JobState::Cancelled, None, None, None)
            .is_none());
        jobs.publish_selection(&job.id, Some("Focus changed".into()));
        assert_eq!(jobs.get(&job.id).unwrap().state, JobState::Failed);
        assert_eq!(jobs.get(&job.id).unwrap().output.as_deref(), Some("result"));
    }

    #[test]
    fn oversized_output_and_abandoned_jobs_have_bounded_lifetimes() {
        let jobs = ExternalJobs::default();
        let job = jobs
            .create("test".into(), RunRequest::default(), None)
            .unwrap();
        jobs.entries
            .lock()
            .unwrap()
            .get_mut(&job.id)
            .unwrap()
            .created = Instant::now() - JOB_TIMEOUT;
        assert_eq!(jobs.expired(), vec![job.id.clone()]);
        jobs.finish(
            &job.id,
            JobState::Succeeded,
            Some("x".repeat(MAX_OUTPUT + 1)),
            None,
            None,
        )
        .unwrap();
        assert_eq!(
            jobs.get(&job.id).unwrap().code.as_deref(),
            Some("OutputTooLarge")
        );
        assert!(jobs.expired().is_empty());
    }
    #[test]
    fn escaped_output_must_fit_the_wire_envelope() {
        let jobs = ExternalJobs::default();
        let job = jobs
            .create("test".into(), RunRequest::default(), None)
            .unwrap();
        jobs.finish(
            &job.id,
            JobState::Succeeded,
            Some("\0".repeat(MAX_OUTPUT / 2)),
            None,
            None,
        )
        .unwrap();
        assert_eq!(
            jobs.get(&job.id).unwrap().code.as_deref(),
            Some("OutputTooLarge")
        );
    }
}
