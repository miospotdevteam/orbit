import { describe, it, expect, beforeEach } from 'vitest';
import { CommentSidecar } from '../../common/types';
import { createEmptyCommentSidecar } from '../../common/schemas';
import {
    addThread,
    addReply,
    updateThreadStatus,
    getThreadsForBlock,
    getOpenThreads,
    reattachThreads,
    resetIdCounter,
} from '../artifact-comment-service';

let sidecar: CommentSidecar;

beforeEach(() => {
    resetIdCounter();
    sidecar = createEmptyCommentSidecar('plan.md.resolved', 'plan.md', 1);
});

describe('addThread', () => {
    it('adds a thread to the sidecar', () => {
        const thread = addThread(sidecar, 'step-1', 'Fix this step');

        expect(sidecar.threads).toHaveLength(1);
        expect(thread.blockId).toBe('step-1');
        expect(thread.status).toBe('open');
        expect(thread.comments).toHaveLength(1);
        expect(thread.comments[0].body).toBe('Fix this step');
        expect(thread.comments[0].author).toBe('user');
    });

    it('generates unique thread IDs', () => {
        const t1 = addThread(sidecar, 'step-1', 'First');
        const t2 = addThread(sidecar, 'step-2', 'Second');
        expect(t1.id).not.toBe(t2.id);
    });
});

describe('addReply', () => {
    it('adds a reply to an existing thread', () => {
        const thread = addThread(sidecar, 'step-1', 'Original');
        const reply = addReply(sidecar, thread.id, 'Agent response', 'agent');

        expect(reply).not.toBeNull();
        expect(reply!.author).toBe('agent');
        expect(thread.comments).toHaveLength(2);
    });

    it('returns null for unknown thread', () => {
        const reply = addReply(sidecar, 'nonexistent', 'Hello');
        expect(reply).toBeNull();
    });
});

describe('updateThreadStatus', () => {
    it('updates thread status', () => {
        const thread = addThread(sidecar, 'step-1', 'Fix');
        const result = updateThreadStatus(sidecar, thread.id, 'resolved');

        expect(result).toBe(true);
        expect(thread.status).toBe('resolved');
    });

    it('returns false for unknown thread', () => {
        expect(updateThreadStatus(sidecar, 'nonexistent', 'resolved')).toBe(false);
    });
});

describe('getThreadsForBlock', () => {
    it('returns threads for a specific block', () => {
        addThread(sidecar, 'step-1', 'Thread A');
        addThread(sidecar, 'step-2', 'Thread B');
        addThread(sidecar, 'step-1', 'Thread C');

        const step1Threads = getThreadsForBlock(sidecar, 'step-1');
        expect(step1Threads).toHaveLength(2);
    });

    it('returns empty array for block with no threads', () => {
        expect(getThreadsForBlock(sidecar, 'step-99')).toEqual([]);
    });
});

describe('getOpenThreads', () => {
    it('returns only open threads', () => {
        const t1 = addThread(sidecar, 'step-1', 'Open');
        addThread(sidecar, 'step-2', 'Also open');
        updateThreadStatus(sidecar, t1.id, 'resolved');

        const open = getOpenThreads(sidecar);
        expect(open).toHaveLength(1);
        expect(open[0].blockId).toBe('step-2');
    });
});

describe('reattachThreads', () => {
    it('keeps threads whose blocks still exist', () => {
        addThread(sidecar, 'step-1', 'Thread');
        addThread(sidecar, 'step-2', 'Thread');

        const result = reattachThreads(sidecar, ['step-1', 'step-2', 'step-3']);
        expect(result.kept).toBe(2);
        expect(result.outdated).toBe(0);
    });

    it('marks threads as outdated when blocks are removed', () => {
        addThread(sidecar, 'step-1', 'Thread');
        addThread(sidecar, 'step-2', 'Thread');
        addThread(sidecar, 'step-3', 'Thread');

        const result = reattachThreads(sidecar, ['step-1']); // step-2 and step-3 gone
        expect(result.kept).toBe(1);
        expect(result.outdated).toBe(2);

        const outdated = sidecar.threads.filter(t => t.status === 'outdated');
        expect(outdated).toHaveLength(2);
    });

    it('does not double-mark already outdated threads', () => {
        const thread = addThread(sidecar, 'step-1', 'Thread');
        updateThreadStatus(sidecar, thread.id, 'outdated');

        const result = reattachThreads(sidecar, []); // all blocks gone
        expect(result.outdated).toBe(1);
        expect(sidecar.threads[0].status).toBe('outdated');
    });
});
