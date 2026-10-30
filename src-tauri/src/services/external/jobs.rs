//! Bounded, in-memory lifecycle of external command invocations.
use crate::locks::MutexExt;
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

use tyco_activation_protocol::{ErrorCode, Job, JobState, RunRequest};

const MAX_JOBS: usize = 128;
const MAX_ACTIVE_JOBS: usize = 32;
const JOB_TIMEOUT: Duration = Duration::from_secs(300);
const MAX_OUTPUT_BYTES: usize = 512 * 1024;

struct ExternalJobEntry {
    job: Job,
    request: RunRequest,
    created_at: Instant,
    selection_run_id: Option<u64>,
    command_snapshot: Option<serde_json::Value>,
    pending_completion: Option<Job>,
    /// The user allowed this call to use the selection, see `services::external::access`.
    is_selection_approved: bool,
}

#[derive(Default)]
pub struct ExternalJobs {
    next_job_sequence: AtomicU64,
    entries: Mutex<BTreeMap<String, ExternalJobEntry>>,
}

impl ExternalJobs {
    fn lock_entries(&self) -> MutexGuard<'_, BTreeMap<String, ExternalJobEntry>> {
        self.entries.locked()
    }

    pub fn create(
        &self,
        command_id: String,
        request: RunRequest,
        selection_run_id: Option<u64>,
    ) -> Result<Job, &'static str> {
        self.create_at(command_id, request, selection_run_id, Instant::now())
    }

    fn create_at(
        &self,
        command_id: String,
        request: RunRequest,
        selection_run_id: Option<u64>,
        now: Instant,
    ) -> Result<Job, &'static str> {
        let mut entries = self.lock_entries();
        if entries
            .values()
            .filter(|entry| !entry.job.state.is_terminal())
            .count()
            >= MAX_ACTIVE_JOBS
        {
            return Err("Too many active jobs");
        }
        while entries.len() >= MAX_JOBS {
            let oldest = entries
                .iter()
                .filter(|(_, entry)| entry.job.state.is_terminal())
                .min_by_key(|(_, entry)| entry.created_at)
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
            self.next_job_sequence.fetch_add(1, Ordering::Relaxed) + 1
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
            ExternalJobEntry {
                job: job.clone(),
                request,
                created_at: now,
                selection_run_id,
                command_snapshot: None,
                pending_completion: None,
                is_selection_approved: false,
            },
        );
        Ok(job)
    }

    pub fn remember_command(&self, id: &str, command: serde_json::Value) {
        if let Some(entry) = self.lock_entries().get_mut(id) {
            entry.command_snapshot = Some(command);
        }
    }

    pub fn is_command_unchanged(&self, id: &str, command: Option<&serde_json::Value>) -> bool {
        self.lock_entries()
            .get(id)
            .is_some_and(|entry| entry.command_snapshot.as_ref() == command)
    }

    pub fn approve_selection(&self, id: &str) {
        if let Some(entry) = self.lock_entries().get_mut(id) {
            entry.is_selection_approved = true;
        }
    }

    pub fn is_selection_approved(&self, id: &str) -> bool {
        self.lock_entries()
            .get(id)
            .is_some_and(|entry| entry.is_selection_approved)
    }

    /// The request of a job not claimed yet.
    pub fn accepted_request(&self, id: &str) -> Option<RunRequest> {
        self.lock_entries()
            .get(id)
            .filter(|entry| entry.job.state == JobState::Accepted)
            .map(|entry| entry.request.clone())
    }

    /// Newest submissions first; omit output so the list stays bounded on the wire.
    pub fn list(&self) -> Vec<Job> {
        let entries = self.lock_entries();
        let mut ordered = entries.values().collect::<Vec<_>>();
        ordered.sort_by_key(|entry| std::cmp::Reverse(entry.created_at));
        ordered
            .into_iter()
            .map(|entry| Job {
                output: None,
                error: None,
                code: None,
                id: entry.job.id.clone(),
                command_id: entry.job.command_id.clone(),
                state: entry.job.state.clone(),
            })
            .collect()
    }

    pub fn get(&self, id: &str) -> Option<Job> {
        self.lock_entries().get(id).map(|entry| entry.job.clone())
    }

    pub fn claim(&self, id: &str) -> Option<(String, RunRequest)> {
        let mut entries = self.lock_entries();
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
    ) -> Option<(Job, Option<u64>)> {
        let mut entries = self.lock_entries();
        let entry = entries.get_mut(id)?;
        if entry.job.state.is_terminal() || entry.pending_completion.is_some() {
            return None;
        }
        entry.job.state = state;
        if output
            .as_ref()
            .is_some_and(|output| output.len() > MAX_OUTPUT_BYTES)
        {
            entry.job.state = JobState::Failed;
            entry.job.error = Some("Command output is too large".into());
            entry.job.code = Some(ErrorCode::OutputTooLarge.into());
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
            entry.job.code = Some(ErrorCode::OutputTooLarge.into());
        }
        let job = entry.job.clone();
        let selection_run_id = entry.selection_run_id.take();
        if selection_run_id.is_some() {
            entry.pending_completion = Some(job.clone());
            entry.job.state = JobState::Running;
        }
        entry.request.text = None;
        entry.request.input = None;
        entry.command_snapshot = None;
        Some((job, selection_run_id))
    }

    pub fn complete_selection_replacement(&self, id: &str, error: Option<String>) {
        let mut entries = self.lock_entries();
        if let Some(entry) = entries.get_mut(id) {
            if let Some(mut job) = entry.pending_completion.take() {
                if let Some(error) = error {
                    job.state = JobState::Failed;
                    job.code = Some(ErrorCode::SelectionFailed.into());
                    job.error = Some(error);
                }
                entry.job = job;
            }
        }
    }

    pub fn selection_input(&self, id: &str) -> Option<String> {
        self.lock_entries()
            .get(id)
            .filter(|entry| entry.request.replace)
            .and_then(|entry| entry.request.text.clone())
    }

    pub fn is_selection_replacement_requested(&self, id: &str) -> bool {
        self.lock_entries()
            .get(id)
            .is_some_and(|entry| entry.request.replace)
    }

    pub fn expired_job_ids(&self) -> Vec<String> {
        self.expired_job_ids_at(Instant::now())
    }

    fn expired_job_ids_at(&self, now: Instant) -> Vec<String> {
        self.lock_entries()
            .iter()
            .filter(|(_, entry)| {
                !entry.job.state.is_terminal()
                    && now.saturating_duration_since(entry.created_at) >= JOB_TIMEOUT
            })
            .map(|(id, _)| id.clone())
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn lists_retained_jobs_newest_first_without_results() {
        let jobs = ExternalJobs::default();
        let now = Instant::now();
        let first = jobs
            .create_at("first".into(), RunRequest::default(), None, now)
            .unwrap();
        let second = jobs
            .create_at(
                "second".into(),
                RunRequest::default(),
                None,
                now + Duration::from_secs(1),
            )
            .unwrap();
        jobs.finish(
            &first.id,
            JobState::Succeeded,
            Some("result".into()),
            None,
            None,
        );
        let listed = jobs.list();
        assert_eq!(
            listed.iter().map(|job| job.id.as_str()).collect::<Vec<_>>(),
            vec![second.id.as_str(), first.id.as_str()]
        );
        assert!(listed.iter().all(|job| job.output.is_none()));
        assert_eq!(
            jobs.get(&first.id).unwrap().output.as_deref(),
            Some("result")
        );
    }

    #[test]
    fn a_selection_approval_holds_for_its_job_only() {
        let jobs = ExternalJobs::default();
        let first = jobs
            .create("test".into(), RunRequest::default(), None)
            .unwrap();
        let second = jobs
            .create("test".into(), RunRequest::default(), None)
            .unwrap();
        jobs.approve_selection(&first.id);
        assert!(jobs.is_selection_approved(&first.id));
        assert!(!jobs.is_selection_approved(&second.id));
        assert!(jobs.accepted_request(&first.id).is_some());
        jobs.claim(&first.id);
        // a claimed job is past the prompt and must not be handed off again
        assert!(jobs.accepted_request(&first.id).is_none());
    }

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
            Some(ErrorCode::Cancelled.into()),
            Some(ErrorCode::Cancelled.into()),
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
        for _ in 0..MAX_ACTIVE_JOBS {
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
        jobs.complete_selection_replacement(&job.id, Some("Focus changed".into()));
        assert_eq!(jobs.get(&job.id).unwrap().state, JobState::Failed);
        assert_eq!(jobs.get(&job.id).unwrap().output.as_deref(), Some("result"));
    }

    #[test]
    fn oversized_output_and_abandoned_jobs_have_bounded_lifetimes() {
        let jobs = ExternalJobs::default();
        let now = Instant::now();
        let job = jobs
            .create_at("test".into(), RunRequest::default(), None, now)
            .unwrap();
        assert!(jobs
            .expired_job_ids_at(now + JOB_TIMEOUT - Duration::from_nanos(1))
            .is_empty());
        assert_eq!(
            jobs.expired_job_ids_at(now + JOB_TIMEOUT),
            vec![job.id.clone()]
        );
        jobs.finish(
            &job.id,
            JobState::Succeeded,
            Some("x".repeat(MAX_OUTPUT_BYTES + 1)),
            None,
            None,
        )
        .unwrap();
        assert_eq!(
            jobs.get(&job.id).unwrap().code.as_deref(),
            Some("OutputTooLarge")
        );
        assert!(jobs.expired_job_ids_at(now + JOB_TIMEOUT).is_empty());
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
            Some("\0".repeat(MAX_OUTPUT_BYTES / 2)),
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
