import { describe, expect, it } from 'vitest';
import { buildAgentLaunchPlan, buildAgentTerminalCommand, expandTemplate, shellQuote } from '../post-approve-helpers';

describe('post-approve helpers', () => {
    it('expands prompt variables from artifact paths', () => {
        const prompt = expandTemplate(
            'Proceed with ${sourcePath} from ${workingDirectory} and keep ${resolvedPath} in sync.',
            {
                sourcePath: '/repo/.temp/plan.md',
                resolvedPath: '/repo/.temp/plan.md.resolved',
                sourceDir: '/repo/.temp',
                workingDirectory: '/repo',
            },
        );

        expect(prompt).toBe(
            'Proceed with /repo/.temp/plan.md from /repo and keep /repo/.temp/plan.md.resolved in sync.',
        );
    });

    it('quotes POSIX shell arguments safely', () => {
        expect(shellQuote("it's ready", 'darwin')).toBe('\'it\'"\'"\'s ready\'');
    });

    it('builds a codex launch plan with fallback and follow-up input', () => {
        const plan = buildAgentLaunchPlan(
            {
                action: 'codexTerminal',
                codexCommand: 'codex',
                claudeCommand: 'claude',
                resumeLatestSession: true,
            },
            {
                sourcePath: '/repo/plans/masterPlan.md',
                resolvedPath: '/repo/plans/masterPlan.md.resolved',
                sourceDir: '/repo/plans',
                workingDirectory: '/repo',
                prompt: 'Continue from /repo/plans/masterPlan.md',
            },
            'darwin',
        );

        expect(plan).toEqual({
            command: "codex resume --last --add-dir '/repo/plans' || codex --add-dir '/repo/plans'",
            followupInput: 'Continue from /repo/plans/masterPlan.md',
        });
    });

    it('builds a claude continue command with fallback', () => {
        const plan = buildAgentLaunchPlan(
            {
                action: 'claudeTerminal',
                codexCommand: 'codex',
                claudeCommand: 'claude',
                resumeLatestSession: true,
            },
            {
                sourcePath: '/repo/masterPlan.md',
                resolvedPath: '/repo/masterPlan.md.resolved',
                sourceDir: '/repo',
                workingDirectory: '/repo',
                prompt: 'Continue from /repo/masterPlan.md',
            },
            'darwin',
        );

        expect(plan).toEqual({
            command: "claude --continue --ide 'Continue from /repo/masterPlan.md' || claude --ide 'Continue from /repo/masterPlan.md'",
        });
    });

    it('builds a fresh claude command when resume mode is disabled', () => {
        const command = buildAgentTerminalCommand(
            {
                action: 'claudeTerminal',
                codexCommand: 'codex',
                claudeCommand: 'claude',
                resumeLatestSession: false,
            },
            {
                sourcePath: '/repo/masterPlan.md',
                resolvedPath: '/repo/masterPlan.md.resolved',
                sourceDir: '/repo',
                workingDirectory: '/repo',
                prompt: 'Proceed now',
            },
            'darwin',
        );

        expect(command).toBe("claude --ide 'Proceed now'");
    });

    it('builds a fresh codex launch plan when resume mode is disabled', () => {
        const plan = buildAgentLaunchPlan(
            {
                action: 'codexTerminal',
                codexCommand: 'codex',
                claudeCommand: 'claude',
                resumeLatestSession: false,
            },
            {
                sourcePath: '/repo/masterPlan.md',
                resolvedPath: '/repo/masterPlan.md.resolved',
                sourceDir: '/repo',
                workingDirectory: '/repo',
                prompt: 'Proceed now',
            },
            'darwin',
        );

        expect(plan).toEqual({
            command: 'codex',
            followupInput: 'Proceed now',
        });
    });
});
