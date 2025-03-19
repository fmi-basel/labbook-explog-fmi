import { Modal, App, Setting, Notice } from "obsidian";
import { ExportData } from "./export-data";
import { WizardPage } from "./export-wizard-page"
import { CustomNotice } from "./custom-notice";
import * as utils from "./utils"
import * as dbQueries from "db-queries";
import moment from "moment"; // A namespace-style import cannot be called or constructed, and will cause a failure at runtime.

export class ExportWizardModal extends Modal {
    _dbConfig: dbQueries.DBConfig;
    private _resolvePromise: (value: string | null) => void; // Function to resolve the Promise
  	private _result: string | null = null; // To store the result
    private _wasCancelled: boolean = true; // Tracks if the modal was cancelled

    private _currentStep: number = 0;
    private _animalID: string;
    private _exportData: ExportData[] = [];
    private _missingSitesIDs: number[] = [];
    private _missingSiteIDsIndex: number = 0;
    private _projects: string[] = [];
    private _locations: string[] = [];

    constructor(app: App, dbConfig: dbQueries.DBConfig, animalID: string, exportData: ExportData[]) {
        super(app);
        this._dbConfig = dbConfig;
        this._animalID = animalID;
        this._exportData = exportData;
    }

    // Method to open the modal and return a Promise
	openWithPromise(): Promise<string | null> {
		return new Promise((resolve) => {
			this._resolvePromise = resolve; // Store the resolve function
			this.open();
		});
	}

    async onOpen() {
        try {
            await this.renderCurrentStep();

            if (!this._animalID) {
                this._result = "Animal ID is required.";
                this._resolvePromise(this._result);
                this.close();
                return;
            }
            if (!this._exportData || this._exportData.length === 0) {
                this._result = "Export data is required.";
                this._resolvePromise(this._result);
                this.close();
                return;
            }
    
            // Get current IDs
            const currentStackIDs = this._exportData.filter((row) => !!row.stackID).map((row) => row.stackID as number);
            const currentExpIDs = this._exportData.filter((row) => !!row.expID).map((row) => row.expID as number);
            const currentSiteIDs = this._exportData.filter((row) => !!row.siteID).map((row) => row.siteID as number);
    
            if ((!currentStackIDs || currentStackIDs.length === 0)
                || (!currentExpIDs || currentExpIDs.length === 0)
                || (!currentSiteIDs || currentSiteIDs.length === 0)
            ) {
                this._result = "StackIDs, ExpIDs and SiteIDs must be available in export data.";
                this._resolvePromise(this._result);
                this.close();
                return;
            }
    
            // Use a Set to ensure unique site IDs
            const distinctStackIDs = Array.from(new Set(currentStackIDs));
            const distinctExpIDs = Array.from(new Set(currentExpIDs));
            const distinctSiteIDs = Array.from(new Set(currentSiteIDs));
            this._missingSitesIDs = await dbQueries.queryMissingSites(this._dbConfig, distinctSiteIDs);
    
            console.log(`Distinct SiteIDs: ${distinctSiteIDs}`);
            console.log(`Missing SiteIDs: ${this._missingSitesIDs}`);
    
            const validationResult = await this.ValidateExportData(distinctStackIDs, distinctExpIDs, distinctSiteIDs);
            if (validationResult) {
                this._result = validationResult;
                this._resolvePromise(this._result);
                this.close();
                return;
            }
    
            if (this._missingSitesIDs.length > 0) {
                this._currentStep++;
            }
            else {
                this._currentStep += 2;
            }

            // Allow setting custom CSS for styling (e.g. height)
            const { contentEl, modalEl } = this;
            modalEl.classList.add("export-wizard-modal");

            // Clear previous content
            contentEl.empty();
            
            this.renderCurrentStep();
        }
        catch (err) {
            this._result = err.message;
            this._resolvePromise(this._result);
            this.close();
            return;
        }
    }

    async ValidateExportData(stackIDs: number[], expIDs: number[], siteIDs: number[]): Promise<string> { //Promise<string | null>
        const messages: string[] = [];

        // Check, if provided stackIDs, expIDs and siteIDs (which already exist) are belonging to this animal
        const invalidStackIDs = await dbQueries.queryInvalidStacksForAnimal(this._dbConfig, this._animalID, stackIDs);
        const invalidExpIDs = await dbQueries.queryInvalidExperimentsForAnimal(this._dbConfig, this._animalID, expIDs);
        const invalidSiteIDs = await dbQueries.queryInvalidSitesForAnimal(this._dbConfig, this._animalID, siteIDs);

        if ((invalidStackIDs && invalidStackIDs.length > 0)
            || (invalidExpIDs && invalidExpIDs.length > 0)
            || (invalidSiteIDs && invalidSiteIDs.length > 0)
        ) {
            messages.push("Some StackIDs, ExpIDs or SiteIDs are belonging to different animal.");
            if (invalidStackIDs && invalidStackIDs.length > 0) {
                messages.push(`StackIDs: ${invalidStackIDs.join(", ")}`);
            }
            if (invalidExpIDs && invalidExpIDs.length > 0) {
                messages.push(`ExpIDs: ${invalidExpIDs.join(", ")}`);
            }
            if (invalidSiteIDs && invalidSiteIDs.length > 0) {
                messages.push(`SiteIDs: ${invalidSiteIDs.join(", ")}`);
            }
        }

        // Check, if for each missing Site there is corresponding Stack & Experiment with same ID
        if (this._missingSitesIDs && this._missingSitesIDs.length > 0) {
            const missingStackExpIDs: number[] = [];
            this._missingSitesIDs.forEach(siteID => {
                if (this._exportData.filter((row) => row.siteID == siteID && row.stackID == siteID && row.expID == siteID).length === 0) {
                    missingStackExpIDs.push(siteID);
                }
            });
            if (missingStackExpIDs.length > 0) {
                messages.push(`Following new SiteIDs don't have matching StackID / ExpID: ${missingStackExpIDs.join(", ")}`);
            }
        }

        return messages.join("\n");
    }

    async renderCurrentStep() {
        const { contentEl } = this;
        contentEl.empty(); // Clear content for new step

        switch (this._currentStep) {
            case 0:
                this.renderStepInitialValidation();
                break;
            case 1:
                this.renderStepNewSite();
                break;
            case 2:
                this.renderStepFinish();
                break;
            default:
                this._resolvePromise(this._result);
                this.close();
                return;
        }
    }

    private async renderStepInitialValidation() {
        const { contentEl } = this;
        const titleEl = contentEl.createEl("h3", { text: `Export ${this._animalID}` });
        titleEl.classList.add("export-wizard-title");
        contentEl.createEl("p", { text: "Validating data..." });
    }

    private async renderStepNewSite() {
        if (this._missingSitesIDs.length == 0) {
            throw new Error("Error in renderStepNewSite: _missingSitesIDs is empty.");
        }
        if (this._missingSiteIDsIndex > 0 && this._missingSiteIDsIndex + 1 > this._missingSitesIDs.length) {
            throw new Error(`Error in renderStepNewSite: _missingSiteIDsIndex is out of range (index = ${this._missingSiteIDsIndex}, max. range = ${this._missingSitesIDs.length - 1}).`);
        }

        // Get projects & locations (used during site creation)
        if (this._projects.length == 0) {
            this._projects = await dbQueries.queryProjects(this._dbConfig);
        }
        if (this._locations.length == 0) {
            this._locations = await dbQueries.queryLocations(this._dbConfig);
        }

        // Get the current site (based on _missingSiteIDsIndex)
        const currSiteID = this._missingSitesIDs[this._missingSiteIDsIndex];

        const { contentEl } = this;
        const page = new NewSiteWizardPage(contentEl, this._animalID, currSiteID, this._missingSiteIDsIndex, this._missingSitesIDs.length, this._projects, this._locations);
        page.onSuccess(async (result) => {
            try {
                await dbQueries.addNewSite(this._dbConfig, currSiteID, this._animalID, result.project, result.location, result.depth);
                new CustomNotice(`New Site ${currSiteID} added successfully.`, "success-notice");

                this._missingSiteIDsIndex++;
                if (!(this._missingSiteIDsIndex + 1 <= this._missingSitesIDs.length)) {
                    this._currentStep++;
                }
                await this.renderCurrentStep();
            }
            catch(err) {
                new CustomNotice(err.message, "error-notice");
            }
        });
    }

    private async renderStepFinish() {
        const { contentEl, modalEl } = this;
        modalEl.classList.add("finish-wizard-page");

        const page = new FinishWizardPage(contentEl, this._animalID, this._exportData);
        page.onSuccess(async (result) => {
            try {
                let countInsExp : number = 0;
                let countUpdExp : number = 0;
                let countInsStack : number = 0;
                let countUpdStack : number = 0;
                if (this._exportData && this._exportData.length > 0) {
                    for (const data of this._exportData) {
                        // Experiment
                        const dataExp = { ExpID: data.expID, SiteID: data.siteID };
                        const countExp = await dbQueries.executeNonQuery(this._dbConfig, "UPDATE dbo.Experiments SET SiteID = @SiteID WHERE ExpID = @ExpID;", dataExp);
                        if (countExp == 0) {
                            // If there was no update, then Experiment not yet exists
                            await dbQueries.executeNonQuery(this._dbConfig, "INSERT INTO dbo.Experiments (ExpID, SiteID) VALUES (@ExpID, @SiteID);", dataExp);
                            //new CustomNotice(`New Experiment ${data.expID} added successfully.`, "success-notice");
                            countInsExp++;
                        }
                        else {
                            //new CustomNotice(`Experiment ${data.expID} updated successfully.`, "success-notice");
                            countUpdExp++;
                        }

                        // Stack
                        //Fix timeshift UTC
                        //const stackDate = new Date(data.logDateTime!.getFullYear(), data.logDateTime!.getMonth(), data.logDateTime!.getDate());
                        const stackDate = moment(data.logDateTime!).format("YYYY-MM-DD"); // Store as local date string
                        const stackTime = moment(data.logDateTime!).format("HH:mm:ss");
                        const dataStack = { StackID: data.stackID, ExpID: data.expID, StackDate: stackDate, StackTime: stackTime, Paradigm: data.paradigm, Comment: data.comment };
                        
                        const countStack = await dbQueries.executeNonQuery(this._dbConfig, "UPDATE dbo.Stacks SET ExpID = @ExpID, StackDate = @StackDate, StackTime = @StackTime, Paradigm = @Paradigm, Comment = @Comment WHERE StackID = @StackID;", dataStack);
                        if (countStack == 0) {
                            // If there was no update, then Stack not yet exists
                            await dbQueries.executeNonQuery(this._dbConfig, "INSERT INTO dbo.Stacks (StackID, ExpID, StackDate, StackTime, Paradigm, Comment) VALUES (@StackID, @ExpID, @StackDate, @StackTime, @Paradigm, @Comment);", dataStack);
                            //new CustomNotice(`New Stack ${data.stackID} added successfully.`, "success-notice");
                            countInsStack++;
                        }
                        else {
                            //new CustomNotice(`Stack ${data.stackID} updated successfully.`, "success-notice");
                            countUpdStack++;
                        }
                    };

                    this._wasCancelled = false;
                    this.close();
                }

                if (countInsExp + countUpdExp === 0) {
                    new CustomNotice(`Experiments: Ins=0, Upd=0`, "warning-notice");
                }
                else {
                    new CustomNotice(`Experiments: Ins=${countInsExp}, Upd=${countUpdExp}`, "success-notice");
                }

                if (countInsStack + countUpdStack === 0) {
                    new CustomNotice(`Stacks: Ins=0, Upd=0`, "warning-notice");
                }
                else {
                    new CustomNotice(`Stacks: Ins=${countInsStack}, Upd=${countUpdStack}`, "success-notice");
                }
            }
            catch(err) {
                new CustomNotice(err.message, "error-notice");
            }
        });
        
        page.onCancelled(async () => {
            this.close();
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty(); // Clean up modal

        // Check cancellation
        if (this._wasCancelled) {
            console.log("Modal was cancelled (Close button or Esc key).");
            this._result = "User cancelled the export.";
        }

        this._resolvePromise(this._result); // Resolve the Promise with the result
    }
}

class NewSiteWizardPage extends WizardPage {
    private _projectType: string = "existing";
    private _locationType: string = "existing";
    private _projects: string[] = [];
    private _locations: string[] = [];

    private _currentSiteID: number;
    private _currentProjectName: string = "";
    private _currentLocationName: string = "";
    private _currentDepthString: string = "";

    private _projectContainer: HTMLElement;
    private _locationContainer: HTMLElement;
    private _depthContainer: HTMLElement;

    constructor(parentEl: HTMLElement, animalID: string, currentSiteID: number, currentSitesIndex: number, totalSitesCount: number, existingProjects: string[], existingLocations: string[]) {
        super(parentEl, animalID);

        this._projects = existingProjects;
        this._locations = existingLocations;
        this._currentSiteID = currentSiteID;

        this.renderPageContent(currentSitesIndex, totalSitesCount);
    }

    private renderPageContent(currentSitesIndex: number, totalSitesCount: number) {
        const { _containerEl: containerEl } = this;

        // Header
        const titleEl = containerEl.createEl("h3", { text: `Create New Site: ${this._currentSiteID}` });
        titleEl.classList.add("export-wizard-title");
        const descriptionEl = containerEl.createEl("p", {
            text: `Step ${currentSitesIndex + 1} of ${totalSitesCount} - Please provide project and location details.`,
        });

        // Project Section
        this._projectContainer = containerEl.createDiv({ cls: "project-container" });
        this.renderProjectSection();

        // Location Section
        this._locationContainer = containerEl.createDiv({ cls: "location-container" });
        this.renderLocationSection();

        // Depth Section
        this._depthContainer = containerEl.createDiv({ cls: "depth-container" });
        this.renderDepthSection();

        // Call the parent renderPage to display content and buttons
        this.renderPage(
            [titleEl, descriptionEl, this._projectContainer, this._locationContainer, this._depthContainer], // Content elements
            false,  // Never show "Back" button for new sites as data is saved when clicking on "Next" (currentSitesIndex > 0)
            true   // Show "Next" button
        );
    }

    // Render Project Section
    private renderProjectSection() {
        this._projectContainer.empty(); // Clear previous content
        this._projectContainer.createEl("h4", { text: "Project" });

        // Create a container for the dropdown
        const dropdownContainer = this._projectContainer.createDiv({ cls: "project-type-container" });

        // Create the dropdown element
        const dropdown = dropdownContainer.createEl("select", { cls: "project-type-dropdown" });

        // Add dropdown options
        const options = [
            { value: "existing", label: "Existing" },
            { value: "new", label: "New" },
        ];

        options.forEach((option) => {
            const opt = dropdown.createEl("option", { text: option.label, value: option.value });
            if (option.value === this._projectType) {
                opt.selected = true;
            }
        });

        // Handle dropdown change
        dropdown.addEventListener("change", (event: Event) => {
            const target = event.target as HTMLSelectElement;
            this._projectType = target.value;
            console.log(`Project type selected: ${this._projectType}`);
            this.renderProjectInputs(); // Re-render inputs below
        });

        this.renderProjectInputs();
    }

    private renderProjectInputs() {
        let inputContainer = this._projectContainer.querySelector(".project-inputs") as HTMLElement;
        if (!inputContainer) {
            inputContainer = this._projectContainer.createDiv({ cls: "project-inputs" });
        }
        inputContainer.empty(); // Clear previous inputs
    
        if (this._projectType === "existing") {
            new Setting(inputContainer)
                .setName("Select Existing Project")
                .addDropdown((dropdown) => {
                    this._projects.forEach((project) => dropdown.addOption(project, project));
                    dropdown.setValue(this._currentProjectName);
                    dropdown.selectEl.classList.add("project-selection-dropdown");
    
                    dropdown.onChange((value) => {
                        this._currentProjectName = value;
                        console.log(`Selected Existing Project: ${value}`);
                    });
                });
        } else {
            new Setting(inputContainer)
                .setName("New Project Name")
                .addText((text) => {
                    text.setPlaceholder("Enter project name...")
                        .setValue(this._currentProjectName)
                        .onChange((value) => {
                            this._currentProjectName = value;
                            console.log(`New Project Name: ${value}`);
                        });
                    text.inputEl.classList.add("project-selection-textbox");
                });
        }
    }    

    // Render Location Section
    private renderLocationSection() {
        this._locationContainer.empty(); // Clear previous content
        this._locationContainer.createEl("h4", { text: "Location" });

        // Create a container for the dropdown
        const dropdownContainer = this._locationContainer.createDiv({ cls: "location-type-container" });

        // Create the dropdown element
        const dropdown = dropdownContainer.createEl("select", { cls: "location-type-dropdown" });

        // Add dropdown options
        const options = [
            { value: "existing", label: "Existing" },
            { value: "new", label: "New" },
        ];

        options.forEach((option) => {
            const opt = dropdown.createEl("option", { text: option.label, value: option.value });
            if (option.value === this._locationType) {
                opt.selected = true;
            }
        });

        // Handle dropdown change
        dropdown.addEventListener("change", (event: Event) => {
            const target = event.target as HTMLSelectElement;
            this._locationType = target.value;
            console.log(`Location type selected: ${this._locationType}`);
            this.renderLocationInputs(); // Re-render inputs below
        });

        this.renderLocationInputs();
    }

    private renderLocationInputs() {
        let inputContainer = this._locationContainer.querySelector(".location-inputs") as HTMLElement;
        if (!inputContainer) {
            inputContainer = this._locationContainer.createDiv({ cls: "location-inputs" });
        }
        inputContainer.empty(); // Clear previous inputs
    
        if (this._locationType === "existing") {
            new Setting(inputContainer)
                .setName("Select Existing Location")
                .addDropdown((dropdown) => {
                    this._locations.forEach((location) => dropdown.addOption(location, location));
                    dropdown.setValue(this._currentLocationName);
                    dropdown.selectEl.classList.add("location-selection-dropdown");
    
                    dropdown.onChange((value) => {
                        this._currentLocationName = value;
                        console.log(`Selected Existing Location: ${value}`);
                    });
                });
        } else {
            new Setting(inputContainer)
                .setName("New Location Name")
                .addText((text) => {
                    text.setPlaceholder("Enter location name...")
                        .setValue(this._currentLocationName)
                        .onChange((value) => {
                            this._currentLocationName = value;
                            console.log(`New Location Name: ${value}`);
                        });
                    text.inputEl.classList.add("location-selection-textbox");
                });
        }
    }

    private renderDepthSection() {
        this._depthContainer.empty(); // Clear previous content
        this._depthContainer.createEl("h4", { text: "Depth" });

        new Setting(this._depthContainer)
                .setName("Depth")
                .setDesc("optional")
                .addText((text) => {
                    text.setPlaceholder("Enter depth...")
                        .setValue(this._currentDepthString)
                        .onChange((value) => {
                            this._currentDepthString = value;
                        });
                    text.inputEl.classList.add("depth-selection-textbox");
                });
    }

    protected onBack(): void {
        console.log("Back button clicked - cancellation.");
        this.triggerCancelled();
    }

    protected async onNext(): Promise<void> {
        // Validation logic
        if (!this._currentProjectName || !this._currentLocationName) {
            new CustomNotice("Please provide Project and Location!", "warning-notice");
            return;
        }

        let currentDepth: number | null = null;
        if (this._currentDepthString) {
            if (utils.isInteger(this._currentDepthString)) {
                currentDepth = Number(this._currentDepthString);
                console.log(`Depth: ${currentDepth}`);
            }
            else {
                new CustomNotice("Please provide valid integer for Depth!", "warning-notice");
                return
            }
        }

        console.log("Proceeding to the next step...");
        console.log(`Project: ${this._currentProjectName}, Location: ${this._currentLocationName}, Depth: ${currentDepth}`);

        this.triggerSuccess({
            project: this._currentProjectName,
            location: this._currentLocationName,
            depth: currentDepth,
        });
    }
}

class FinishWizardPage extends WizardPage {
    private _exportData: ExportData[] = [];

    constructor(parentEl: HTMLElement, animalID: string, exportData: ExportData[]) {
        super(parentEl, animalID, "Cancel", "Finish");

        this._exportData = exportData;
        this.renderPageContent();
    }

    private renderPageContent() {
        const { _containerEl: containerEl } = this;
        containerEl.empty(); // Clear previous content

        const titleEl = containerEl.createEl("h4", { text: "Please click on Finish button." });
        titleEl.classList.add("export-wizard-title");
        const descriptionEl = containerEl.createEl("p", { text: `The number of rows exported will be ${this._exportData.length}.` });

        // Call the parent renderPage to display content and buttons
        this.renderPage([titleEl, descriptionEl], true, true);
    }

    protected onBack(): void {
        console.log("Back button clicked - cancellation.");
        this.triggerCancelled();
    }

    protected async onNext(): Promise<void> {
        // Just trigger success - export is handled in callback.
        this.triggerSuccess();
    }
}