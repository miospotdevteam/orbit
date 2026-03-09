import * as fs from 'fs/promises';
import {
    artifactPaths,
    computeHash,
    loadArtifactBundle,
    saveResolvedArtifact,
    saveReviewMetadata,
    saveCommentSidecar,
} from './artifact-file-service';
import { reattachThreads } from './artifact-comment-service';
import { parseArtifact, getBlockIds } from '../common/block-parser';
import { createDefaultReviewMetadata } from '../common/schemas';
import { AgentBridge, buildReviewPayload } from './artifact-agent-bridge';


/**
 * Result of a full regeneration cycle.
 */
export interface RegenerationResult {
    success: boolean;
    error?: string;
    threadsKept: number;
    threadsOutdated: number;
}

/**
 * Generate a resolved artifact from a source plan.
 *
 * For MVP, the "resolver" is simple: it reads the source markdown,
 * wraps sections with block markers, adds frontmatter, and writes
 * the resolved file.
 */
export async function generateResolvedArtifact(
    sourcePath: string,
    generatorVersion: string = 'orbit-plan-resolver@0.1.0',
): Promise<string> {
    const sourceContent = await fs.readFile(sourcePath, 'utf8');
    const sourceHash = computeHash(sourceContent);
    const lines = sourceContent.split('\n');
    const now = new Date().toISOString();

    // Build frontmatter
    const frontmatter = [
        '---',
        `source: ${sourcePath}`,
        `sourceHash: ${sourceHash}`,
        `artifactVersion: 1`,
        `generator: ${generatorVersion}`,
        `generatedAt: ${now}`,
        '---',
        '',
    ];

    // Add block markers before each heading
    const resolvedLines: string[] = [...frontmatter];
    const headingRe = /^(#{1,6})\s+(.+)$/;
    let blockCount = 0;

    for (const line of lines) {
        const match = line.match(headingRe);
        if (match) {
            const headingText = match[2].trim();
            const blockId = headingText
                .toLowerCase()
                .replace(/[^a-z0-9\s-]/g, '')
                .trim()
                .replace(/\s+/g, '-');

            const type = inferType(headingText, match[1].length);
            resolvedLines.push(`<!-- block:id=${blockId} type=${type} -->`);
            blockCount++;
        }
        resolvedLines.push(line);
    }

    const resolvedContent = resolvedLines.join('\n');

    // Write resolved file
    await saveResolvedArtifact(sourcePath, resolvedContent);

    // Update review metadata
    const artifactHash = computeHash(resolvedContent);
    const reviewMeta = createDefaultReviewMetadata(
        sourcePath,
        sourcePath + '.resolved',
        sourceHash,
        artifactHash,
        1,
        generatorVersion,
        now,
    );
    await saveReviewMetadata(sourcePath, reviewMeta);

    return resolvedContent;
}

/**
 * Execute the full regeneration cycle:
 * 1. Send review payload to agent
 * 2. Agent rewrites plan.md
 * 3. Regenerate plan.md.resolved
 * 4. Reattach threads by block ID
 * 5. Mark unmatched threads outdated
 */
export async function executeRegenerationCycle(
    sourcePath: string,
    agentBridge: AgentBridge,
): Promise<RegenerationResult> {
    const bundle = await loadArtifactBundle(sourcePath);

    if (!bundle.comments || !bundle.parsedArtifact) {
        return {
            success: false,
            error: 'No artifact or comments to process',
            threadsKept: 0,
            threadsOutdated: 0,
        };
    }

    const artifactVersion = bundle.parsedArtifact.metadata?.artifactVersion ?? 0;
    const paths = artifactPaths(sourcePath);

    // Build and send payload
    const payload = buildReviewPayload(
        sourcePath,
        paths.resolved,
        artifactVersion,
        bundle.comments,
    );

    const agentResult = await agentBridge.processReviewPayload(payload);
    if (!agentResult.success || !agentResult.updatedSource) {
        return {
            success: false,
            error: agentResult.error ?? 'Agent returned no updated source',
            threadsKept: 0,
            threadsOutdated: 0,
        };
    }

    // Write updated source
    await fs.writeFile(sourcePath, agentResult.updatedSource, 'utf8');

    // Regenerate resolved artifact
    const resolvedContent = await generateResolvedArtifact(sourcePath);
    const newArtifact = parseArtifact(resolvedContent);
    const newBlockIds = getBlockIds(newArtifact);

    // Reattach threads
    const { kept, outdated } = reattachThreads(bundle.comments, newBlockIds);
    await saveCommentSidecar(sourcePath, bundle.comments);

    return {
        success: true,
        threadsKept: kept,
        threadsOutdated: outdated,
    };
}

function inferType(heading: string, _level: number): string {
    const lower = heading.toLowerCase();
    if (lower.includes('verification') || lower.includes('verify')) return 'verification';
    if (lower.includes('acceptance') || lower.includes('criteria')) return 'list';
    if (lower.includes('note') || lower.includes('warning')) return 'note';
    if (/^step\s/i.test(heading)) return 'step';
    return 'section';
}
