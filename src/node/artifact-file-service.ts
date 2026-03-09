import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { CommentSidecar, ParsedArtifact, ReviewMetadata } from '../common/types';
import { parseArtifact } from '../common/block-parser';
import { isCommentSidecar, isReviewMetadata } from '../common/schemas';

/** File path conventions for an artifact bundle. */
export function artifactPaths(sourcePath: string) {
    const dir = path.dirname(sourcePath);
    const base = path.basename(sourcePath);
    return {
        source: sourcePath,
        resolved: path.join(dir, `${base}.resolved`),
        comments: path.join(dir, `${base}.comments.json`),
        review: path.join(dir, `${base}.review.json`),
    };
}

/** Compute a deterministic SHA-256 hash of file content. */
export function computeHash(content: string): string {
    return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/** Read a file, returning null if it doesn't exist. */
async function readFileOrNull(filePath: string): Promise<string | null> {
    try {
        return await fs.readFile(filePath, 'utf8');
    } catch (e: unknown) {
        if (e instanceof Error && 'code' in e && (e as NodeJS.ErrnoException).code === 'ENOENT') {
            return null;
        }
        throw e;
    }
}

/** The full artifact bundle loaded from disk. */
export interface ArtifactBundle {
    sourcePath: string;
    sourceContent: string | null;
    sourceHash: string | null;
    resolvedContent: string | null;
    parsedArtifact: ParsedArtifact | null;
    comments: CommentSidecar | null;
    review: ReviewMetadata | null;
}

/** Load an artifact bundle from disk given the source file path. */
export async function loadArtifactBundle(sourcePath: string): Promise<ArtifactBundle> {
    const paths = artifactPaths(sourcePath);

    const [sourceContent, resolvedContent, commentsRaw, reviewRaw] = await Promise.all([
        readFileOrNull(paths.source),
        readFileOrNull(paths.resolved),
        readFileOrNull(paths.comments),
        readFileOrNull(paths.review),
    ]);

    const sourceHash = sourceContent !== null ? computeHash(sourceContent) : null;
    const parsedArtifact = resolvedContent !== null ? parseArtifact(resolvedContent) : null;

    let comments: CommentSidecar | null = null;
    if (commentsRaw !== null) {
        try {
            const parsed = JSON.parse(commentsRaw);
            if (isCommentSidecar(parsed)) {
                comments = parsed;
            }
        } catch {
            // Invalid JSON — treat as missing
        }
    }

    let review: ReviewMetadata | null = null;
    if (reviewRaw !== null) {
        try {
            const parsed = JSON.parse(reviewRaw);
            if (isReviewMetadata(parsed)) {
                review = parsed;
            }
        } catch {
            // Invalid JSON — treat as missing
        }
    }

    return {
        sourcePath,
        sourceContent,
        sourceHash,
        resolvedContent,
        parsedArtifact,
        comments,
        review,
    };
}

/** Save a comment sidecar to disk. */
export async function saveCommentSidecar(sourcePath: string, sidecar: CommentSidecar): Promise<void> {
    const paths = artifactPaths(sourcePath);
    await fs.writeFile(paths.comments, JSON.stringify(sidecar, null, 2), 'utf8');
}

/** Save review metadata to disk. */
export async function saveReviewMetadata(sourcePath: string, metadata: ReviewMetadata): Promise<void> {
    const paths = artifactPaths(sourcePath);
    await fs.writeFile(paths.review, JSON.stringify(metadata, null, 2), 'utf8');
}

/** Save a resolved artifact to disk. */
export async function saveResolvedArtifact(sourcePath: string, content: string): Promise<void> {
    const paths = artifactPaths(sourcePath);
    await fs.writeFile(paths.resolved, content, 'utf8');
}

/** Check if the resolved artifact is stale relative to the source. */
export function isArtifactStale(bundle: ArtifactBundle): boolean {
    if (!bundle.sourceHash || !bundle.review) return false;
    return bundle.sourceHash !== bundle.review.sourceHash;
}

