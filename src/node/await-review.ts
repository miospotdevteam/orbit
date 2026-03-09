import { loadArtifactBundle } from './artifact-file-service';
import { ReviewState, CommentThread } from '../common/types';

export interface AwaitReviewOptions {
    /** How often to poll the review state file, in ms. Default: 2000 */
    pollIntervalMs?: number;
    /** Maximum time to wait before timing out, in ms. Default: 1800000 (30 min) */
    timeoutMs?: number;
}

export interface ReviewDecision {
    status: 'approved' | 'changes_requested' | 'timeout';
    /** Open comment threads (only present when status is 'changes_requested') */
    threads: CommentThread[];
}

const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

/** Terminal review states that end the polling loop. */
const DECISION_STATES: ReadonlySet<ReviewState> = new Set(['approved', 'changes_requested']);

/**
 * Poll the review state file until the user approves or requests changes.
 *
 * Expects the artifact to already be in 'in_review' state (caller is
 * responsible for generating the resolved artifact, opening it, and
 * transitioning to in_review before calling this).
 */
export async function awaitReviewDecision(
    sourcePath: string,
    options: AwaitReviewOptions = {},
): Promise<ReviewDecision> {
    const pollInterval = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
        const bundle = await loadArtifactBundle(sourcePath);
        const state = bundle.review?.reviewState ?? 'draft';

        if (DECISION_STATES.has(state)) {
            const threads = state === 'changes_requested'
                ? (bundle.comments?.threads.filter(t => t.status === 'open') ?? [])
                : [];

            return { status: state as 'approved' | 'changes_requested', threads };
        }

        await sleep(pollInterval);
    }

    return { status: 'timeout', threads: [] };
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
