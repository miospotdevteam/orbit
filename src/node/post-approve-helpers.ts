export interface PostApproveTemplateValues {
    sourcePath: string;
    resolvedPath: string;
    sourceDir: string;
    workingDirectory: string;
}

export interface PostApproveCommandContext extends PostApproveTemplateValues {
    prompt: string;
}

export type TerminalAgentAction = 'codexTerminal' | 'claudeTerminal';

export interface TerminalAgentCommandOptions {
    action: TerminalAgentAction;
    codexCommand: string;
    claudeCommand: string;
    resumeLatestSession: boolean;
}

export interface AgentLaunchPlan {
    command: string;
    followupInput?: string | undefined;
}

export function expandTemplate(template: string, values: PostApproveTemplateValues): string {
    return template.replace(/\$\{(\w+)\}/g, (_match, key: string) => values[key as keyof PostApproveTemplateValues] ?? '');
}

export function shellQuote(value: string, platform = process.platform): string {
    if (platform === 'win32') {
        return `"${value.replace(/"/g, '\\"')}"`;
    }

    return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function buildAddDirArg(
    context: PostApproveCommandContext,
    platform = process.platform,
) {
    return context.sourceDir !== context.workingDirectory
        ? ` --add-dir ${shellQuote(context.sourceDir, platform)}`
        : '';
}

function buildSingleAgentCommand(
    options: TerminalAgentCommandOptions,
    context: PostApproveCommandContext,
    mode: 'resume' | 'new',
    platform = process.platform,
): string {
    const addDir = buildAddDirArg(context, platform);
    const prompt = shellQuote(context.prompt, platform);

    if (options.action === 'claudeTerminal') {
        const continueFlag = mode === 'resume' ? ' --continue' : '';
        return `${options.claudeCommand}${continueFlag} --ide${addDir} ${prompt}`;
    }

    const resumePrefix = mode === 'resume' ? ' resume --last' : '';
    return `${options.codexCommand}${resumePrefix}${addDir}`;
}

export function buildAgentLaunchPlan(
    options: TerminalAgentCommandOptions,
    context: PostApproveCommandContext,
    platform = process.platform,
): AgentLaunchPlan {
    const primaryMode = options.resumeLatestSession ? 'resume' : 'new';
    const primary = buildSingleAgentCommand(options, context, primaryMode, platform);

    if (!options.resumeLatestSession) {
        return options.action === 'codexTerminal'
            ? { command: primary, followupInput: context.prompt }
            : { command: primary };
    }

    const fallback = buildSingleAgentCommand(options, context, 'new', platform);
    const command = `${primary} || ${fallback}`;

    return options.action === 'codexTerminal'
        ? { command, followupInput: context.prompt }
        : { command };
}

export function buildAgentTerminalCommand(
    options: TerminalAgentCommandOptions,
    context: PostApproveCommandContext,
    platform = process.platform,
): string {
    return buildAgentLaunchPlan(options, context, platform).command;
}
