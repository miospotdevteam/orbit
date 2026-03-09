import { CommentSidecar, ReviewMetadata } from './types';

/** Create a default empty comment sidecar. */
export function createEmptyCommentSidecar(
    artifactPath: string,
    sourcePath: string,
    artifactVersion: number,
): CommentSidecar {
    return {
        version: 1,
        artifactPath,
        sourcePath,
        artifactVersion,
        threads: [],
    };
}

/** Create default review metadata. */
export function createDefaultReviewMetadata(
    sourcePath: string,
    artifactPath: string,
    sourceHash: string,
    artifactHash: string,
    artifactVersion: number,
    generatorVersion: string,
    generatedAt: string,
): ReviewMetadata {
    return {
        version: 1,
        sourcePath,
        artifactPath,
        sourceHash,
        artifactHash,
        artifactVersion,
        reviewState: 'draft',
        generatorVersion,
        generatedAt,
        approvedAt: null,
    };
}

/** Validate that an object looks like a CommentSidecar. */
export function isCommentSidecar(obj: unknown): obj is CommentSidecar {
    if (typeof obj !== 'object' || obj === null) return false;
    const o = obj as Record<string, unknown>;
    return (
        o.version === 1 &&
        typeof o.artifactPath === 'string' &&
        typeof o.sourcePath === 'string' &&
        typeof o.artifactVersion === 'number' &&
        Array.isArray(o.threads)
    );
}

/** Validate that an object looks like ReviewMetadata. */
export function isReviewMetadata(obj: unknown): obj is ReviewMetadata {
    if (typeof obj !== 'object' || obj === null) return false;
    const o = obj as Record<string, unknown>;
    return (
        o.version === 1 &&
        typeof o.sourcePath === 'string' &&
        typeof o.artifactPath === 'string' &&
        typeof o.reviewState === 'string'
    );
}
