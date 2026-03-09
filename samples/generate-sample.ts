/**
 * Script to generate sample resolved artifact from plan.md.
 * Run with: npx tsx samples/generate-sample.ts
 */
import * as path from 'path';
import { generateResolvedArtifact } from '../src/node/artifact-resolution-service';
import { getOrCreateCommentSidecar, addThread, addReply } from '../src/node/artifact-comment-service';
import { saveCommentSidecar } from '../src/node/artifact-file-service';
import { transitionReviewState } from '../src/node/artifact-review-service';

async function main(): Promise<void> {
    const sourcePath = path.resolve(__dirname, 'plan.md');

    console.log('Generating resolved artifact...');
    const resolved = await generateResolvedArtifact(sourcePath);
    console.log(`  Written: plan.md.resolved (${resolved.length} chars)`);

    console.log('Adding sample comments...');
    const sidecar = await getOrCreateCommentSidecar(sourcePath);

    const t1 = addThread(sidecar, 'database-schema', 'Should we add an index on the email column for faster lookups?', 'user');
    addReply(sidecar, t1.id, 'Yes — email lookups happen on every login. Added to acceptance criteria.', 'agent');

    addThread(sidecar, 'authentication-api', 'We need rate limiting on the login endpoint to prevent brute force.', 'user');

    addThread(sidecar, 'oauth2-integration', 'Consider adding Apple Sign In as a third provider.', 'user');

    await saveCommentSidecar(sourcePath, sidecar);
    console.log(`  Written: plan.md.comments.json (${sidecar.threads.length} threads)`);

    console.log('Transitioning review state...');
    await transitionReviewState(sourcePath, 'in_review');
    console.log('  State: in_review');

    console.log('\nSample artifact generated successfully!');
    console.log('Files:');
    console.log('  - samples/plan.md              (source)');
    console.log('  - samples/plan.md.resolved     (resolved artifact)');
    console.log('  - samples/plan.md.comments.json (comment threads)');
    console.log('  - samples/plan.md.review.json  (review metadata)');
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
