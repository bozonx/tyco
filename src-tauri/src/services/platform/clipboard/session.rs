//! One clipboard operation at a time, and the clipboard content it owes back.
//!
//! A capture and a paste move text through the clipboard and give the user's
//! content back afterwards: right away, a while later (the target reads the
//! clipboard when it handles the paste keys) or again if a late copy lands
//! over it. Each operation holds the session lock, so a capture never mixes
//! its copy keys and probe with a paste in progress. A new operation cancels
//! whatever an earlier one scheduled: a pending restore would otherwise put
//! back content over the new operation's text, and a snapshot taken while
//! the earlier result still waits in the clipboard would make that result,
//! not the user's content, come back in the end. The new operation adopts
//! the content an earlier one still owes instead.

use std::cell::RefCell;
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::Duration;

use crate::locks::MutexExt;

/// The target reads the clipboard when it handles the paste keys; restoring
/// earlier would make it paste the old content. Nothing tells when it has
/// read it, so the delay leaves room for slow targets: a remote desktop, a
/// busy Electron app or Office document. Pasting the result twice is
/// harmless; pasting the old content, which may be a password, is not.
const RESTORE_DELAY: Duration = Duration::from_millis(2500);
/// How long after a capture gave up a late copy is still expected.
const LATE_COPY_WINDOW: Duration = Duration::from_millis(1500);
const LATE_COPY_POLL_INTERVAL: Duration = Duration::from_millis(100);

/// The system effects the session needs, so that it can be tested without a
/// clipboard or threads.
pub(crate) trait ClipboardIo: Send + Sync + 'static {
    type Snapshot: Send + 'static;
    /// What tells whether the clipboard still holds a given content.
    type Mark: Clone + Send + 'static;
    fn snapshot(&self) -> Option<Self::Snapshot>;
    fn restore(&self, snapshot: &Self::Snapshot);
    /// The mark of the clipboard holding `inserted`, which Tyco just put there.
    fn mark_inserted(&self, inserted: &str) -> Self::Mark;
    /// The mark of what the clipboard holds now.
    fn mark_current(&self) -> Self::Mark;
    /// Whether the clipboard still holds `mark`; `None` when that cannot be
    /// read now.
    fn holds(&self, mark: &Self::Mark) -> Option<bool>;
    fn spawn(&self, task: Box<dyn FnOnce() + Send>);
    fn sleep(&self, duration: Duration);
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PendingKind {
    /// Put the snapshot back while the clipboard still holds the mark.
    Restore,
    /// Put the snapshot back once the clipboard no longer holds the mark.
    Guard,
}

struct Pending<I: ClipboardIo> {
    generation: u64,
    kind: PendingKind,
    snapshot: I::Snapshot,
    mark: I::Mark,
}

struct State<I: ClipboardIo> {
    /// Changes with every operation; scheduled work of an older one stops.
    generation: u64,
    pending: Option<Pending<I>>,
}

pub(crate) struct ClipboardSession<I: ClipboardIo> {
    io: I,
    operation: Mutex<()>,
    state: Mutex<State<I>>,
}

impl<I: ClipboardIo> ClipboardSession<I> {
    pub(crate) fn new(io: I) -> Self {
        Self {
            io,
            operation: Mutex::new(()),
            state: Mutex::new(State {
                generation: 0,
                pending: None,
            }),
        }
    }

    /// Waits for the operation in progress, then starts one. What an earlier
    /// operation scheduled stops; content it still owes the user is adopted
    /// while the clipboard holds what that operation left there.
    pub(crate) fn begin(&'static self) -> ClipboardOperation<I> {
        let lock = self.operation.locked();
        let pending = {
            let mut state = self.state.locked();
            state.generation += 1;
            state.pending.take()
        };
        let adopted = pending.and_then(|pending| {
            (pending.kind == PendingKind::Restore && self.io.holds(&pending.mark) == Some(true))
                .then_some((pending.snapshot, pending.mark))
        });
        ClipboardOperation {
            session: self,
            adopted: RefCell::new(adopted),
            _lock: lock,
        }
    }

    /// Records work for after the operation of `generation`; the caller holds
    /// the operation lock.
    fn schedule(&self, generation: u64, kind: PendingKind, snapshot: I::Snapshot, mark: I::Mark) {
        self.state.locked().pending = Some(Pending {
            generation,
            kind,
            snapshot,
            mark,
        });
    }

    fn current_generation(&self) -> u64 {
        self.state.locked().generation
    }

    /// Takes the pending work of `kind` scheduled by `generation`, if no
    /// later operation started since.
    fn take_pending(&self, generation: u64, kind: PendingKind) -> Option<Pending<I>> {
        let mut state = self.state.locked();
        let is_ours = state.generation == generation
            && state
                .pending
                .as_ref()
                .is_some_and(|pending| pending.generation == generation && pending.kind == kind);
        if is_ours {
            state.pending.take()
        } else {
            None
        }
    }

    fn pending_mark(&self, generation: u64, kind: PendingKind) -> Option<I::Mark> {
        let state = self.state.locked();
        if state.generation != generation {
            return None;
        }
        state
            .pending
            .as_ref()
            .filter(|pending| pending.generation == generation && pending.kind == kind)
            .map(|pending| pending.mark.clone())
    }

    /// The delayed restore of `generation`: the snapshot comes back unless
    /// the clipboard got something else meanwhile or a later operation took
    /// over.
    fn fire_restore(&self, generation: u64) {
        let _lock = self.operation.locked();
        let Some(pending) = self.take_pending(generation, PendingKind::Restore) else {
            return;
        };
        if self.io.holds(&pending.mark) == Some(true) {
            self.io.restore(&pending.snapshot);
        }
    }

    /// One check of the guard of `generation`; whether it is over.
    fn check_guard(&self, generation: u64) -> bool {
        let Some(mark) = self.pending_mark(generation, PendingKind::Guard) else {
            return true;
        };
        // read without the lock: an operation may run meanwhile
        if self.io.holds(&mark) != Some(false) {
            return false;
        }
        let _lock = self.operation.locked();
        if let Some(pending) = self.take_pending(generation, PendingKind::Guard) {
            log::debug!("A late copy replaced the restored clipboard; restoring it again");
            self.io.restore(&pending.snapshot);
        }
        true
    }

    fn end_guard(&self, generation: u64) {
        let _lock = self.operation.locked();
        self.take_pending(generation, PendingKind::Guard);
    }
}

/// The clipboard while an operation owns it; dropping it ends the operation.
pub(crate) struct ClipboardOperation<I: ClipboardIo + 'static> {
    session: &'static ClipboardSession<I>,
    adopted: RefCell<Option<(I::Snapshot, I::Mark)>>,
    _lock: MutexGuard<'static, ()>,
}

impl<I: ClipboardIo> ClipboardOperation<I> {
    /// The user's content: the one an earlier operation still owes, or what
    /// the clipboard holds now.
    pub(crate) fn snapshot(&self) -> Option<I::Snapshot> {
        match self.adopted.borrow_mut().take() {
            Some((snapshot, _)) => Some(snapshot),
            None => self.session.io.snapshot(),
        }
    }

    /// Forgets content an earlier operation still owes: the user replaced it.
    pub(crate) fn discard_owed(&self) {
        self.adopted.borrow_mut().take();
    }

    pub(crate) fn restore_now(&self, snapshot: &I::Snapshot) {
        self.session.io.restore(snapshot);
    }

    /// Puts `snapshot` back once the target has had time to paste
    /// `inserted`, unless the clipboard got something else meanwhile.
    pub(crate) fn restore_later(&self, snapshot: I::Snapshot, inserted: &str) {
        let mark = self.session.io.mark_inserted(inserted);
        self.schedule_restore(snapshot, mark);
    }

    fn schedule_restore(&self, snapshot: I::Snapshot, mark: I::Mark) {
        let session = self.session;
        let generation = session.current_generation();
        session.schedule(generation, PendingKind::Restore, snapshot, mark);
        session.io.spawn(Box::new(move || {
            session.io.sleep(RESTORE_DELAY);
            session.fire_restore(generation);
        }));
    }

    /// Puts `snapshot`, just restored, back again if an application copies
    /// over it soon after: one that copied too late for a capture would
    /// otherwise leave its copy in place of the user's content.
    pub(crate) fn guard_restored(&self, snapshot: I::Snapshot) {
        let session = self.session;
        let generation = session.current_generation();
        let mark = session.io.mark_current();
        session.schedule(generation, PendingKind::Guard, snapshot, mark);
        session.io.spawn(Box::new(move || {
            let polls = LATE_COPY_WINDOW.as_millis() / LATE_COPY_POLL_INTERVAL.as_millis();
            for _ in 0..polls {
                session.io.sleep(LATE_COPY_POLL_INTERVAL);
                if session.check_guard(generation) {
                    return;
                }
            }
            session.end_guard(generation);
        }));
    }
}

impl<I: ClipboardIo> Drop for ClipboardOperation<I> {
    /// Content adopted from an earlier operation and not used stays owed, as
    /// long as the clipboard holds what that operation left there.
    fn drop(&mut self) {
        let Some((snapshot, mark)) = self.adopted.borrow_mut().take() else {
            return;
        };
        let has_pending = self.session.state.locked().pending.is_some();
        if !has_pending {
            self.schedule_restore(snapshot, mark);
        }
    }
}

/// The real clipboard of this session.
pub(crate) struct SystemClipboardIo;

/// Windows numbers every change of the clipboard; elsewhere its text tells.
#[cfg(target_os = "windows")]
type SystemMark = u32;
#[cfg(not(target_os = "windows"))]
type SystemMark = Option<String>;

impl ClipboardIo for SystemClipboardIo {
    type Snapshot = super::ClipboardSnapshot;
    type Mark = SystemMark;

    fn snapshot(&self) -> Option<Self::Snapshot> {
        super::snapshot()
    }
    fn restore(&self, snapshot: &Self::Snapshot) {
        super::restore_now(snapshot);
    }
    #[cfg(target_os = "windows")]
    fn mark_inserted(&self, _inserted: &str) -> u32 {
        super::super::windows::clipboard::sequence_number()
    }
    #[cfg(not(target_os = "windows"))]
    fn mark_inserted(&self, inserted: &str) -> Option<String> {
        Some(inserted.to_owned())
    }
    #[cfg(target_os = "windows")]
    fn mark_current(&self) -> u32 {
        super::super::windows::clipboard::sequence_number()
    }
    #[cfg(not(target_os = "windows"))]
    fn mark_current(&self) -> Option<String> {
        super::read_text()
    }
    #[cfg(target_os = "windows")]
    fn holds(&self, mark: &u32) -> Option<bool> {
        Some(super::super::windows::clipboard::sequence_number() == *mark)
    }
    #[cfg(not(target_os = "windows"))]
    fn holds(&self, mark: &Option<String>) -> Option<bool> {
        text_holds(super::read_text(), mark)
    }
    fn spawn(&self, task: Box<dyn FnOnce() + Send>) {
        std::thread::spawn(task);
    }
    fn sleep(&self, duration: Duration) {
        std::thread::sleep(duration);
    }
}

/// A clipboard that holds no text where text was expected may just not have
/// answered: that tells nothing.
#[cfg_attr(target_os = "windows", allow(dead_code))]
fn text_holds(current: Option<String>, mark: &Option<String>) -> Option<bool> {
    match (current, mark) {
        (None, Some(_)) => None,
        (current, mark) => Some(current == *mark),
    }
}

pub(crate) type SystemClipboardOperation = ClipboardOperation<SystemClipboardIo>;

/// The clipboard session of this process.
pub(crate) fn session() -> &'static ClipboardSession<SystemClipboardIo> {
    static SESSION: OnceLock<ClipboardSession<SystemClipboardIo>> = OnceLock::new();
    SESSION.get_or_init(|| ClipboardSession::new(SystemClipboardIo))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    /// A clipboard holding one text; a snapshot is the text it held.
    #[derive(Default)]
    struct FakeIo {
        current: Mutex<Option<String>>,
        tasks: Mutex<Vec<Box<dyn FnOnce() + Send>>>,
        restores: Mutex<Vec<String>>,
    }

    impl FakeIo {
        fn set(&self, text: &str) {
            *self.current.locked() = Some(text.to_owned());
        }
        fn current(&self) -> Option<String> {
            self.current.locked().clone()
        }
    }

    impl ClipboardIo for Arc<FakeIo> {
        type Snapshot = String;
        type Mark = Option<String>;
        fn snapshot(&self) -> Option<String> {
            self.current()
        }
        fn restore(&self, snapshot: &String) {
            self.restores.locked().push(snapshot.clone());
            self.set(snapshot);
        }
        fn mark_inserted(&self, inserted: &str) -> Option<String> {
            Some(inserted.to_owned())
        }
        fn mark_current(&self) -> Option<String> {
            self.current()
        }
        fn holds(&self, mark: &Option<String>) -> Option<bool> {
            text_holds(self.current(), mark)
        }
        fn spawn(&self, task: Box<dyn FnOnce() + Send>) {
            self.tasks.locked().push(task);
        }
        fn sleep(&self, _duration: Duration) {}
    }

    fn new_session() -> (&'static ClipboardSession<Arc<FakeIo>>, Arc<FakeIo>) {
        let io = Arc::new(FakeIo::default());
        let session = Box::leak(Box::new(ClipboardSession::new(Arc::clone(&io))));
        (session, io)
    }

    fn run_tasks(io: &FakeIo) {
        let tasks: Vec<_> = std::mem::take(&mut *io.tasks.locked());
        for task in tasks {
            task();
        }
    }

    /// A paste: the result goes in, the user's content comes back later.
    fn paste(session: &'static ClipboardSession<Arc<FakeIo>>, io: &FakeIo, result: &str) {
        let operation = session.begin();
        let snapshot = operation.snapshot().unwrap();
        io.set(result);
        operation.restore_later(snapshot, result);
    }

    #[test]
    fn a_paste_gives_the_content_back_later() {
        let (session, io) = new_session();
        io.set("user content");
        paste(session, &io, "result");
        assert_eq!(io.current().as_deref(), Some("result"));
        run_tasks(&io);
        assert_eq!(io.current().as_deref(), Some("user content"));
    }

    #[test]
    fn a_user_copy_wins_over_a_pending_restore() {
        let (session, io) = new_session();
        io.set("user content");
        paste(session, &io, "result");
        io.set("copied by the user");
        run_tasks(&io);
        assert_eq!(io.current().as_deref(), Some("copied by the user"));
    }

    #[test]
    fn a_second_paste_before_the_restore_still_gives_the_first_content_back() {
        let (session, io) = new_session();
        io.set("user content");
        paste(session, &io, "first result");
        paste(session, &io, "second result");
        run_tasks(&io);
        assert_eq!(io.current().as_deref(), Some("user content"));
        assert_eq!(*io.restores.locked(), ["user content"]);
    }

    #[test]
    fn an_operation_that_uses_no_snapshot_keeps_the_content_owed() {
        let (session, io) = new_session();
        io.set("user content");
        paste(session, &io, "result");
        drop(session.begin());
        run_tasks(&io);
        assert_eq!(io.current().as_deref(), Some("user content"));
    }

    #[test]
    fn discarded_content_is_not_restored() {
        let (session, io) = new_session();
        io.set("user content");
        paste(session, &io, "result");
        let operation = session.begin();
        operation.discard_owed();
        drop(operation);
        run_tasks(&io);
        assert_eq!(io.current().as_deref(), Some("result"));
    }

    #[test]
    fn a_guard_restores_over_a_late_copy() {
        let (session, io) = new_session();
        io.set("user content");
        let operation = session.begin();
        let snapshot = operation.snapshot().unwrap();
        operation.guard_restored(snapshot);
        drop(operation);
        io.set("late copy");
        run_tasks(&io);
        assert_eq!(io.current().as_deref(), Some("user content"));
    }

    #[test]
    fn a_new_operation_stops_the_guard_of_an_earlier_one() {
        let (session, io) = new_session();
        io.set("user content");
        let operation = session.begin();
        let snapshot = operation.snapshot().unwrap();
        operation.guard_restored(snapshot);
        drop(operation);
        // the next capture writes its probe: no late copy to undo
        let next = session.begin();
        io.set("probe of the next capture");
        drop(next);
        run_tasks(&io);
        assert_eq!(io.current().as_deref(), Some("probe of the next capture"));
        assert!(io.restores.locked().is_empty());
    }
}
