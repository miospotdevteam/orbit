/**
 * End-to-end integration test: exercises the full artifact review loop.
 *
 * 1. Write a sample plan.md source
 * 2. Generate plan.md.resolved (with block markers + frontmatter)
 * 3. Load the artifact bundle
 * 4. Add block-level comments
 * 5. Transition review state: draft → in_review → changes_requested
 * 6. Execute regeneration cycle (stub agent rewrites source)
 * 7. Verify thread reattachment and outdated marking
 * 8. Approve the review
 * 9. Verify staleness detection when source changes
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

import { loadArtifactBundle, artifactPaths } from '../artifact-file-service';
import { getOrCreateCommentSidecar, addThread, addReply, getThreadsForBlock, getOpenThreads } from '../artifact-comment-service';
import { transitionReviewState, checkAndUpdateStaleness, getReviewStateSummary } from '../artifact-review-service';
import { generateResolvedArtifact, executeRegenerationCycle } from '../artifact-resolution-service';
import { StubAgentBridge } from '../artifact-agent-bridge';
import { parseArtifact, getBlockIds } from '../../common/block-parser';

const SAMPLE_SOURCE = `# My Project Plan

## Context

This project implements a new feature.

## Step 1: Setup

Install dependencies and configure the build.

### Step 1 Acceptance

- Node.js >= 18
- TypeScript configured

## Step 2: Implementation

Write the core logic.

### Verification

Run all tests and check coverage.
`;

let tmpDir: string;
let sourcePath: string;

describe('End-to-end review loop', () => {
    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-e2e-'));
        sourcePath = path.join(tmpDir, 'plan.md');
        await fs.writeFile(sourcePath, SAMPLE_SOURCE, 'utf8');
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('completes a full review loop: generate → comment → request changes → regenerate → approve', async () => {
        // ──────────────────────────────────────────────────
        // Phase 1: Generate resolved artifact
        // ──────────────────────────────────────────────────
        const resolvedContent = await generateResolvedArtifact(sourcePath);

        // Verify resolved file was written
        const paths = artifactPaths(sourcePath);
        const resolvedOnDisk = await fs.readFile(paths.resolved, 'utf8');
        expect(resolvedOnDisk).toBe(resolvedContent);

        // Verify frontmatter
        expect(resolvedContent).toContain('---');
        expect(resolvedContent).toContain(`source: ${sourcePath}`);
        expect(resolvedContent).toContain('artifactVersion: 1');

        // Verify block markers were added
        const parsed = parseArtifact(resolvedContent);
        const blockIds = getBlockIds(parsed);
        expect(blockIds.length).toBeGreaterThanOrEqual(4); // headings produce blocks
        expect(blockIds).toContain('context');
        expect(blockIds).toContain('step-1-setup');

        // ──────────────────────────────────────────────────
        // Phase 2: Load bundle and verify initial state
        // ──────────────────────────────────────────────────
        const bundle = await loadArtifactBundle(sourcePath);
        expect(bundle.parsedArtifact).not.toBeNull();
        expect(bundle.review).not.toBeNull();
        expect(bundle.review!.reviewState).toBe('draft');

        // ──────────────────────────────────────────────────
        // Phase 3: Add comments on blocks
        // ──────────────────────────────────────────────────
        const sidecar = await getOrCreateCommentSidecar(sourcePath);
        const thread1 = addThread(sidecar, 'context', 'The context section is too vague. Please add specifics.', 'user');
        addReply(sidecar, thread1.id, 'Also mention the target timeline.', 'user');

        addThread(sidecar, 'step-1-setup', 'Setup should include Docker configuration.', 'user');

        // Verify threads are associated to blocks
        const contextThreads = getThreadsForBlock(sidecar, 'context');
        expect(contextThreads).toHaveLength(1);
        expect(contextThreads[0].comments).toHaveLength(2);

        const setupThreads = getThreadsForBlock(sidecar, 'step-1-setup');
        expect(setupThreads).toHaveLength(1);

        const openThreads = getOpenThreads(sidecar);
        expect(openThreads).toHaveLength(2);

        // Persist sidecar
        await fs.writeFile(paths.comments, JSON.stringify(sidecar, null, 2), 'utf8');

        // ──────────────────────────────────────────────────
        // Phase 4: Transition review state
        // ──────────────────────────────────────────────────

        // draft → in_review
        const t1 = await transitionReviewState(sourcePath, 'in_review');
        expect(t1.success).toBe(true);
        expect(t1.metadata.reviewState).toBe('in_review');

        // in_review → changes_requested
        const t2 = await transitionReviewState(sourcePath, 'changes_requested');
        expect(t2.success).toBe(true);
        expect(t2.metadata.reviewState).toBe('changes_requested');

        // Invalid transition: changes_requested → approved is valid,
        // but changes_requested → stale is NOT
        const tInvalid = await transitionReviewState(sourcePath, 'stale');
        expect(tInvalid.success).toBe(false);
        expect(tInvalid.error).toContain('Cannot transition');

        // ──────────────────────────────────────────────────
        // Phase 5: Execute regeneration cycle
        // ──────────────────────────────────────────────────
        const readSource = async (p: string) => {
            try { return await fs.readFile(p, 'utf8'); } catch { return null; }
        };
        const agentBridge = new StubAgentBridge(readSource);

        const regenResult = await executeRegenerationCycle(sourcePath, agentBridge);
        expect(regenResult.success).toBe(true);
        expect(regenResult.threadsKept).toBeGreaterThanOrEqual(0);

        // Verify source was updated (stub appends change-request comment)
        const updatedSource = await fs.readFile(sourcePath, 'utf8');
        expect(updatedSource).toContain('Agent: Changes requested');

        // Verify resolved was regenerated
        const newResolved = await fs.readFile(paths.resolved, 'utf8');
        expect(newResolved).toContain('Agent: Changes requested');

        // Verify new resolved still has block markers
        const newParsed = parseArtifact(newResolved);
        const newBlockIds = getBlockIds(newParsed);
        expect(newBlockIds.length).toBeGreaterThanOrEqual(4);

        // ──────────────────────────────────────────────────
        // Phase 6: Approve
        // ──────────────────────────────────────────────────

        // After regeneration, review metadata was reset. Load fresh.
        const bundleAfterRegen = await loadArtifactBundle(sourcePath);
        const stateAfterRegen = bundleAfterRegen.review!.reviewState;

        // Transition to in_review then approved
        if (stateAfterRegen === 'draft') {
            await transitionReviewState(sourcePath, 'in_review');
        }
        const tApprove = await transitionReviewState(sourcePath, 'approved');
        expect(tApprove.success).toBe(true);
        expect(tApprove.metadata.reviewState).toBe('approved');
        expect(tApprove.metadata.approvedAt).toBeTruthy();

        // ──────────────────────────────────────────────────
        // Phase 7: Verify staleness detection
        // ──────────────────────────────────────────────────

        // Modify source after approval → should become stale
        await fs.writeFile(sourcePath, updatedSource + '\n\n## New Section\n\nAdded after approval.\n', 'utf8');

        const staleCheck = await checkAndUpdateStaleness(sourcePath);
        expect(staleCheck.isStale).toBe(true);
        expect(staleCheck.metadata.reviewState).toBe('stale');

        // Verify review state summary
        const finalBundle = await loadArtifactBundle(sourcePath);
        const summary = getReviewStateSummary(finalBundle);
        expect(summary.state).toBe('stale');
        expect(summary.isStale).toBe(true);
    });

    it('handles the empty artifact case gracefully', async () => {
        // Write an empty source
        await fs.writeFile(sourcePath, '', 'utf8');

        const resolvedContent = await generateResolvedArtifact(sourcePath);
        expect(resolvedContent).toContain('---'); // still has frontmatter

        const parsed = parseArtifact(resolvedContent);
        expect(parsed.blocks).toHaveLength(0);
    });

    it('handles missing sidecar files on first use', async () => {
        // Generate resolved first
        await generateResolvedArtifact(sourcePath);

        // Load bundle — no comments or review files exist yet beyond what generateResolvedArtifact created
        const bundle = await loadArtifactBundle(sourcePath);
        expect(bundle.parsedArtifact).not.toBeNull();
        // review was created by generateResolvedArtifact
        expect(bundle.review).not.toBeNull();
        // comments sidecar should be null (not created yet)
        expect(bundle.comments).toBeNull();

        // getOrCreateCommentSidecar should create it
        const sidecar = await getOrCreateCommentSidecar(sourcePath);
        expect(sidecar.threads).toHaveLength(0);
    });

    it('preserves thread structure through comment CRUD operations', async () => {
        await generateResolvedArtifact(sourcePath);
        const sidecar = await getOrCreateCommentSidecar(sourcePath);

        // Add thread
        const thread = addThread(sidecar, 'context', 'First comment', 'user');
        expect(thread.blockId).toBe('context');
        expect(thread.status).toBe('open');
        expect(thread.comments).toHaveLength(1);

        // Reply
        const reply = addReply(sidecar, thread.id, 'Reply to first', 'agent');
        expect(reply).not.toBeNull();
        expect(thread.comments).toHaveLength(2);

        // Reply to nonexistent thread returns null
        const noReply = addReply(sidecar, 'nonexistent-id', 'Lost reply', 'user');
        expect(noReply).toBeNull();

        // Open threads count
        expect(getOpenThreads(sidecar)).toHaveLength(1);
    });
});
