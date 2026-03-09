import { describe, it, expect } from 'vitest';
import { parseArtifact, getBlockIds, findBlock } from '../block-parser';

const SAMPLE_WITH_MARKERS = `---
source: plan.md
sourceHash: abc123
artifactVersion: 4
generator: orbit-plan-resolver@0.1.0
generatedAt: 2026-03-08T12:00:00Z
---

<!-- block:id=context type=section -->
## Context
This is the context section with some background information.

<!-- block:id=step-1 type=step -->
## Step 1
Implement the first feature.

<!-- block:id=step-1-acceptance type=list -->
### Acceptance Criteria
- Feature works
- Tests pass

<!-- block:id=verification type=verification -->
## Verification
Run the test suite.
`;

const SAMPLE_WITHOUT_MARKERS = `---
source: plan.md
sourceHash: def456
artifactVersion: 1
generator: orbit-plan-resolver@0.1.0
generatedAt: 2026-03-08T12:00:00Z
---

## Context
This is the context section.

## Step 1
Do the thing.

### Acceptance Criteria
- It works

## Verification
Check it.
`;

const SAMPLE_NO_FRONTMATTER = `## Context
Just a heading with no frontmatter.

## Step 1
Do something.
`;

const SAMPLE_EMPTY = ``;

describe('parseArtifact', () => {
    describe('with explicit block markers', () => {
        it('parses frontmatter metadata', () => {
            const result = parseArtifact(SAMPLE_WITH_MARKERS);
            expect(result.metadata).not.toBeNull();
            expect(result.metadata!.source).toBe('plan.md');
            expect(result.metadata!.sourceHash).toBe('abc123');
            expect(result.metadata!.artifactVersion).toBe(4);
            expect(result.metadata!.generator).toBe('orbit-plan-resolver@0.1.0');
            expect(result.metadata!.generatedAt).toBe('2026-03-08T12:00:00Z');
        });

        it('extracts all blocks with correct IDs', () => {
            const result = parseArtifact(SAMPLE_WITH_MARKERS);
            expect(getBlockIds(result)).toEqual([
                'context',
                'step-1',
                'step-1-acceptance',
                'verification',
            ]);
        });

        it('assigns correct block types from markers', () => {
            const result = parseArtifact(SAMPLE_WITH_MARKERS);
            expect(result.blocks[0].type).toBe('section');
            expect(result.blocks[1].type).toBe('step');
            expect(result.blocks[2].type).toBe('list');
            expect(result.blocks[3].type).toBe('verification');
        });

        it('captures heading text', () => {
            const result = parseArtifact(SAMPLE_WITH_MARKERS);
            expect(result.blocks[0].heading).toBe('Context');
            expect(result.blocks[1].heading).toBe('Step 1');
            expect(result.blocks[2].heading).toBe('Acceptance Criteria');
        });

        it('captures block content without marker and heading lines', () => {
            const result = parseArtifact(SAMPLE_WITH_MARKERS);
            expect(result.blocks[0].content).toBe(
                'This is the context section with some background information.',
            );
        });

        it('sets correct line ranges', () => {
            const result = parseArtifact(SAMPLE_WITH_MARKERS);
            // First block starts at the marker line
            expect(result.blocks[0].startLine).toBeGreaterThanOrEqual(0);
            // Each block ends where the next begins
            for (let i = 0; i < result.blocks.length - 1; i++) {
                expect(result.blocks[i].endLine).toBeLessThanOrEqual(
                    result.blocks[i + 1].startLine + 1,
                );
            }
        });
    });

    describe('with heading-derived fallback (no markers)', () => {
        it('parses frontmatter', () => {
            const result = parseArtifact(SAMPLE_WITHOUT_MARKERS);
            expect(result.metadata).not.toBeNull();
            expect(result.metadata!.sourceHash).toBe('def456');
        });

        it('derives stable block IDs from headings', () => {
            const result = parseArtifact(SAMPLE_WITHOUT_MARKERS);
            expect(getBlockIds(result)).toEqual([
                'context',
                'step-1',
                'acceptance-criteria',
                'verification',
            ]);
        });

        it('infers block types from heading text', () => {
            const result = parseArtifact(SAMPLE_WITHOUT_MARKERS);
            expect(result.blocks[0].type).toBe('section');
            expect(result.blocks[1].type).toBe('step');
            expect(result.blocks[2].type).toBe('list');
            expect(result.blocks[3].type).toBe('verification');
        });
    });

    describe('no frontmatter', () => {
        it('returns null metadata', () => {
            const result = parseArtifact(SAMPLE_NO_FRONTMATTER);
            expect(result.metadata).toBeNull();
        });

        it('still extracts blocks from headings', () => {
            const result = parseArtifact(SAMPLE_NO_FRONTMATTER);
            expect(result.blocks.length).toBe(2);
            expect(result.blocks[0].id).toBe('context');
            expect(result.blocks[1].id).toBe('step-1');
        });
    });

    describe('empty input', () => {
        it('returns null metadata and no blocks', () => {
            const result = parseArtifact(SAMPLE_EMPTY);
            expect(result.metadata).toBeNull();
            expect(result.blocks).toEqual([]);
        });
    });

    describe('findBlock', () => {
        it('finds a block by ID', () => {
            const result = parseArtifact(SAMPLE_WITH_MARKERS);
            const block = findBlock(result, 'step-1');
            expect(block).toBeDefined();
            expect(block!.heading).toBe('Step 1');
        });

        it('returns undefined for unknown ID', () => {
            const result = parseArtifact(SAMPLE_WITH_MARKERS);
            expect(findBlock(result, 'nonexistent')).toBeUndefined();
        });
    });
});
