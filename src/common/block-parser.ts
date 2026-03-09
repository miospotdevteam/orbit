import { ArtifactBlock, ArtifactMetadata, BlockType, ParsedArtifact } from './types';

/** Regex for block markers: <!-- block:id=X type=Y --> */
const BLOCK_MARKER_RE = /^<!--\s*block:id=(\S+)\s+type=(\S+)\s*-->$/;

/** Regex for YAML frontmatter delimiters. */
const FRONTMATTER_DELIM = /^---\s*$/;

/** Regex for markdown headings. */
const HEADING_RE = /^(#{1,6})\s+(.+)$/;

/**
 * Parse YAML-like frontmatter from the top of a resolved artifact.
 * Supports only simple `key: value` pairs (no nesting, no arrays).
 */
function parseFrontmatter(lines: string[]): { metadata: ArtifactMetadata | null; bodyStart: number } {
    if (lines.length < 3 || !FRONTMATTER_DELIM.test(lines[0])) {
        return { metadata: null, bodyStart: 0 };
    }

    let endIdx = -1;
    for (let i = 1; i < lines.length; i++) {
        if (FRONTMATTER_DELIM.test(lines[i])) {
            endIdx = i;
            break;
        }
    }
    if (endIdx === -1) {
        return { metadata: null, bodyStart: 0 };
    }

    const kvPairs: Record<string, string> = {};
    for (let i = 1; i < endIdx; i++) {
        const colonIdx = lines[i].indexOf(':');
        if (colonIdx > 0) {
            const key = lines[i].slice(0, colonIdx).trim();
            const value = lines[i].slice(colonIdx + 1).trim();
            kvPairs[key] = value;
        }
    }

    const metadata: ArtifactMetadata = {
        source: kvPairs['source'] ?? '',
        sourceHash: kvPairs['sourceHash'] ?? '',
        artifactVersion: parseInt(kvPairs['artifactVersion'] ?? '0', 10),
        generator: kvPairs['generator'] ?? '',
        generatedAt: kvPairs['generatedAt'] ?? '',
    };

    return { metadata, bodyStart: endIdx + 1 };
}

/**
 * Derive a stable block ID from a heading string.
 * E.g. "Step 1" → "step-1", "Acceptance Criteria" → "acceptance-criteria"
 */
function deriveBlockId(heading: string): string {
    return heading
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-');
}

/** Infer a block type from a heading string and level. */
function inferBlockType(heading: string, level: number): BlockType {
    const lower = heading.toLowerCase();
    if (lower.includes('verification') || lower.includes('verify')) return 'verification';
    if (lower.includes('acceptance') || lower.includes('criteria')) return 'list';
    if (lower.includes('note') || lower.includes('warning')) return 'note';
    if (/^step\s/i.test(heading)) return 'step';
    if (level <= 2) return 'section';
    return 'section';
}

/**
 * Parse a resolved artifact into structured blocks.
 *
 * Supports two modes:
 * 1. Explicit markers: `<!-- block:id=X type=Y -->` before each section
 * 2. Heading-based fallback: derive block IDs from markdown headings
 *
 * Blocks are ordered by their appearance in the document.
 */
export function parseArtifact(text: string): ParsedArtifact {
    const lines = text.split('\n');
    const { metadata, bodyStart } = parseFrontmatter(lines);

    const blocks: ArtifactBlock[] = [];
    let currentBlock: Partial<ArtifactBlock> & { rawLines: string[] } | null = null;

    function finalizeBlock(endLine: number): void {
        if (currentBlock && currentBlock.id) {
            blocks.push({
                id: currentBlock.id!,
                type: currentBlock.type ?? 'section',
                heading: currentBlock.heading ?? '',
                content: currentBlock.rawLines
                    .filter(l => !BLOCK_MARKER_RE.test(l) && !HEADING_RE.test(l))
                    .join('\n')
                    .trim(),
                rawLines: currentBlock.rawLines,
                startLine: currentBlock.startLine!,
                endLine,
            });
        }
        currentBlock = null;
    }

    /** Pending marker data (when we see a marker before a heading). */
    let pendingMarker: { id: string; type: BlockType; line: number } | null = null;

    for (let i = bodyStart; i < lines.length; i++) {
        const line = lines[i];

        // Check for block marker
        const markerMatch = line.match(BLOCK_MARKER_RE);
        if (markerMatch) {
            pendingMarker = {
                id: markerMatch[1],
                type: markerMatch[2] as BlockType,
                line: i,
            };
            continue;
        }

        // Check for heading
        const headingMatch = line.match(HEADING_RE);
        if (headingMatch) {
            // Finalize previous block
            finalizeBlock(i);

            const level = headingMatch[1].length;
            const headingText = headingMatch[2].trim();

            if (pendingMarker) {
                // Use explicit marker data
                currentBlock = {
                    id: pendingMarker.id,
                    type: pendingMarker.type,
                    heading: headingText,
                    rawLines: [line],
                    startLine: pendingMarker.line,
                };
                pendingMarker = null;
            } else {
                // Derive from heading
                currentBlock = {
                    id: deriveBlockId(headingText),
                    type: inferBlockType(headingText, level),
                    heading: headingText,
                    rawLines: [line],
                    startLine: i,
                };
            }
            continue;
        }

        // Content line — append to current block
        if (currentBlock) {
            currentBlock.rawLines.push(line);
        }
    }

    // Finalize last block
    finalizeBlock(lines.length);

    return { metadata, blocks, raw: text };
}

/** Extract block IDs from a parsed artifact. */
export function getBlockIds(artifact: ParsedArtifact): string[] {
    return artifact.blocks.map(b => b.id);
}

/** Find a block by ID. */
export function findBlock(artifact: ParsedArtifact, blockId: string): ArtifactBlock | undefined {
    return artifact.blocks.find(b => b.id === blockId);
}
