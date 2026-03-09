import * as path from 'path';
import * as vscode from 'vscode';
import { buildAgentLaunchPlan, expandTemplate, TerminalAgentAction } from './post-approve-helpers';

export type PostApproveAction =
    | 'ask'
    | 'none'
    | 'codexTerminal'
    | 'claudeTerminal'
    | 'vscodeCommand';

export interface PostApproveContext {
    sourcePath: string;
    resolvedPath: string;
    sourceDir: string;
    workingDirectory: string;
    prompt: string;
}

export interface PostApproveSettings {
    action: PostApproveAction;
    codexCommand: string;
    claudeCommand: string;
    resumeLatestSession: boolean;
    promptTemplate: string;
    vscodeCommand: string | null;
}

const CONFIG_PREFIX = 'artifactReview.postApprove';
const CODEX_FOLLOWUP_DELAY_MS = 1200;
const DEFAULT_PROMPT_TEMPLATE =
    'Continue implementing the approved plan at ${sourcePath}. ' +
    'Read the plan, inspect the repository, and proceed automatically.';

export function getPostApproveSettings(): PostApproveSettings {
    const config = vscode.workspace.getConfiguration();

    return {
        action: config.get<PostApproveAction>(`${CONFIG_PREFIX}.action`, 'ask'),
        codexCommand: config.get<string>(`${CONFIG_PREFIX}.codexCommand`, 'codex'),
        claudeCommand: config.get<string>(`${CONFIG_PREFIX}.claudeCommand`, 'claude'),
        resumeLatestSession: config.get<boolean>(`${CONFIG_PREFIX}.resumeLatestSession`, true),
        promptTemplate: config.get<string>(`${CONFIG_PREFIX}.promptTemplate`, DEFAULT_PROMPT_TEMPLATE),
        vscodeCommand: config.get<string | null>(`${CONFIG_PREFIX}.vscodeCommand`, null),
    };
}

export function buildPostApproveContext(
    sourcePath: string,
    promptTemplate = DEFAULT_PROMPT_TEMPLATE,
): PostApproveContext {
    const sourceUri = vscode.Uri.file(sourcePath);
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(sourceUri)?.uri.fsPath;
    const sourceDir = path.dirname(sourcePath);
    const workingDirectory = workspaceFolder ?? sourceDir;
    const resolvedPath = `${sourcePath}.resolved`;
    const prompt = expandTemplate(promptTemplate, {
        sourcePath,
        resolvedPath,
        sourceDir,
        workingDirectory,
    });

    return {
        sourcePath,
        resolvedPath,
        sourceDir,
        workingDirectory,
        prompt,
    };
}

interface PostApproveActionItem extends vscode.QuickPickItem {
    action: Exclude<PostApproveAction, 'ask'>;
}

async function pickPostApproveAction(
    settings: PostApproveSettings,
): Promise<Exclude<PostApproveAction, 'ask'> | undefined> {
    const items: PostApproveActionItem[] = [
        {
            label: 'Claude Code',
            description: 'Launch Claude in a terminal and continue the approved plan.',
            action: 'claudeTerminal',
        },
        {
            label: 'OpenAI Codex',
            description: 'Launch Codex in a terminal and continue the approved plan.',
            action: 'codexTerminal',
        },
        {
            label: 'Do Nothing',
            description: 'Approve the artifact without launching another tool.',
            action: 'none',
        },
    ];

    if (settings.vscodeCommand) {
        items.splice(2, 0, {
            label: 'VS Code Command',
            description: `Run ${settings.vscodeCommand}.`,
            action: 'vscodeCommand',
        });
    }

    const selection = await vscode.window.showQuickPick(items, {
        title: 'Orbit Post-Approve Action',
        placeHolder: 'Choose what should run after approval',
        ignoreFocusOut: true,
    });

    return selection?.action;
}

export async function runPostApproveAction(sourcePath: string): Promise<void> {
    const settings = getPostApproveSettings();
    const action = settings.action === 'ask'
        ? await pickPostApproveAction(settings)
        : settings.action;

    if (!action || action === 'none') {
        return;
    }

    const context = buildPostApproveContext(sourcePath, settings.promptTemplate);

    if (action === 'vscodeCommand') {
        if (!settings.vscodeCommand) {
            vscode.window.showWarningMessage(
                'Artifact Review: post-approve action is set to vscodeCommand, but no command is configured.',
            );
            return;
        }

        await vscode.commands.executeCommand(settings.vscodeCommand, context);
        return;
    }

    const terminalName = action === 'claudeTerminal'
        ? 'Claude Auto Proceed'
        : 'Codex Auto Proceed';
    const terminalOptions = {
        action: action as TerminalAgentAction,
        codexCommand: settings.codexCommand,
        claudeCommand: settings.claudeCommand,
        resumeLatestSession: settings.resumeLatestSession,
    };
    const launchPlan = buildAgentLaunchPlan(terminalOptions, context);
    const terminal = vscode.window.createTerminal({
        name: terminalName,
        cwd: context.workingDirectory,
    });
    terminal.show(true);
    terminal.sendText(launchPlan.command, true);

    if (launchPlan.followupInput) {
        setTimeout(() => {
            terminal.sendText(launchPlan.followupInput!, true);
        }, CODEX_FOLLOWUP_DELAY_MS);
    }
}
