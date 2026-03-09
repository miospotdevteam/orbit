import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

import { generateResolvedArtifact } from '../artifact-resolution-service';
import { transitionReviewState } from '../artifact-review-service';
import { awaitReviewDecision } from '../await-review';
import { addThread, getOrCreateCommentSidecar, persistCommentSidecar } from '../artifact-comment-service';

const SAMPLE_SOURCE = `# Test Plan

## Step 1: Setup

Do the setup.

## Step 2: Build

Build the thing.
`;

let tmpDir: string;
let sourcePath: string;

describe('awaitReviewDecision', () => {
    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-await-'));
        sourcePath = path.join(tmpDir, 'plan.md');
        await fs.writeFile(sourcePath, SAMPLE_SOURCE, 'utf8');
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('returns approved when review state transitions to approved', async () => {
        await generateResolvedArtifact(sourcePath);
        await transitionReviewState(sourcePath, 'in_review');

        // Simulate user clicking "Proceed" after a short delay
        setTimeout(async () => {
            await transitionReviewState(sourcePath, 'approved');
        }, 100);

        const decision = await awaitReviewDecision(sourcePath, {
            pollIntervalMs: 50,
            timeoutMs: 5000,
        });

        expect(decision.status).toBe('approved');
        expect(decision.threads).toHaveLength(0);
    });

    it('returns changes_requested with open threads when user requests changes', async () => {
        await generateResolvedArtifact(sourcePath);
        await transitionReviewState(sourcePath, 'in_review');

        // Simulate user adding a comment and clicking "Review"
        setTimeout(async () => {
            const sidecar = await getOrCreateCommentSidecar(sourcePath);
            addThread(sidecar, 'step-1-setup', 'Please add Docker config', 'user');
            await persistCommentSidecar(sourcePath, sidecar);
            await transitionReviewState(sourcePath, 'changes_requested');
        }, 100);

        const decision = await awaitReviewDecision(sourcePath, {
            pollIntervalMs: 50,
            timeoutMs: 5000,
        });

        expect(decision.status).toBe('changes_requested');
        expect(decision.threads).toHaveLength(1);
        expect(decision.threads[0].blockId).toBe('step-1-setup');
        expect(decision.threads[0].comments[0].body).toBe('Please add Docker config');
    });

    it('returns timeout when no decision is made within the timeout', async () => {
        await generateResolvedArtifact(sourcePath);
        await transitionReviewState(sourcePath, 'in_review');

        const decision = await awaitReviewDecision(sourcePath, {
            pollIntervalMs: 50,
            timeoutMs: 200,
        });

        expect(decision.status).toBe('timeout');
        expect(decision.threads).toHaveLength(0);
    });
});
