import { Modal, App, Setting, Notice } from "obsidian";
import { ExportData } from "./export-data";
import { queryMissingSites, DBConfig, queryWrongStacksForAnimal, queryWrongExperimentsForAnimal, queryWrongSitesForAnimal } from "db-queries";
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
            new Notice("Animal ID is required.");
            this.close();
            return;
        }
        if (!this._exportData || this._exportData.length === 0) {
            new Notice("Export data is required.");
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
            new Notice("StackIDs, ExpIDs and SiteIDs must be available in export data.");
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

        // Validate stacks, exps and sites belonging to correct animal
        const wrongStackIDs = await queryWrongStacksForAnimal(this._dbConfig, this._animalID, distinctStackIDs);
        const wrongExpIDs = await queryWrongExperimentsForAnimal(this._dbConfig, this._animalID, distinctExpIDs);
        const wrongSiteIDs = await queryWrongSitesForAnimal(this._dbConfig, this._animalID, distinctSiteIDs);

        if ((wrongStackIDs && wrongStackIDs.length > 0)
            || (wrongExpIDs && wrongExpIDs.length > 0)
            || (wrongSiteIDs && wrongSiteIDs.length > 0)
        ) {
            //TODO: Specific notice
            new Notice("Some StackIDs, ExpIDs or SiteIDs are belonging to different animal.");
            this.close();
            return;
        }
        
        // Initialize with step 1
        //this.renderCurrentStep(); //TODO
    }

    async ValidateExportData(): Promise<string | null> {
        let validationResult : string | null = null;



        return validationResult;
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty(); // Clean up modal

        this._resolvePromise(this._result); // Resolve the Promise with the result
    }
}