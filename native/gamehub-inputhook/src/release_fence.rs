//! Backend-neutral close/release fence for overlay input ownership.
//!
//! This module deliberately contains no backend calls and is not wired into
//! the production gate yet. A future coordinator can feed it one aggregate
//! observation after every covered backend has drained and sampled its
//! controls. The state is single-owner, fixed-size, allocation-free, and
//! lock-free; callers that collect observations on multiple threads must
//! serialize those observations before invoking it.

const REQUIRED_NEUTRAL_SAMPLES: u8 = 2;
const REQUIRED_NEUTRAL_MS: u64 = 50;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub(crate) enum ReleasePhase {
    Unarmed,
    Armed,
    Draining,
    Blocked,
    RestoreWait,
    Released,
    Invalidated,
    Fault,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct FenceIdentity {
    pub generation: u32,
    pub topology_epoch: u64,
}

impl FenceIdentity {
    pub(crate) const fn new(generation: u32, topology_epoch: u64) -> Self {
        Self {
            generation,
            topology_epoch,
        }
    }

    const fn is_valid(self) -> bool {
        self.generation != 0 && self.topology_epoch != 0
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum FenceEvent {
    Applied,
    IgnoredStale,
    Rejected,
    Released,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct FenceSnapshot {
    pub phase: ReleasePhase,
    pub identity: Option<FenceIdentity>,
    pub block_latched: bool,
    pub readiness_valid: bool,
    pub pending_buffers: u32,
    pub neutral_samples: u8,
    pub neutral_since_ms: Option<u64>,
}

/// A deterministic release fence owned by one input-coordination thread.
///
/// `block_latched` is intentionally independent from readiness and phase.
/// Invalidating a capability must never make a held close/Guide input leak to
/// the game. Only a completed restore fence, owner death, or target change can
/// clear an active latch.
pub(crate) struct ReleaseFence {
    phase: ReleasePhase,
    identity: Option<FenceIdentity>,
    block_latched: bool,
    readiness_valid: bool,
    pending_buffers: u32,
    neutral_samples: u8,
    neutral_since_ms: Option<u64>,
    last_observation_ms: Option<u64>,
}

impl Default for ReleaseFence {
    fn default() -> Self {
        Self::new()
    }
}

impl ReleaseFence {
    pub(crate) const fn new() -> Self {
        Self {
            phase: ReleasePhase::Unarmed,
            identity: None,
            block_latched: false,
            readiness_valid: false,
            pending_buffers: 0,
            neutral_samples: 0,
            neutral_since_ms: None,
            last_observation_ms: None,
        }
    }

    pub(crate) const fn snapshot(&self) -> FenceSnapshot {
        FenceSnapshot {
            phase: self.phase,
            identity: self.identity,
            block_latched: self.block_latched,
            readiness_valid: self.readiness_valid,
            pending_buffers: self.pending_buffers,
            neutral_samples: self.neutral_samples,
            neutral_since_ms: self.neutral_since_ms,
        }
    }

    pub(crate) const fn must_block(&self) -> bool {
        self.block_latched
    }

    pub(crate) fn is_ready(&self, identity: FenceIdentity) -> bool {
        self.identity == Some(identity) && self.readiness_valid
    }

    /// Arms one exact process generation and controller-topology epoch.
    ///
    /// Re-arming can never implicitly release an existing latch. The caller
    /// must first finish a restore fence or report owner/target loss.
    pub(crate) fn arm(&mut self, identity: FenceIdentity) -> FenceEvent {
        if !identity.is_valid() || self.block_latched {
            return FenceEvent::Rejected;
        }
        match (self.phase, self.identity) {
            (ReleasePhase::Unarmed, None) => {}
            (ReleasePhase::Released, Some(current)) if current == identity => {}
            _ => return FenceEvent::Rejected,
        }
        self.identity = Some(identity);
        self.phase = ReleasePhase::Armed;
        self.readiness_valid = true;
        self.pending_buffers = 0;
        self.reset_neutral_window();
        FenceEvent::Applied
    }

    /// Revalidates a previously armed identity after an explicit capability
    /// reprobe while the overlay is closed. This cannot change identity or
    /// release an active block latch.
    pub(crate) fn revalidate(&mut self, identity: FenceIdentity) -> FenceEvent {
        if !identity.is_valid()
            || self.block_latched
            || self.identity != Some(identity)
            || !matches!(self.phase, ReleasePhase::Invalidated | ReleasePhase::Fault)
        {
            return FenceEvent::Rejected;
        }
        self.phase = ReleasePhase::Armed;
        self.readiness_valid = true;
        self.pending_buffers = 0;
        self.reset_neutral_window();
        FenceEvent::Applied
    }

    /// Latches blocking before the overlay becomes interactive.
    pub(crate) fn begin_block(
        &mut self,
        identity: FenceIdentity,
        pending_buffers: u32,
    ) -> FenceEvent {
        if !self.matches(identity) {
            return FenceEvent::IgnoredStale;
        }
        if self.phase != ReleasePhase::Armed || !self.readiness_valid {
            return FenceEvent::Rejected;
        }

        // Set the safety latch before publishing a blocked/draining phase.
        self.block_latched = true;
        self.pending_buffers = pending_buffers;
        self.reset_neutral_window();
        self.phase = if pending_buffers == 0 {
            ReleasePhase::Blocked
        } else {
            ReleasePhase::Draining
        };
        FenceEvent::Applied
    }

    /// Starts a close without releasing input ownership.
    ///
    /// Repeated close requests are idempotent and do not restart an in-flight
    /// neutral dwell interval.
    pub(crate) fn request_close(&mut self, identity: FenceIdentity) -> FenceEvent {
        if !self.matches(identity) {
            return FenceEvent::IgnoredStale;
        }
        if !self.block_latched {
            return FenceEvent::Rejected;
        }
        if self.phase == ReleasePhase::RestoreWait {
            return FenceEvent::Applied;
        }
        match self.phase {
            ReleasePhase::Draining
            | ReleasePhase::Blocked
            | ReleasePhase::Invalidated
            | ReleasePhase::Fault => {
                self.phase = ReleasePhase::RestoreWait;
                self.reset_neutral_window();
                FenceEvent::Applied
            }
            _ => FenceEvent::Rejected,
        }
    }

    /// Consumes one aggregate backend observation.
    ///
    /// During restore, release requires zero pending buffered events, two
    /// neutral observations, and at least 50 ms between the first neutral
    /// observation and release. Backwards timestamps restart the dwell window
    /// instead of underflowing into an immediate release.
    pub(crate) fn observe(
        &mut self,
        identity: FenceIdentity,
        now_ms: u64,
        pending_buffers: u32,
        all_controls_neutral: bool,
    ) -> FenceEvent {
        if !self.matches(identity) {
            return FenceEvent::IgnoredStale;
        }

        self.pending_buffers = pending_buffers;
        match self.phase {
            ReleasePhase::Draining => {
                if pending_buffers == 0 {
                    self.phase = ReleasePhase::Blocked;
                }
                FenceEvent::Applied
            }
            ReleasePhase::Blocked => {
                if pending_buffers != 0 {
                    self.phase = ReleasePhase::Draining;
                }
                FenceEvent::Applied
            }
            ReleasePhase::RestoreWait => {
                self.observe_restore(now_ms, pending_buffers, all_controls_neutral, identity)
            }
            ReleasePhase::Invalidated | ReleasePhase::Fault => {
                if pending_buffers != 0 || !all_controls_neutral {
                    self.reset_neutral_window();
                }
                FenceEvent::Applied
            }
            _ => FenceEvent::Rejected,
        }
    }

    /// Invalidates the currently armed source set without changing topology.
    pub(crate) fn invalidate_source(&mut self, identity: FenceIdentity) -> FenceEvent {
        if !self.matches(identity) {
            return FenceEvent::IgnoredStale;
        }
        self.invalidate_readiness();
        FenceEvent::Applied
    }

    /// Advances to a newer topology epoch and invalidates readiness.
    ///
    /// An older/equal epoch or another generation is stale and cannot mutate
    /// the fence. Observations from the previous epoch are ignored after this
    /// transition because the stored identity changes atomically at this
    /// single-owner state-machine boundary.
    pub(crate) fn invalidate_topology(
        &mut self,
        generation: u32,
        topology_epoch: u64,
    ) -> FenceEvent {
        let Some(current) = self.identity else {
            return FenceEvent::IgnoredStale;
        };
        if generation != current.generation || topology_epoch <= current.topology_epoch {
            return FenceEvent::IgnoredStale;
        }

        self.identity = Some(FenceIdentity::new(generation, topology_epoch));
        self.invalidate_readiness();
        FenceEvent::Applied
    }

    pub(crate) fn fault(&mut self, identity: FenceIdentity) -> FenceEvent {
        if !self.matches(identity) {
            return FenceEvent::IgnoredStale;
        }
        self.readiness_valid = false;
        self.phase = ReleasePhase::Fault;
        self.reset_neutral_window();
        // Deliberately do not touch block_latched.
        FenceEvent::Applied
    }

    /// Owner death is an explicit fail-open terminal condition.
    pub(crate) fn owner_died(&mut self, identity: FenceIdentity) -> FenceEvent {
        if !self.matches_generation(identity.generation) {
            return FenceEvent::IgnoredStale;
        }
        self.fail_open(ReleasePhase::Released, false);
        FenceEvent::Released
    }

    /// Target replacement is fail-open for the old target and clears identity.
    pub(crate) fn target_changed(&mut self, identity: FenceIdentity) -> FenceEvent {
        if !self.matches_generation(identity.generation) {
            return FenceEvent::IgnoredStale;
        }
        self.fail_open(ReleasePhase::Unarmed, true);
        FenceEvent::Released
    }

    fn observe_restore(
        &mut self,
        now_ms: u64,
        pending_buffers: u32,
        all_controls_neutral: bool,
        identity: FenceIdentity,
    ) -> FenceEvent {
        if pending_buffers != 0 || !all_controls_neutral {
            self.reset_neutral_window();
            self.last_observation_ms = Some(now_ms);
            return FenceEvent::Applied;
        }

        if self.last_observation_ms.is_some_and(|last| now_ms < last) {
            self.reset_neutral_window();
        }
        self.last_observation_ms = Some(now_ms);

        let Some(neutral_since_ms) = self.neutral_since_ms else {
            self.neutral_since_ms = Some(now_ms);
            self.neutral_samples = 1;
            return FenceEvent::Applied;
        };

        self.neutral_samples = self.neutral_samples.saturating_add(1);
        let dwell_complete = now_ms.saturating_sub(neutral_since_ms) >= REQUIRED_NEUTRAL_MS;
        if self.neutral_samples < REQUIRED_NEUTRAL_SAMPLES || !dwell_complete {
            return FenceEvent::Applied;
        }

        // The identity check is intentionally repeated at the commit point.
        // It is redundant for an `&mut self` call today, but documents the
        // generation/topology invariant for a future atomic coordinator.
        if !self.matches(identity) || self.pending_buffers != 0 {
            return FenceEvent::IgnoredStale;
        }

        self.readiness_valid = false;
        self.phase = ReleasePhase::Released;
        // Clear the latch last: any intermediate observer remains fail-closed.
        self.block_latched = false;
        FenceEvent::Released
    }

    fn invalidate_readiness(&mut self) {
        self.readiness_valid = false;
        self.reset_neutral_window();
        // A topology/source event during an already requested close restarts
        // neutral dwell but does not strand the close in Invalidated.
        if self.phase != ReleasePhase::RestoreWait {
            self.phase = ReleasePhase::Invalidated;
        }
        // Deliberately do not touch block_latched.
    }

    fn fail_open(&mut self, phase: ReleasePhase, clear_identity: bool) {
        self.readiness_valid = false;
        self.pending_buffers = 0;
        self.reset_neutral_window();
        self.phase = phase;
        if clear_identity {
            self.identity = None;
        }
        self.block_latched = false;
    }

    fn reset_neutral_window(&mut self) {
        self.neutral_samples = 0;
        self.neutral_since_ms = None;
        self.last_observation_ms = None;
    }

    fn matches(&self, identity: FenceIdentity) -> bool {
        self.identity == Some(identity)
    }

    fn matches_generation(&self, generation: u32) -> bool {
        generation != 0
            && self
                .identity
                .is_some_and(|current| current.generation == generation)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: FenceIdentity = FenceIdentity::new(7, 11);

    fn blocked_fence(pending_buffers: u32) -> ReleaseFence {
        let mut fence = ReleaseFence::new();
        assert_eq!(fence.arm(ID), FenceEvent::Applied);
        assert_eq!(fence.begin_block(ID, pending_buffers), FenceEvent::Applied);
        fence
    }

    #[test]
    fn close_requires_drain_two_neutral_samples_and_fifty_ms() {
        let mut fence = blocked_fence(3);
        assert_eq!(fence.snapshot().phase, ReleasePhase::Draining);
        assert!(fence.must_block());

        assert_eq!(fence.observe(ID, 10, 0, true), FenceEvent::Applied);
        assert_eq!(fence.snapshot().phase, ReleasePhase::Blocked);
        assert_eq!(fence.request_close(ID), FenceEvent::Applied);
        assert_eq!(fence.snapshot().phase, ReleasePhase::RestoreWait);

        assert_eq!(fence.observe(ID, 100, 0, true), FenceEvent::Applied);
        assert_eq!(fence.observe(ID, 149, 0, true), FenceEvent::Applied);
        assert!(fence.must_block());
        assert_eq!(fence.observe(ID, 150, 0, true), FenceEvent::Released);
        assert_eq!(fence.snapshot().phase, ReleasePhase::Released);
        assert!(!fence.must_block());
    }

    #[test]
    fn pending_or_non_neutral_observation_restarts_dwell() {
        let mut fence = blocked_fence(0);
        assert_eq!(fence.request_close(ID), FenceEvent::Applied);
        assert_eq!(fence.observe(ID, 0, 0, true), FenceEvent::Applied);
        assert_eq!(fence.observe(ID, 60, 1, true), FenceEvent::Applied);
        assert_eq!(fence.observe(ID, 120, 0, true), FenceEvent::Applied);
        assert_eq!(fence.observe(ID, 180, 0, false), FenceEvent::Applied);
        assert_eq!(fence.observe(ID, 240, 0, true), FenceEvent::Applied);
        assert_eq!(fence.observe(ID, 289, 0, true), FenceEvent::Applied);
        assert!(fence.must_block());
        assert_eq!(fence.observe(ID, 290, 0, true), FenceEvent::Released);
    }

    #[test]
    fn repeated_close_does_not_restart_neutral_window() {
        let mut fence = blocked_fence(0);
        assert_eq!(fence.request_close(ID), FenceEvent::Applied);
        assert_eq!(fence.observe(ID, 100, 0, true), FenceEvent::Applied);
        assert_eq!(fence.request_close(ID), FenceEvent::Applied);
        assert_eq!(fence.observe(ID, 150, 0, true), FenceEvent::Released);
    }

    #[test]
    fn backwards_time_restarts_neutral_window() {
        let mut fence = blocked_fence(0);
        assert_eq!(fence.request_close(ID), FenceEvent::Applied);
        assert_eq!(fence.observe(ID, 100, 0, true), FenceEvent::Applied);
        assert_eq!(fence.observe(ID, 90, 0, true), FenceEvent::Applied);
        assert_eq!(fence.observe(ID, 139, 0, true), FenceEvent::Applied);
        assert!(fence.must_block());
        assert_eq!(fence.observe(ID, 140, 0, true), FenceEvent::Released);
    }

    #[test]
    fn hotplug_invalidates_readiness_without_unlatching() {
        let mut fence = blocked_fence(0);
        assert!(fence.is_ready(ID));
        assert_eq!(fence.invalidate_topology(7, 12), FenceEvent::Applied);
        let next = FenceIdentity::new(7, 12);

        assert_eq!(fence.snapshot().phase, ReleasePhase::Invalidated);
        assert!(!fence.is_ready(next));
        assert!(fence.must_block());
        assert_eq!(fence.observe(ID, 0, 0, true), FenceEvent::IgnoredStale);
        assert_eq!(fence.request_close(ID), FenceEvent::IgnoredStale);
        assert_eq!(fence.request_close(next), FenceEvent::Applied);
        assert_eq!(fence.observe(next, 0, 0, true), FenceEvent::Applied);
        assert_eq!(fence.observe(next, 50, 0, true), FenceEvent::Released);
    }

    #[test]
    fn invalidation_during_restore_resets_dwell_and_keeps_restore_phase() {
        let mut fence = blocked_fence(0);
        assert_eq!(fence.request_close(ID), FenceEvent::Applied);
        assert_eq!(fence.observe(ID, 0, 0, true), FenceEvent::Applied);
        assert_eq!(fence.invalidate_topology(7, 12), FenceEvent::Applied);
        let next = FenceIdentity::new(7, 12);

        assert_eq!(fence.snapshot().phase, ReleasePhase::RestoreWait);
        assert!(fence.must_block());
        assert_eq!(fence.observe(next, 50, 0, true), FenceEvent::Applied);
        assert_eq!(fence.observe(next, 99, 0, true), FenceEvent::Applied);
        assert!(fence.must_block());
        assert_eq!(fence.observe(next, 100, 0, true), FenceEvent::Released);
    }

    #[test]
    fn new_source_and_fault_have_explicit_fail_closed_phases() {
        let mut source = blocked_fence(0);
        assert_eq!(source.invalidate_source(ID), FenceEvent::Applied);
        assert_eq!(source.snapshot().phase, ReleasePhase::Invalidated);
        assert!(source.must_block());

        let mut fault = blocked_fence(0);
        assert_eq!(fault.fault(ID), FenceEvent::Applied);
        assert_eq!(fault.snapshot().phase, ReleasePhase::Fault);
        assert!(fault.must_block());
    }

    #[test]
    fn unblocked_capability_reprobe_revalidates_only_the_current_identity() {
        let mut fence = ReleaseFence::new();
        assert_eq!(fence.arm(ID), FenceEvent::Applied);
        assert_eq!(fence.invalidate_topology(7, 12), FenceEvent::Applied);
        let current = FenceIdentity::new(7, 12);

        assert_eq!(fence.revalidate(ID), FenceEvent::Rejected);
        assert_eq!(
            fence.revalidate(FenceIdentity::new(8, 12)),
            FenceEvent::Rejected
        );
        assert_eq!(fence.revalidate(current), FenceEvent::Applied);
        assert!(fence.is_ready(current));
        assert_eq!(fence.snapshot().phase, ReleasePhase::Armed);
    }

    #[test]
    fn owner_death_and_target_change_are_generation_scoped_fail_open_events() {
        let stale = FenceIdentity::new(ID.generation - 1, ID.topology_epoch);

        let mut owner = blocked_fence(0);
        assert_eq!(owner.owner_died(stale), FenceEvent::IgnoredStale);
        assert!(owner.must_block());
        assert_eq!(owner.owner_died(ID), FenceEvent::Released);
        assert_eq!(owner.snapshot().phase, ReleasePhase::Released);
        assert!(!owner.must_block());

        let mut target = blocked_fence(0);
        assert_eq!(target.target_changed(stale), FenceEvent::IgnoredStale);
        assert!(target.must_block());
        assert_eq!(target.target_changed(ID), FenceEvent::Released);
        assert_eq!(target.snapshot().phase, ReleasePhase::Unarmed);
        assert_eq!(target.snapshot().identity, None);
        assert!(!target.must_block());
    }

    #[test]
    fn terminal_cleanup_accepts_prior_topology_epoch_for_current_generation() {
        let next = FenceIdentity::new(ID.generation, ID.topology_epoch + 1);

        let mut owner = blocked_fence(0);
        assert_eq!(
            owner.invalidate_topology(next.generation, next.topology_epoch),
            FenceEvent::Applied
        );
        assert_eq!(owner.owner_died(ID), FenceEvent::Released);
        assert!(!owner.must_block());

        let mut target = blocked_fence(0);
        assert_eq!(
            target.invalidate_topology(next.generation, next.topology_epoch),
            FenceEvent::Applied
        );
        assert_eq!(target.target_changed(ID), FenceEvent::Released);
        assert_eq!(target.snapshot().identity, None);
        assert!(!target.must_block());
    }

    #[test]
    fn stale_events_cannot_mutate_a_new_generation() {
        let mut fence = blocked_fence(0);
        assert_eq!(fence.target_changed(ID), FenceEvent::Released);
        let current = FenceIdentity::new(8, 1);
        assert_eq!(fence.arm(current), FenceEvent::Applied);
        assert_eq!(fence.begin_block(current, 0), FenceEvent::Applied);
        let before = fence.snapshot();

        for tick in 0..100_000u64 {
            assert_eq!(fence.observe(ID, tick, 0, true), FenceEvent::IgnoredStale);
            assert_eq!(fence.request_close(ID), FenceEvent::IgnoredStale);
            assert_eq!(fence.invalidate_source(ID), FenceEvent::IgnoredStale);
            assert_eq!(fence.fault(ID), FenceEvent::IgnoredStale);
            assert_eq!(fence.owner_died(ID), FenceEvent::IgnoredStale);
            assert_eq!(fence.target_changed(ID), FenceEvent::IgnoredStale);
        }

        assert_eq!(fence.snapshot(), before);
        assert!(fence.must_block());
    }

    #[test]
    fn topology_churn_never_implicitly_releases() {
        let mut fence = blocked_fence(0);
        let mut epoch = ID.topology_epoch;
        for _ in 0..100_000 {
            epoch += 1;
            assert_eq!(
                fence.invalidate_topology(ID.generation, epoch),
                FenceEvent::Applied
            );
            assert!(fence.must_block());
            assert_eq!(fence.snapshot().phase, ReleasePhase::Invalidated);
            assert_eq!(
                fence.invalidate_topology(ID.generation, epoch - 1),
                FenceEvent::IgnoredStale
            );
            assert!(fence.must_block());
        }
    }

    #[test]
    fn invalid_identity_and_implicit_rearm_are_rejected() {
        let mut fence = ReleaseFence::new();
        assert_eq!(fence.arm(FenceIdentity::new(0, 1)), FenceEvent::Rejected);
        assert_eq!(fence.arm(FenceIdentity::new(1, 0)), FenceEvent::Rejected);
        assert_eq!(fence.arm(ID), FenceEvent::Applied);
        assert_eq!(fence.arm(ID), FenceEvent::Rejected);
        assert_eq!(fence.arm(FenceIdentity::new(8, 1)), FenceEvent::Rejected);
        assert_eq!(fence.begin_block(ID, 0), FenceEvent::Applied);
        assert_eq!(fence.arm(FenceIdentity::new(8, 1)), FenceEvent::Rejected);
        assert!(fence.must_block());
    }
}
