import { Modal, App, Setting, Notice } from "obsidian";
import { ExportData } from "./export-data";

export class ExportWizardModal extends Modal {
    private currentStep: number = 0;
    private _animalID: string;
    private _exportData: ExportData[] = [];
    private _missingSitesIDs: number[] = [];
    private _missingSiteIDsCounter: number = 0;


}