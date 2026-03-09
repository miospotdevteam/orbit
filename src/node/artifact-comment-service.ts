import { CommentSidecar, CommentThread, Comment, ThreadStatus } from '../common/types';
import { createEmptyCommentSidecar } from '../common/schemas';
import { loadArtifactBundle, saveCommentSidecar, artifactPaths } from './artifact-file-service';

let idCounter = 0;

/** Generate a unique ID for threads and comments. */
function generateId(prefix: string): string {
    idCounter++;
    return `${prefix}_${Date.now()}_${idCounter}`;
}

/** Reset the ID counter (for testing). */
export function resetIdCounter(): void {
    idCounter = 0;
}

/**
 * Get or create the comment sidecar for a source file.
 * If no sidecar exists on disk, returns a fresh empty one.
 */
export async function getOrCreateCommentSidecar(sourcePath: string): Promise<CommentSidecar> {
    const bundle = await loadArtifactBundle(sourcePath);
    if (bundle.comments) {
        return bundle.comments;
    }
    const paths = artifactPaths(sourcePath);
    const artifactVersion = bundle.parsedArtifact?.metadata?.artifactVersion ?? 0;
    return createEmptyCommentSidecar(paths.resolved, sourcePath, artifactVersion);
}

/** Add a new comment thread to a block. */
export function addThread(
    sidecar: CommentSidecar,
    blockId: string,
    body: string,
    author: 'user' | 'agent' = 'user',
): CommentThread {
    const now = new Date().toISOString();
    const thread: CommentThread = {
        id: generateId('thread'),
        blockId,
        status: 'open',
        createdAt: now,
        updatedAt: now,
        comments: [
            {
                id: generateId('comment'),
                author,
                body,
                createdAt: now,
            },
        ],
    };
    sidecar.threads.push(thread);
    return thread;
}

/** Add a reply to an existing thread. */
export function addReply(
    sidecar: CommentSidecar,
    threadId: string,
    body: string,
    author: 'user' | 'agent' = 'user',
): Comment | null {
    const thread = sidecar.threads.find(t => t.id === threadId);
    if (!thread) return null;

    const now = new Date().toISOString();
    const comment: Comment = {
        id: generateId('comment'),
        author,
        body,
        createdAt: now,
    };
    thread.comments.push(comment);
    thread.updatedAt = now;
    return comment;
}

/** Update a thread's status. */
export function updateThreadStatus(
    sidecar: CommentSidecar,
    threadId: string,
    status: ThreadStatus,
): boolean {
    const thread = sidecar.threads.find(t => t.id === threadId);
    if (!thread) return false;
    thread.status = status;
    thread.updatedAt = new Date().toISOString();
    return true;
}

/** Get all threads for a specific block. */
export function getThreadsForBlock(sidecar: CommentSidecar, blockId: string): CommentThread[] {
    return sidecar.threads.filter(t => t.blockId === blockId);
}

/** Get all open threads. */
export function getOpenThreads(sidecar: CommentSidecar): CommentThread[] {
    return sidecar.threads.filter(t => t.status === 'open');
}

/**
 * Reattach threads after artifact regeneration.
 * Threads whose blockId still exists in the new block list are kept.
 * Threads whose blockId no longer exists are marked 'outdated'.
 */
export function reattachThreads(
    sidecar: CommentSidecar,
    newBlockIds: string[],
): { kept: number; outdated: number } {
    const blockIdSet = new Set(newBlockIds);
    let kept = 0;
    let outdated = 0;

    for (const thread of sidecar.threads) {
        if (blockIdSet.has(thread.blockId)) {
            kept++;
        } else {
            if (thread.status !== 'outdated') {
                thread.status = 'outdated';
                thread.updatedAt = new Date().toISOString();
            }
            outdated++;
        }
    }

    return { kept, outdated };
}

/** Persist the sidecar to disk. */
export async function persistCommentSidecar(sourcePath: string, sidecar: CommentSidecar): Promise<void> {
    await saveCommentSidecar(sourcePath, sidecar);
}
