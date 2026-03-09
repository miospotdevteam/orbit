import { ReviewMetadata, ReviewState } from '../common/types';
import { createDefaultReviewMetadata } from '../common/schemas';
import {
    loadArtifactBundle,
    saveReviewMetadata,
    computeHash,
    ArtifactBundle,
} from './artifact-file-service';

/** Valid state transitions for review. */
const VALID_TRANSITIONS: Record<ReviewState, ReviewState[]> = {
    draft: ['in_review'],
    in_review: ['changes_requested', 'approved'],
    changes_requested: ['in_review', 'approved'],
    approved: ['stale', 'in_review'],
    stale: ['in_review'],
};

/** Check if a state transition is valid. */
export function isValidTransition(from: ReviewState, to: ReviewState): boolean {
    return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Get or create review metadata for an artifact. */
export async function getOrCreateReviewMetadata(sourcePath: string): Promise<ReviewMetadata> {
    const bundle = await loadArtifactBundle(sourcePath);
    if (bundle.review) {
        return bundle.review;
    }

    const sourceHash = bundle.sourceHash ?? '';
    const artifactHash = bundle.resolvedContent ? computeHash(bundle.resolvedContent) : '';
    const artifactVersion = bundle.parsedArtifact?.metadata?.artifactVersion ?? 0;
    const generator = bundle.parsedArtifact?.metadata?.generator ?? '';
    const generatedAt = bundle.parsedArtifact?.metadata?.generatedAt ?? new Date().toISOString();

    return createDefaultReviewMetadata(
        sourcePath,
        sourcePath + '.resolved',
        sourceHash,
        artifactHash,
        artifactVersion,
        generator,
        generatedAt,
    );
}

/** Transition the review state and persist. */
export async function transitionReviewState(
    sourcePath: string,
    newState: ReviewState,
): Promise<{ success: boolean; metadata: ReviewMetadata; error?: string }> {
    const metadata = await getOrCreateReviewMetadata(sourcePath);
    const currentState = metadata.reviewState;

    if (!isValidTransition(currentState, newState)) {
        return {
            success: false,
            metadata,
            error: `Cannot transition from '${currentState}' to '${newState}'`,
        };
    }

    metadata.reviewState = newState;
    if (newState === 'approved') {
        metadata.approvedAt = new Date().toISOString();
    }

    await saveReviewMetadata(sourcePath, metadata);
    return { success: true, metadata };
}

/** Check staleness and auto-transition if needed. */
export async function checkAndUpdateStaleness(sourcePath: string): Promise<{
    isStale: boolean;
    metadata: ReviewMetadata;
}> {
    const bundle = await loadArtifactBundle(sourcePath);
    const metadata = bundle.review ?? await getOrCreateReviewMetadata(sourcePath);

    const currentSourceHash = bundle.sourceHash ?? '';
    const isStale = currentSourceHash !== '' && currentSourceHash !== metadata.sourceHash;

    if (isStale && metadata.reviewState !== 'stale' && metadata.reviewState !== 'draft') {
        metadata.reviewState = 'stale';
        await saveReviewMetadata(sourcePath, metadata);
    }

    return { isStale, metadata };
}

/** Get a human-readable summary of the review state. */
export function getReviewStateSummary(bundle: ArtifactBundle): {
    state: ReviewState;
    isStale: boolean;
    openThreadCount: number;
} {
    const state = bundle.review?.reviewState ?? 'draft';
    const isStale = bundle.sourceHash !== null &&
        bundle.review !== null &&
        bundle.sourceHash !== bundle.review.sourceHash;
    const openThreadCount = bundle.comments?.threads.filter(t => t.status === 'open').length ?? 0;

    return { state, isStale, openThreadCount };
}
