//import { Setting } from "obsidian";

export abstract class WizardPage {
    protected _containerEl: HTMLElement;
    private _backButtonEl: HTMLButtonElement | null = null;
    private _nextButtonEl: HTMLButtonElement | null = null;
    protected _animalID: string;

    private _onSuccess?: (...args: any[]) => void;
    private _onCancelled?: () => void;

    constructor(parentEl: HTMLElement, animalID: string) {
        this._containerEl = parentEl.createDiv({ cls: "wizard-page" });
        this._animalID = animalID;
    }

    // Setup callbacks
    onSuccess(callback: (...args: any[]) => void): void {
        this._onSuccess = callback;
    }

    onCancelled(callback: () => void): void {
        this._onCancelled = callback;
    }

    protected triggerSuccess(...args: any[]): void {
        if (this._onSuccess) {
            this._onSuccess(...args);
        } else {
            console.warn("No onSuccess handler is set.");
        }
    }

    protected triggerCancelled(): void {
        if (this._onCancelled) {
            this._onCancelled();
        } else {
            console.warn("No onCancelled handler is set.");
        }
    }

    // Initialize the page with specific content and buttons
    public renderPage(contentElements: HTMLElement[], showBack: boolean, showNext: boolean) {
        // Clear any previous content
        this._containerEl.empty();

        const outerContainer = this._containerEl.createDiv({ cls: "wizard-page-container" });
        const contentContainer = outerContainer.createDiv({ cls: "wizard-content-container" });

        // Always render top title
        const titleEl = contentContainer.createEl("h2", { text: `Export ${this._animalID}` });
        titleEl.classList.add("export-wizard-top-title");

        // Append dynamic content
        contentElements.forEach((el) => contentContainer.appendChild(el));

        // Add Back and Next buttons
        this.renderButtons(outerContainer, showBack, showNext);
    }

    private renderButtons(outerContainer: HTMLElement, showBack: boolean, showNext: boolean) {
        const buttonsContainer = outerContainer.createDiv({ cls: "wizard-buttons-container" });

        // Back Button
        if (showBack) {
            this._backButtonEl = buttonsContainer.createEl("button", { text: "Back" });
            this._backButtonEl.classList.add("wizard-button");
            this._backButtonEl.classList.add("left-aligned");
            this._backButtonEl.onclick = () => this.onBack();
        }

        // Next Button
        if (showNext) {
            this._nextButtonEl = buttonsContainer.createEl("button", { text: "Next" });
            this._nextButtonEl.classList.add("wizard-button");
            this._nextButtonEl.classList.add("right-aligned");
            this._nextButtonEl.onclick = () => this.onNext();
        }
    }

    // Abstract methods for specific handling in child pages
    protected abstract onBack(): void;
    protected abstract onNext(): void;
}