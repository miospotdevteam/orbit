import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
    artifactPaths,
    computeHash,
    loadArtifactBundle,
    saveCommentSidecar,
    saveReviewMetadata,
    saveResolvedArtifact,
    isArtifactStale,
} from '../artifact-file-service';
import { CommentSidecar, ReviewMetadata } from '../../common/types';

let tmpDir: string;

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-test-'));
});

afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('artifactPaths', () => {
    it('derives all paths from source path', () => {
        const paths = artifactPaths('/workspace/plan.md');
        expect(paths.source).toBe('/workspace/plan.md');
        expect(paths.resolved).toBe('/workspace/plan.md.resolved');
        expect(paths.comments).toBe('/workspace/plan.md.comments.json');
        expect(paths.review).toBe('/workspace/plan.md.review.json');
    });
});

describe('computeHash', () => {
    it('produces deterministic SHA-256 hash', () => {
        const hash1 = computeHash('hello');
        const hash2 = computeHash('hello');
        expect(hash1).toBe(hash2);
        expect(hash1.length).toBe(64); // SHA-256 hex length
    });

    it('produces different hashes for different content', () => {
        expect(computeHash('a')).not.toBe(computeHash('b'));
    });
});

describe('loadArtifactBundle', () => {
    it('loads all files when they exist', async () => {
        const sourcePath = path.join(tmpDir, 'plan.md');
        await fs.writeFile(sourcePath, '# My Plan');
        await fs.writeFile(sourcePath + '.resolved', '---\nsource: plan.md\n---\n## Context\nHello');

        const sidecar: CommentSidecar = {
            version: 1,
            artifactPath: 'plan.md.resolved',
            sourcePath: 'plan.md',
            artifactVersion: 1,
            threads: [],
        };
        await fs.writeFile(sourcePath + '.comments.json', JSON.stringify(sidecar));

        const review: ReviewMetadata = {
            version: 1,
            sourcePath: 'plan.md',
            artifactPath: 'plan.md.resolved',
            sourceHash: computeHash('# My Plan'),
            artifactHash: 'xyz',
            artifactVersion: 1,
            reviewState: 'draft',
            generatorVersion: 'test@0.1.0',
            generatedAt: '2026-01-01T00:00:00Z',
            approvedAt: null,
        };
        await fs.writeFile(sourcePath + '.review.json', JSON.stringify(review));

        const bundle = await loadArtifactBundle(sourcePath);

        expect(bundle.sourceContent).toBe('# My Plan');
        expect(bundle.sourceHash).toBe(computeHash('# My Plan'));
        expect(bundle.resolvedContent).not.toBeNull();
        expect(bundle.parsedArtifact).not.toBeNull();
        expect(bundle.parsedArtifact!.blocks.length).toBeGreaterThan(0);
        expect(bundle.comments).not.toBeNull();
        expect(bundle.comments!.threads).toEqual([]);
        expect(bundle.review).not.toBeNull();
        expect(bundle.review!.reviewState).toBe('draft');
    });

    it('handles missing files gracefully', async () => {
        const sourcePath = path.join(tmpDir, 'nonexistent.md');
        const bundle = await loadArtifactBundle(sourcePath);

        expect(bundle.sourceContent).toBeNull();
        expect(bundle.sourceHash).toBeNull();
        expect(bundle.resolvedContent).toBeNull();
        expect(bundle.parsedArtifact).toBeNull();
        expect(bundle.comments).toBeNull();
        expect(bundle.review).toBeNull();
    });

    it('handles invalid JSON in sidecars', async () => {
        const sourcePath = path.join(tmpDir, 'plan.md');
        await fs.writeFile(sourcePath, '# Plan');
        await fs.writeFile(sourcePath + '.comments.json', 'not json');
        await fs.writeFile(sourcePath + '.review.json', '{ broken');

        const bundle = await loadArtifactBundle(sourcePath);
        expect(bundle.comments).toBeNull();
        expect(bundle.review).toBeNull();
    });
});

describe('save functions', () => {
    it('saves and reloads comment sidecar', async () => {
        const sourcePath = path.join(tmpDir, 'plan.md');
        await fs.writeFile(sourcePath, '# Plan');

        const sidecar: CommentSidecar = {
            version: 1,
            artifactPath: 'plan.md.resolved',
            sourcePath: 'plan.md',
            artifactVersion: 2,
            threads: [],
        };
        await saveCommentSidecar(sourcePath, sidecar);

        const bundle = await loadArtifactBundle(sourcePath);
        expect(bundle.comments).not.toBeNull();
        expect(bundle.comments!.artifactVersion).toBe(2);
    });

    it('saves and reloads review metadata', async () => {
        const sourcePath = path.join(tmpDir, 'plan.md');
        await fs.writeFile(sourcePath, '# Plan');

        const review: ReviewMetadata = {
            version: 1,
            sourcePath: 'plan.md',
            artifactPath: 'plan.md.resolved',
            sourceHash: 'abc',
            artifactHash: 'def',
            artifactVersion: 3,
            reviewState: 'approved',
            generatorVersion: 'test',
            generatedAt: '2026-01-01T00:00:00Z',
            approvedAt: '2026-01-02T00:00:00Z',
        };
        await saveReviewMetadata(sourcePath, review);

        const bundle = await loadArtifactBundle(sourcePath);
        expect(bundle.review).not.toBeNull();
        expect(bundle.review!.reviewState).toBe('approved');
    });

    it('saves resolved artifact', async () => {
        const sourcePath = path.join(tmpDir, 'plan.md');
        await fs.writeFile(sourcePath, '# Plan');

        await saveResolvedArtifact(sourcePath, '## Resolved content');
        const content = await fs.readFile(sourcePath + '.resolved', 'utf8');
        expect(content).toBe('## Resolved content');
    });
});

describe('isArtifactStale', () => {
    it('returns false when no review exists', async () => {
        const sourcePath = path.join(tmpDir, 'plan.md');
        await fs.writeFile(sourcePath, '# Plan');

        const bundle = await loadArtifactBundle(sourcePath);
        expect(isArtifactStale(bundle)).toBe(false);
    });

    it('returns false when hashes match', async () => {
        const sourcePath = path.join(tmpDir, 'plan.md');
        const content = '# Plan';
        await fs.writeFile(sourcePath, content);

        const review: ReviewMetadata = {
            version: 1,
            sourcePath: 'plan.md',
            artifactPath: 'plan.md.resolved',
            sourceHash: computeHash(content),
            artifactHash: 'def',
            artifactVersion: 1,
            reviewState: 'approved',
            generatorVersion: 'test',
            generatedAt: '2026-01-01T00:00:00Z',
            approvedAt: null,
        };
        await saveReviewMetadata(sourcePath, review);

        const bundle = await loadArtifactBundle(sourcePath);
        expect(isArtifactStale(bundle)).toBe(false);
    });

    it('returns true when source changed after generation', async () => {
        const sourcePath = path.join(tmpDir, 'plan.md');
        await fs.writeFile(sourcePath, '# Updated Plan');

        const review: ReviewMetadata = {
            version: 1,
            sourcePath: 'plan.md',
            artifactPath: 'plan.md.resolved',
            sourceHash: computeHash('# Original Plan'),
            artifactHash: 'def',
            artifactVersion: 1,
            reviewState: 'approved',
            generatorVersion: 'test',
            generatedAt: '2026-01-01T00:00:00Z',
            approvedAt: null,
        };
        await saveReviewMetadata(sourcePath, review);

        const bundle = await loadArtifactBundle(sourcePath);
        expect(isArtifactStale(bundle)).toBe(true);
    });
});
