import { Modal, App, Setting, Notice } from "obsidian";
import { ExportData } from "./export-data";
import { queryMissingSites, DBConfig, queryInvalidStacksForAnimal, queryInvalidExperimentsForAnimal, queryInvalidSitesForAnimal } from "db-queries";
import { ifError } from "assert";

export class ExportWizardModal extends Modal {
    _dbConfig: DBConfig;
    private _resolvePromise: (value: string | null) => void; // Function to resolve the Promise
  	private _result: string | null = null; // To store the result

    private _currentStep: number = 0;
    private _animalID: string;
    private _exportData: ExportData[] = [];
    private _missingSitesIDs: number[] = [];
    private _missingSiteIDsCounter: number = 0;

    constructor(app: App, dbConfig: DBConfig, animalID: string, exportData: ExportData[]) {
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
        this._missingSitesIDs = await queryMissingSites(this._dbConfig, distinctSiteIDs);

        console.log(`Distinct SiteIDs: ${distinctSiteIDs}`);
        console.log(`Missing SiteIDs: ${this._missingSitesIDs}`);

        const validationResult = await this.ValidateExportData(distinctStackIDs, distinctExpIDs, distinctSiteIDs);
        if (validationResult) {
            this._result = validationResult;
            this._resolvePromise(this._result);
            this.close();
            return;
        }


        
        // Initialize with step 1
        //this.renderCurrentStep(); //TODO
    }

    async ValidateExportData(stackIDs: number[], expIDs: number[], siteIDs: number[]): Promise<string> { //Promise<string | null>
        const messages: string[] = [];

        // Check, if provided stackIDs, expIDs and siteIDs (which already exist) are belonging to this animal
        const invalidStackIDs = await queryInvalidStacksForAnimal(this._dbConfig, this._animalID, stackIDs);
        const invalidExpIDs = await queryInvalidExperimentsForAnimal(this._dbConfig, this._animalID, expIDs);
        const invalidSiteIDs = await queryInvalidSitesForAnimal(this._dbConfig, this._animalID, siteIDs);

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

        // Check, if for each missing Site there is corresponding Experiment with same ID
        if (this._missingSitesIDs && this._missingSitesIDs.length > 0) {
            this._missingSitesIDs.forEach(siteID => {
                //TODO
                
            });
        }

        return messages.join("\n");
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty(); // Clean up modal

        this._resolvePromise(this._result); // Resolve the Promise with the result
    }
}