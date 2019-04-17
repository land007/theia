/********************************************************************************
 * Copyright (C) 2017 TypeFox and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * This Source Code may also be made available under the following Secondary
 * Licenses when the conditions for such availability set forth in the Eclipse
 * Public License v. 2.0 are satisfied: GNU General Public License, version 2
 * with the GNU Classpath Exception which is available at
 * https://www.gnu.org/software/classpath/license.html.
 *
 * SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0
 ********************************************************************************/

import { inject, injectable } from 'inversify';
import { Command, CommandRegistry } from '../../common';
import { Keybinding, KeybindingRegistry } from '../keybinding';
import { QuickOpenModel, QuickOpenItem, QuickOpenMode, QuickOpenGroupItem, QuickOpenGroupItemOptions } from './quick-open-model';
import { QuickOpenOptions } from './quick-open-service';
import { QuickOpenContribution, QuickOpenHandlerRegistry, QuickOpenHandler } from './prefix-quick-open-service';
import { ContextKeyService } from '../context-key-service';

@injectable()
export class QuickCommandService implements QuickOpenModel, QuickOpenHandler {

    private items: QuickOpenItem[];

    readonly prefix: string = '>';

    readonly description: string = 'Quick Command';

    @inject(CommandRegistry)
    protected readonly commandRegistry: CommandRegistry;

    @inject(KeybindingRegistry)
    protected readonly keybindingRegistry: KeybindingRegistry;

    @inject(ContextKeyService)
    protected readonly contextKeyService: ContextKeyService;

    protected readonly contexts = new Map<string, string[]>();
    pushCommandContext(commandId: string, when: string) {
        const contexts = this.contexts.get(commandId) || [];
        contexts.push(when);
        this.contexts.set(commandId, contexts);
    }

    /** Initialize this quick open model with the commands. */
    init(): void {
        // let's compute the items here to do it in the context of the currently activeElement
        this.items = [];
        const valid = this.getValidCommands(this.commandRegistry.commands);
        const { recent, other } = this.getCommands(this.commandRegistry.recent, valid);
        this.items.push(...this.buildRecentItems(recent), ...this.buildOtherItems(other, recent.length));
    }

    public onType(lookFor: string, acceptor: (items: QuickOpenItem[]) => void): void {
        acceptor(this.items);
    }

    getModel(): QuickOpenModel {
        return this;
    }

    getOptions(): QuickOpenOptions {
        return { fuzzyMatchLabel: true };
    }

    /**
     * Builds the list of recently used `CommandQuickOpenItem`.
     *
     * @param recent the list of recently used commands.
     * @returns the list of recently used `CommandQuickOpenItem`.
     */
    private buildRecentItems(recent: Command[]): CommandQuickOpenItem[] {
        const items: CommandQuickOpenItem[] = [];
        recent.forEach((command, index) => {
            items.push(new CommandQuickOpenItem(
                command,
                this.commandRegistry,
                this.keybindingRegistry,
                {
                    groupLabel: index === 0 ? 'recently used' : '',
                    showBorder: false,
                }
            ));
        });
        return items;
    }

    /**
     * Builds the list of other `CommandQuickOpenItem`.
     *
     * @param other the list of other commands.
     * @param recentLength the length of the recently used commands list.
     * @returns the list of recently used `CommandQuickOpenItem`.
     */
    private buildOtherItems(other: Command[], recentLength: number): CommandQuickOpenItem[] {
        const items: CommandQuickOpenItem[] = [];
        other.forEach((command, index) => {
            items.push(new CommandQuickOpenItem(
                command,
                this.commandRegistry,
                this.keybindingRegistry,
                {
                    groupLabel: recentLength <= 0 ? '' : index === 0 ? 'other commands' : '',
                    showBorder: recentLength <= 0 ? false : index === 0 ? true : false,
                }
            ));
        });
        return items;
    }

    /**
     * Get the list of recently used and other commands.
     *
     * @param recentCommands the list of recent commands.
     * @param allCommands the list of all commands.
     * @returns the list of recently used commands and other commands.
     */
    private getCommands(recentCommands: Command[], allCommands: Command[]): { recent: Command[], other: Command[] } {

        const recent: Command[] = [];
        recentCommands.forEach((r: Command) => {
            const exists = [...allCommands].some((c: Command) => Command.equals(r, c));
            // Add the recently used item to the list.
            if (exists) { recent.push(r); }
        });

        const other: Command[] = [];
        allCommands.forEach((a: Command) => {
            const exists = [...recent].some((c: Command) => Command.equals(a, c));
            // If the command does not exist in the recently used list, add it to the other list.
            if (!exists) { other.push(a); }
        });

        return { recent, other };
    }

    /**
     * Filter commands which do not have a label, and sort them alphabetically.
     *
     * @param commands the list of raw commands.
     * @returns the list of filtered, and sorted commands.
     */
    private sortAndFilter(commands: Command[]): Command[] {
        return commands
            .filter((a: Command) => a.label)
            .sort((a: Command, b: Command) => Command.compareCommands(a, b));
    }

    /**
     * Get the list of valid commands.
     *
     * @param commands the list of raw commands.
     * @returns the list of valid commands.
     */
    private getValidCommands(raw: Command[]): Command[] {
        const valid: Command[] = [];
        raw.forEach((command: Command) => {
            if (command.label) {
                const contexts = this.contexts.get(command.id);
                if (!contexts || contexts.some(when => this.contextKeyService.match(when))) {
                    valid.push(command);
                }
            }
        });
        return this.sortAndFilter(valid);
    }

}

export class CommandQuickOpenItem extends QuickOpenGroupItem {

    private activeElement: HTMLElement;
    private hidden: boolean;

    constructor(
        protected readonly command: Command,
        protected readonly commands: CommandRegistry,
        protected readonly keybindings: KeybindingRegistry,
        protected readonly options: QuickOpenGroupItemOptions,
    ) {
        super(options);
        this.activeElement = window.document.activeElement as HTMLElement;
        this.hidden = !this.commands.getActiveHandler(this.command.id);
    }

    getLabel(): string {
        return (this.command.category)
            ? `${this.command.category}: ` + this.command.label!
            : this.command.label!;
    }

    isHidden(): boolean {
        return this.hidden;
    }

    getIconClass() {
        const toggleHandler = this.commands.getToggledHandler(this.command.id);
        if (toggleHandler && toggleHandler.isToggled && toggleHandler.isToggled()) {
            return 'fa fa-check';
        }
        return super.getIconClass();
    }

    getKeybinding(): Keybinding | undefined {
        const bindings = this.keybindings.getKeybindingsForCommand(this.command.id);
        return bindings ? bindings[0] : undefined;
    }

    run(mode: QuickOpenMode): boolean {
        if (mode !== QuickOpenMode.OPEN) {
            return false;
        }
        // allow the quick open widget to close itself
        setTimeout(() => {
            // reset focus on the previously active element.
            this.activeElement.focus();
            this.commands.executeCommand(this.command.id);
        }, 50);
        return true;
    }
}

@injectable()
export class CommandQuickOpenContribution implements QuickOpenContribution {

    @inject(QuickCommandService)
    protected readonly commandQuickOpenHandler: QuickCommandService;

    registerQuickOpenHandlers(handlers: QuickOpenHandlerRegistry): void {
        handlers.registerHandler(this.commandQuickOpenHandler);
    }
}
