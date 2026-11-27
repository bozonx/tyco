//! Bounded, in-memory lifecycle of visible and quiet command runs.
use crate::locks::MutexExt;
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

use tyco_activation_protocol::{ErrorCode, Job, JobState, RunRequest};

const MAX_JOBS: usize = 128;
/// How long a job may wait before it starts: for the user to answer the
/// access prompt or to type the text in the command overlay.
const START_TIMEOUT: Duration = Duration::from_secs(300);
const MAX_OUTPUT_BYTES: usize = 512 * 1024;
/// How long a finished job may wait for its selection to be replaced
const REPLACEMENT_TIMEOUT: Duration = Duration::from_secs(60);

struct ExternalJobEntry {
    job: Job,
    /// The name the user gave the command, for the overlay and its toasts.
    command_name: String,
    /// Started inside Tyco (a hotkey, the action menu), not by a caller:
    /// the command needs no external grant.
    is_internal: bool,
    request: RunRequest,
    created_at: Instant,
    selection_run_id: Option<u64>,
    command_snapshot: Option<serde_json::Value>,
    pending_completion: Option<(Job, RunHistory)>,
    /// The user allowed this call to use the selection, see `services::external::access`.
    is_selection_approved: bool,
    /// How long the run may take once started, the limit of its command;
    /// `None` until the job is handed off.
    run_limit: Option<Duration>,
    claimed_at: Option<Instant>,
    started_at: Option<u64>,
    /// When the job finished and began to wait for its selection replacement
    pending_since: Option<Instant>,
}

/// Why no job was created.
#[derive(Debug, PartialEq, Eq)]
pub enum CreateJobError {
    /// Another command runs; carries its name.
    Busy { running_command_name: String },
    /// Every retained job is still running.
    Full,
}

impl CreateJobError {
    pub fn message(&self) -> String {
        match self {
            Self::Busy {
                running_command_name,
            } => format!("Another command is running: {running_command_name}"),
            Self::Full => "Too many jobs".into(),
        }
    }
}

/// What a new job is created for.
pub struct NewJob {
    pub command_id: String,
    pub command_name: String,
    pub request: RunRequest,
    pub is_internal: bool,
    pub command_snapshot: Option<serde_json::Value>,
}

pub struct RunHistory {
    pub input: Option<String>,
    pub command_name: String,
    pub is_internal: bool,
    pub quiet: bool,
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

    /// Reserves the requested slot until the run and any replacement finish.
    pub fn create(&self, new_job: NewJob) -> Result<Job, CreateJobError> {
        self.create_at(new_job, Instant::now())
    }

    fn create_at(&self, new_job: NewJob, now: Instant) -> Result<Job, CreateJobError> {
        let mut entries = self.lock_entries();
        if let Some(running) = entries.values().find(|entry| {
            !entry.job.state.is_terminal() && entry.request.quiet == new_job.request.quiet
        }) {
            return Err(CreateJobError::Busy {
                running_command_name: running.command_name.clone(),
            });
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
                return Err(CreateJobError::Full);
            }
        }
        // not guessable: another local client must not read or cancel the job
        // of a caller by counting
        let id = format!(
            "job-{}-{}",
            self.next_job_sequence.fetch_add(1, Ordering::Relaxed) + 1,
            crate::services::random_id::new_uuid()
        );
        let job = Job {
            id: id.clone(),
            command_id: new_job.command_id,
            state: JobState::Accepted,
            output: None,
            error: None,
            code: None,
        };
        entries.insert(
            id,
            ExternalJobEntry {
                job: job.clone(),
                command_name: new_job.command_name,
                is_internal: new_job.is_internal,
                request: new_job.request,
                created_at: now,
                selection_run_id: None,
                command_snapshot: new_job.command_snapshot,
                pending_completion: None,
                is_selection_approved: false,
                run_limit: None,
                claimed_at: None,
                started_at: None,
                pending_since: None,
            },
        );
        Ok(job)
    }

    /// Gives the job the selection captured for it, after the slot was taken.
    pub fn attach_selection(&self, id: &str, selection_run_id: u64, text: String) {
        if let Some(entry) = self.lock_entries().get_mut(id) {
            entry.selection_run_id = Some(selection_run_id);
            entry.request.text = Some(text);
        }
    }

    /// The job that holds the visible run slot, if any.
    pub fn active_id(&self) -> Option<String> {
        self.active_id_for(false)
    }

    pub fn active_id_for(&self, quiet: bool) -> Option<String> {
        self.lock_entries()
            .iter()
            .find(|(_, entry)| !entry.job.state.is_terminal() && entry.request.quiet == quiet)
            .map(|(id, _)| id.clone())
    }

    pub fn active_quiet_status(&self) -> Option<crate::events::QuietRunEvent> {
        self.lock_entries()
            .values()
            .find(|entry| entry.request.quiet && !entry.job.state.is_terminal())
            .map(|entry| crate::events::QuietRunEvent {
                job_id: entry.job.id.clone(),
                command_name: entry.command_name.clone(),
                state: entry.job.state.clone(),
                started_at: entry.started_at,
            })
    }

    pub fn started_at(&self, id: &str) -> Option<u64> {
        self.lock_entries()
            .get(id)
            .and_then(|entry| entry.started_at)
    }

    pub fn is_quiet(&self, id: &str) -> bool {
        self.lock_entries()
            .get(id)
            .is_some_and(|entry| entry.request.quiet)
    }

    /// The run is over and its output is replacing the selection: it can no
    /// longer be cancelled.
    pub fn is_replacing_selection(&self, id: &str) -> bool {
        self.lock_entries()
            .get(id)
            .is_some_and(|entry| entry.pending_completion.is_some())
    }

    pub fn is_internal(&self, id: &str) -> bool {
        self.lock_entries()
            .get(id)
            .is_some_and(|entry| entry.is_internal)
    }

    pub fn is_command_unchanged(&self, id: &str, command: Option<&serde_json::Value>) -> bool {
        self.lock_entries()
            .get(id)
            .is_some_and(|entry| entry.command_snapshot.as_ref() == command)
    }

    /// Limits the run of the job once it starts; `None` runs it unbounded.
    #[cfg(test)]
    pub fn set_run_limit(&self, id: &str, limit: Option<Duration>) {
        if let Some(entry) = self.lock_entries().get_mut(id) {
            entry.run_limit = limit;
        }
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
    #[cfg(test)]
    pub fn accepted_request(&self, id: &str) -> Option<RunRequest> {
        self.lock_entries()
            .get(id)
            .filter(|entry| entry.job.state == JobState::Accepted)
            .map(|entry| entry.request.clone())
    }

    pub fn get(&self, id: &str) -> Option<Job> {
        self.lock_entries().get(id).map(|entry| entry.job.clone())
    }

    /// Starts the job, limited to `run_limit` from now on.
    pub fn claim(&self, id: &str, run_limit: Option<Duration>) -> Option<(String, RunRequest)> {
        self.claim_at(id, run_limit, Instant::now())
    }

    fn claim_at(
        &self,
        id: &str,
        run_limit: Option<Duration>,
        now: Instant,
    ) -> Option<(String, RunRequest)> {
        let mut entries = self.lock_entries();
        let entry = entries.get_mut(id)?;
        if entry.job.state != JobState::Accepted {
            return None;
        }
        entry.job.state = JobState::Running;
        entry.claimed_at = Some(now);
        entry.started_at = Some(crate::services::clock::now_ms());
        entry.run_limit = run_limit;
        Some((entry.job.command_id.clone(), entry.request.clone()))
    }

    #[cfg(test)]
    pub fn finish(
        &self,
        id: &str,
        state: JobState,
        output: Option<String>,
        error: Option<String>,
        code: Option<String>,
    ) -> Option<(Job, Option<u64>)> {
        self.finish_at(id, state, output, error, code, Instant::now())
    }

    pub fn finish_with_history(
        &self,
        id: &str,
        state: JobState,
        output: Option<String>,
        error: Option<String>,
        code: Option<String>,
    ) -> Option<(Job, Option<u64>, Option<RunHistory>)> {
        self.finish_entry(id, state, output, error, code, Instant::now())
    }

    #[cfg(test)]
    fn finish_at(
        &self,
        id: &str,
        state: JobState,
        output: Option<String>,
        error: Option<String>,
        code: Option<String>,
        now: Instant,
    ) -> Option<(Job, Option<u64>)> {
        self.finish_entry(id, state, output, error, code, now)
            .map(|(job, selection, _)| (job, selection))
    }

    fn finish_entry(
        &self,
        id: &str,
        state: JobState,
        output: Option<String>,
        error: Option<String>,
        code: Option<String>,
        now: Instant,
    ) -> Option<(Job, Option<u64>, Option<RunHistory>)> {
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
            // the error of the run, if any, is not lost behind the size
            entry.job.error = Some(match error {
                Some(error) => format!("Command output is too large; {error}"),
                None => "Command output is too large".into(),
            });
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
        let history = RunHistory {
            input: entry.request.text.take().or_else(|| {
                entry
                    .request
                    .input
                    .take()
                    .map(|input| serde_json::Value::Object(input).to_string())
            }),
            command_name: entry.command_name.clone(),
            is_internal: entry.is_internal,
            quiet: entry.request.quiet,
        };
        entry.request.text = None;
        entry.request.input = None;
        entry.command_snapshot = None;
        let history = if selection_run_id.is_some() {
            entry.pending_completion = Some((job.clone(), history));
            entry.pending_since = Some(now);
            entry.job.state = JobState::Running;
            None
        } else {
            Some(history)
        };
        Some((job, selection_run_id, history))
    }

    pub fn complete_selection_replacement(
        &self,
        id: &str,
        error: Option<String>,
    ) -> Option<(Job, RunHistory)> {
        let mut entries = self.lock_entries();
        let entry = entries.get_mut(id)?;
        let (mut job, history) = entry.pending_completion.take()?;
        entry.pending_since = None;
        if let Some(error) = error {
            job.state = JobState::Failed;
            job.code = Some(ErrorCode::SelectionFailed.into());
            job.error = Some(error);
        }
        entry.job = job.clone();
        Some((job, history))
    }

    pub fn supply_input(&self, id: &str, text: String) {
        if let Some(entry) = self.lock_entries().get_mut(id) {
            if entry.job.state == JobState::Running
                && !entry.request.quiet
                && entry.request.input.is_none()
                && entry.request.text.is_none()
                && entry.pending_completion.is_none()
            {
                entry.request.text = Some(text);
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

    /// Jobs whose selection replacement has not finished in time: something
    /// failed on the way, and they must not stay running for good
    pub fn stale_replacement_ids(&self) -> Vec<String> {
        self.stale_replacement_ids_at(Instant::now())
    }

    fn stale_replacement_ids_at(&self, now: Instant) -> Vec<String> {
        self.lock_entries()
            .iter()
            .filter(|(_, entry)| {
                entry.pending_completion.is_some()
                    && entry.pending_since.is_some_and(|since| {
                        now.saturating_duration_since(since) >= REPLACEMENT_TIMEOUT
                    })
            })
            .map(|(id, _)| id.clone())
            .collect()
    }

    pub fn expired_job_ids(&self) -> Vec<String> {
        self.expired_job_ids_at(Instant::now())
    }

    /// Jobs that waited too long to start, and runs over their limit. A finished run that is replacing the selection is left alone.
    fn expired_job_ids_at(&self, now: Instant) -> Vec<String> {
        self.lock_entries()
            .iter()
            .filter(|(_, entry)| match (&entry.job.state, entry.claimed_at) {
                (JobState::Accepted, _) => {
                    now.saturating_duration_since(entry.created_at) >= START_TIMEOUT
                }
                (state, Some(claimed_at))
                    if !state.is_terminal() && entry.pending_completion.is_none() =>
                {
                    entry
                        .run_limit
                        .is_some_and(|limit| now.saturating_duration_since(claimed_at) >= limit)
                }
                _ => false,
            })
            .map(|(id, _)| id.clone())
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn new_job(name: &str) -> NewJob {
        NewJob {
            command_id: name.into(),
            command_name: name.into(),
            request: RunRequest::default(),
            is_internal: false,
            command_snapshot: None,
        }
    }

    fn succeed(jobs: &ExternalJobs, id: &str) {
        jobs.finish(id, JobState::Succeeded, None, None, None);
    }

    #[test]
    fn a_finished_job_keeps_its_output() {
        let jobs = ExternalJobs::default();
        let job = jobs.create(new_job("first")).unwrap();
        jobs.finish(
            &job.id,
            JobState::Succeeded,
            Some("result".into()),
            None,
            None,
        );
        assert_eq!(jobs.get(&job.id).unwrap().output.as_deref(), Some("result"));
    }

    #[test]
    fn one_job_runs_at_a_time() {
        let jobs = ExternalJobs::default();
        let first = jobs.create(new_job("Lamp")).unwrap();
        assert_eq!(jobs.active_id().as_deref(), Some(first.id.as_str()));
        assert_eq!(
            jobs.create(new_job("Fan")).unwrap_err(),
            CreateJobError::Busy {
                running_command_name: "Lamp".into()
            }
        );
        jobs.claim(&first.id, None).unwrap();
        assert!(jobs.create(new_job("Fan")).is_err());
        succeed(&jobs, &first.id);
        assert!(jobs.active_id().is_none());
        assert!(jobs.create(new_job("Fan")).is_ok());
    }

    #[test]
    fn quiet_and_visible_runs_reserve_independent_slots() {
        let jobs = ExternalJobs::default();
        let visible = jobs.create(new_job("visible")).unwrap();
        let mut quiet = new_job("quiet");
        quiet.request.quiet = true;
        let quiet = jobs.create(quiet).unwrap();
        assert_eq!(jobs.active_id().as_deref(), Some(visible.id.as_str()));
        assert_eq!(jobs.active_quiet_status().unwrap().job_id, quiet.id);
        let mut another = new_job("another");
        another.request.quiet = true;
        assert!(matches!(
            jobs.create(another),
            Err(CreateJobError::Busy { .. })
        ));
        succeed(&jobs, &visible.id);
        assert_eq!(jobs.active_id_for(true).as_deref(), Some(quiet.id.as_str()));
    }

    #[test]
    fn a_selection_approval_holds_for_its_job_only() {
        let jobs = ExternalJobs::default();
        let first = jobs.create(new_job("test")).unwrap();
        jobs.approve_selection(&first.id);
        assert!(jobs.is_selection_approved(&first.id));
        assert!(jobs.accepted_request(&first.id).is_some());
        jobs.claim(&first.id, None);
        // a claimed job is past the prompt and must not be handed off again
        assert!(jobs.accepted_request(&first.id).is_none());
        succeed(&jobs, &first.id);
        let second = jobs.create(new_job("test")).unwrap();
        assert!(!jobs.is_selection_approved(&second.id));
    }

    #[test]
    fn claim_and_completion_are_single_use() {
        let jobs = ExternalJobs::default();
        let job = jobs.create(new_job("test")).unwrap();
        assert!(jobs.claim(&job.id, None).is_some());
        assert!(jobs.claim(&job.id, None).is_none());
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
    fn terminal_jobs_are_evicted() {
        let jobs = ExternalJobs::default();
        for _ in 0..MAX_JOBS + 3 {
            let job = jobs.create(new_job("test")).unwrap();
            succeed(&jobs, &job.id);
        }
        assert_eq!(jobs.entries.lock().unwrap().len(), MAX_JOBS);
    }

    #[test]
    fn selection_completion_is_not_visible_until_insertion_finishes() {
        let jobs = ExternalJobs::default();
        let job = jobs.create(new_job("test")).unwrap();
        jobs.attach_selection(&job.id, 1, "source".into());
        jobs.finish(
            &job.id,
            JobState::Succeeded,
            Some("result".into()),
            None,
            None,
        )
        .unwrap();
        assert_eq!(jobs.get(&job.id).unwrap().state, JobState::Running);
        // the pending replacement still holds the slot
        assert!(jobs.create(new_job("next")).is_err());
        assert!(jobs
            .finish(&job.id, JobState::Cancelled, None, None, None)
            .is_none());
        jobs.complete_selection_replacement(&job.id, Some("Focus changed".into()));
        assert_eq!(jobs.get(&job.id).unwrap().state, JobState::Failed);
        assert_eq!(jobs.get(&job.id).unwrap().output.as_deref(), Some("result"));
        assert!(jobs.create(new_job("next")).is_ok());
    }

    #[test]
    fn oversized_output_and_abandoned_jobs_have_bounded_lifetimes() {
        let jobs = ExternalJobs::default();
        let now = Instant::now();
        let job = jobs.create_at(new_job("test"), now).unwrap();
        assert!(jobs
            .expired_job_ids_at(now + START_TIMEOUT - Duration::from_nanos(1))
            .is_empty());
        assert_eq!(
            jobs.expired_job_ids_at(now + START_TIMEOUT),
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
        assert!(jobs.expired_job_ids_at(now + START_TIMEOUT).is_empty());
    }

    #[test]
    fn a_run_is_limited_from_its_start() {
        let jobs = ExternalJobs::default();
        let now = Instant::now();
        let job = jobs.create_at(new_job("test"), now).unwrap();
        let limit = Duration::from_secs(120);
        // the wait before the start does not count towards the limit
        let started = now + Duration::from_secs(200);
        jobs.claim_at(&job.id, Some(limit), started).unwrap();
        assert!(jobs
            .expired_job_ids_at(started + limit - Duration::from_nanos(1))
            .is_empty());
        assert_eq!(
            jobs.expired_job_ids_at(started + limit),
            vec![job.id.clone()]
        );
    }

    #[test]
    fn an_unlimited_run_does_not_expire() {
        let jobs = ExternalJobs::default();
        let now = Instant::now();
        let job = jobs.create_at(new_job("test"), now).unwrap();
        jobs.set_run_limit(&job.id, None);
        jobs.claim_at(&job.id, None, now).unwrap();
        assert!(jobs
            .expired_job_ids_at(now + Duration::from_secs(3600))
            .is_empty());
    }

    #[test]
    fn escaped_output_must_fit_the_wire_envelope() {
        let jobs = ExternalJobs::default();
        let job = jobs.create(new_job("test")).unwrap();
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

    #[test]
    fn a_replacement_that_never_finishes_fails_the_job_in_time() {
        let jobs = ExternalJobs::default();
        let now = Instant::now();
        let job = jobs.create_at(new_job("cmd"), now).unwrap();
        jobs.attach_selection(&job.id, 7, "source".into());
        jobs.claim_at(&job.id, None, now);
        jobs.finish_at(
            &job.id,
            JobState::Succeeded,
            Some("x".into()),
            None,
            None,
            now,
        )
        .unwrap();
        assert!(jobs.stale_replacement_ids_at(now).is_empty());
        let stale = jobs.stale_replacement_ids_at(now + REPLACEMENT_TIMEOUT);
        assert_eq!(stale, vec![job.id.clone()]);
        jobs.complete_selection_replacement(&job.id, Some("timed out".into()));
        assert_eq!(jobs.get(&job.id).unwrap().state, JobState::Failed);
        assert!(jobs
            .stale_replacement_ids_at(now + REPLACEMENT_TIMEOUT)
            .is_empty());
    }

    #[test]
    fn job_ids_cannot_be_guessed_from_one_another() {
        let jobs = ExternalJobs::default();
        let first = jobs.create(new_job("a")).unwrap();
        succeed(&jobs, &first.id);
        let second = jobs.create(new_job("b")).unwrap();
        assert!(first.id.len() > 30);
        assert_ne!(
            first.id[first.id.len() - 12..],
            second.id[second.id.len() - 12..]
        );
    }
}
