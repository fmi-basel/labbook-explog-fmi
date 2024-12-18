import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';
import * as yaml from 'js-yaml';
import moment from "moment"; // A namespace-style import cannot be called or constructed, and will cause a failure at runtime.
import * as dbQueries from "./db-queries";
import { ExportData } from "./export-data";
import { ExportWizardModal } from "./export-wizard";
import { CustomNotice } from "./custom-notice";

interface LabBookExpLogSettings {
	dbUser: string;
  	dbPassword: string;
  	dbServer: string;
  	dbName: string;
	dbEncrypt: boolean;
	dbTrustServerCertificate: boolean;
	inputDateFormat: string;
	inputTimeFormat: string;
}

const DEFAULT_SETTINGS: LabBookExpLogSettings = {
	dbUser: '',
  	dbPassword: '',
  	dbServer: 'localhost',
  	dbName: 'ExpLog',
	dbEncrypt: false,
	dbTrustServerCertificate: true,
	inputDateFormat: "YYYY-MM-DD",
	inputTimeFormat: "HH:mm"
}

function catchLabBookExpLogPluginErrors(target: any, propertyKey: string, descriptor: PropertyDescriptor): void {
	const originalMethod = descriptor.value;

	descriptor.value = async function (...args: any[]) {
		try {
			await originalMethod.apply(this, args);
		} catch (error) {
			console.error(`Error in ${propertyKey}:`, error);
			new Notice(`An error occurred: ${error.message}`);
		}
	};
}

export default class LabBookExpLogPlugin extends Plugin {
	_settings: LabBookExpLogSettings;
	_dbConfig: dbQueries.DBConfig;

	async onload() {
		await this.loadSettings();
		await this.updateDBConfig();

		this.addRibbonIcon("table", "Add ExpLog Table", async () => {
			await this.createExpLogTable();
		  }).addClass("my-addtable-icon");

		this.addRibbonIcon("database", "Export ExpLog Database", async () => {
			await this.exportExpLogData();
		  }).addClass("my-exportdatabase-icon");

		this.addSettingTab(new LabBookSettingTab(this.app, this));
	}

	onunload() {

	}

	@catchLabBookExpLogPluginErrors
	async loadSettings() {
		this._settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	@catchLabBookExpLogPluginErrors
	async saveSettings() {
		await this.saveData(this._settings);
		await this.updateDBConfig();
	}

	private async updateDBConfig() {
		this._dbConfig = {
		  user: this._settings.dbUser || "",
		  password: this._settings.dbPassword || "",
		  server: this._settings.dbServer || "",
		  database: this._settings.dbName || "",
		  encrypt: this._settings.dbEncrypt ?? true,
		  trustServerCertificate: this._settings.dbTrustServerCertificate ?? true,
		};
	
		// Optional: Validate the configuration
		if (!this._dbConfig.user || !this._dbConfig.password || !this._dbConfig.server) {
			new Notice("DB Config is incomplete. Ensure all required settings are provided.");
		}
	}

	@catchLabBookExpLogPluginErrors
	async createExpLogTable() {
		const file = this.app.workspace.getActiveFile();
		if (!file) {
		  new Notice("No active file to insert the table.");
		  return;
		}

		// Check/get AnimalID from metadata
		const metadata = this.app.metadataCache.getFileCache(file);
		if (!metadata?.frontmatter?.AnimalID) {
			const modal = new QueryAnimalModal(this.app, this._dbConfig, this);
			const animalID = await modal.openWithPromise();
			if (animalID) {
				await this.updateYamlMetadata(file, { AnimalID: animalID });
			} else {
				new Notice("No animal selected.");
				return;
			}
		}

		// Define table headers
		const headers = this.getExpLogTableHeaders();

		const fileContent = await this.app.vault.read(file);

		// Check if any matching table already exists
		if (this.matchingTableExist(fileContent, headers)) {
			new Notice("A table with matching headers already exists in this file.");
			return;
		}
	  
		// Create and insert the table
		const newTable = this.generateTableWithHeaders(headers);
		await this.insertTableIntoFile(file, fileContent, newTable);
	}

	@catchLabBookExpLogPluginErrors
	async exportExpLogData() {
		try {
			const file = this.app.workspace.getActiveFile();
			if (!file) {
				new CustomNotice("No active file to export data.", "warning-notice");
				return;
			}

			// Check/get AnimalID from metadata
			let animalID: string | null = null;
			const metadata = this.app.metadataCache.getFileCache(file);
			if (!metadata?.frontmatter?.AnimalID) {
				const modal = new QueryAnimalModal(this.app, this._dbConfig, this);
				animalID = await modal.openWithPromise();
				if (animalID) {
					await this.updateYamlMetadata(file, { AnimalID: animalID });
				} else {
					new CustomNotice("No animal selected.", "warning-notice");
					return;
				}
			}
			else {
				animalID = metadata.frontmatter.AnimalID as string;
			}

			if (!animalID) {
				new CustomNotice("No AnimalID found in properties.", "warning-notice");
				return;
			}

			const animalExists = await dbQueries.existsAnimal(this._dbConfig, animalID);
			if (!animalExists) {
				new CustomNotice("Animal not found in database.", "warning-notice");
				return;
			}

			// Some initial validations
			const exportData = await this.extractExpLogData();
			if (!exportData || exportData.length === 0) {
				new CustomNotice("No data to be exported.", "warning-notice");
				return;
			}
			
			const hasInvalidData = exportData.some(p => p.isInvalid());
			if (hasInvalidData) {
				const invalidRows: string[] = [];
				for (let i = 0; i < exportData.length; i++) {
					const data = exportData[i];
					if (data.isInvalid()) {
						invalidRows.push(data.position.toString());
					}
				}
				const invalidRowsOutput = invalidRows.join(", ");
				new CustomNotice(`There is invalid data!\n\nPlease make sure to provide correct data for Date, Time, StackID, ExpID and SiteID. Empty rows are skipped by default.\n\nRows: ${invalidRowsOutput}`, "warning-notice");
				return;
			}

			const hasIncompleteData = exportData.some(p => !p.isComplete());
			if (hasIncompleteData) {
				const incompleteRows: string[] = [];
				for (let i = 0; i < exportData.length; i++) {
					const data = exportData[i];
					if (!data.isComplete()) {
						incompleteRows.push(data.position.toString());
					}
				}
				const incompleteRowsOutput = incompleteRows.join(", ");
				new CustomNotice(`There is incomplete data!\n\nPlease make sure to provide Date, Time, StackID, ExpID and SiteID. Empty rows are skipped by default.\n\nRows: ${incompleteRowsOutput}`, "warning-notice");
				return;
			}

			const actualExportData = exportData.filter(p => !p.isEmpty());
			if (!actualExportData || actualExportData.length === 0) {
				new CustomNotice("No data to be exported.", "warning-notice");
				return;
			}

			console.log(`Actual ExportData: ${actualExportData}`);

			const exportModal = new ExportWizardModal(this.app, this._dbConfig, animalID, actualExportData);
			const errorResult = await exportModal.openWithPromise();
			if (!errorResult) {
				new CustomNotice(`Data for '${animalID}' has been exported successfully.`, "success-notice");
			}
			else {
				new CustomNotice(`Sorry, data for '${animalID}' has not been exported.`, "warning-notice");
				new CustomNotice(errorResult, "error-notice", 10000);
			}
		}
		catch (err) {
			console.error("Failed to export:", err);
			new CustomNotice(err.message, "error-notice");
		}
	}

	async updateYamlMetadata(file: TFile, newMetadata: Record<string, any>): Promise<void> {
		const content = await this.app.vault.read(file);
	  
		// Extract existing YAML front matter
		const frontMatterRegex = /^---\n([\s\S]*?)\n---/;
		const match = frontMatterRegex.exec(content);
	  
		const existingMetadata = match ? await this.parseYaml(match[1]) : {};
	  
		// Merge new metadata with existing metadata
		const updatedMetadata = { ...existingMetadata, ...newMetadata };
		const updatedYaml = `---\n${await this.stringifyYaml(updatedMetadata)}\n---`;
	  
		// Replace or prepend YAML front matter
		const updatedContent = match
		  ? content.replace(frontMatterRegex, updatedYaml)
		  : `${updatedYaml}\n\n${content}`;
	  
		await this.app.vault.modify(file, updatedContent);
	}

	async parseYaml(content: string): Promise<Record<string, any>> {
		try {
		  return yaml.load(content) as Record<string, any>;
		} catch (err) {
		  console.error("Failed to parse YAML:", err);
		  return {};
		}
	}
	  
	async stringifyYaml(data: Record<string, any>): Promise<string> {
		try {
		  return yaml.dump(data);
		} catch (err) {
		  console.error("Failed to stringify YAML:", err);
		  return "";
		}
	}
	
	matchingTableExist(content: string, headers: string[]): boolean {
		const headerRegex = new RegExp(
		  `\\|\\s*${headers.join("\\s*\\|\\s*")}\\s*\\|`
		);
		return headerRegex.test(content);
	}
	
	getExpLogTableHeaders(): string[] {
		return ["Date", "Time", "StackID", "ExpID", "SiteID", "Comment"];
	}
	
	generateTableWithHeaders(headers: string[]): string {
		const headerRow = `| ${headers.join(" | ")} |`;
		const separatorRow = `| ${headers.map(() => "---").join(" | ")} |`;
	  
		// Generate a blank row below the headers
		const blankRow = `| ${headers.map(() => " ").join(" | ")} |`;
	  
		return `${headerRow}\n${separatorRow}\n${blankRow}`;
	}		  
	
	async insertTableIntoFile(file: TFile, content: string, table: string) {
		const updatedContent = `${content}\n\n${table}`;
		await this.app.vault.modify(file, updatedContent);
	}

	async extractExpLogData(): Promise<ExportData[]> {
		const file = this.app.workspace.getActiveFile();
		if (!file) {
		  new Notice("No active file.");
		  return[];
		}

		const headers = this.getExpLogTableHeaders();
		const fileContent = await this.app.vault.read(file);

		let spinner = null;
		try {
			// Configure spinner
			const mainElement = this.app.workspace.containerEl;
			spinner = this.showSpinner(mainElement);

			const tableData = await this.extractTableData(fileContent, headers);
			if (tableData && tableData.length > 0) {
				const dateFormat = this._settings.inputDateFormat + " " + this._settings.inputTimeFormat;

				let exportDataArray: ExportData[] = [];
				let position = 1;
				tableData.forEach(row => {
					let data = new ExportData(position);
					position++;

					data.origStringLogDate = row["Date"];
					data.origStringLogTime = row["Time"];
					data.origStringStackID = row["StackID"];
					data.origStringExpID = row["ExpID"];
					data.origStringSiteID = row["SiteID"];
					data.comment = row["Comment"];

					if (data.origStringLogDate && data.origStringLogTime) {
						var dateInput = data.origStringLogDate + " " + data.origStringLogTime;
						const dateParsed = moment(dateInput, dateFormat, true); // 'true' ensures strict parsing
						if (dateParsed.isValid()) {
							data.logDateTime = dateParsed.toDate();
						}
					}

					if (data.origStringStackID) {
						const num = parseInt(data.origStringStackID, 10);
						if (!isNaN(num)) {
							data.stackID = num;
						}
					}

					if (data.origStringExpID) {
						const num = parseInt(data.origStringExpID, 10);
						if (!isNaN(num)) {
							data.expID = num;
						}
					}

					if (data.origStringSiteID) {
						const num = parseInt(data.origStringSiteID, 10);
						if (!isNaN(num)) {
							data.siteID = num;
						}
					}

					if (!data.isEmpty()) {
						exportDataArray.push(data);
					}
				});

				return exportDataArray;
			}
		}
		finally {
			// Reset spinner
			if (spinner) {
			  this.hideSpinner(spinner);
			}
		}

		return[];
	}
	  
	async extractTableData(content: string, headers: string[]): Promise<{ [key: string]: string }[]> {
		// Create a regex to match the table headers
		const headerRegex = new RegExp(
		  `^\\|\\s*${headers.join("\\s*\\|\\s*")}\\s*(\\|.*)?\\|\\s*$`,
		  "m"
		);
	  
		// Find the header row in the content
		const headerMatch = content.match(headerRegex);
		if (!headerMatch) {
		  return []; // No matching header found
		}
	  
		// Find the position of the matching header
		const headerLine = headerMatch.index!;
		const tableContent = content.substring(headerLine);
	  
		// Split the table into lines
		const lines = tableContent.split("\n");
	  
		// Verify the second line is the separator (e.g., | --- | --- |)
		const separatorRegex = new RegExp(
		  `^\\|\\s*${headers.map(() => "-+").join("\\s*\\|\\s*")}\\s*(\\|.*)?\\|\\s*$`
		);
		if (!separatorRegex.test(lines[1])) {
		  return []; // No valid table separator found
		}
	  
		// Extract rows below the header and separator
		const dataRows: { [key: string]: string }[] = [];
		for (let i = 2; i < lines.length; i++) {
		  const row = lines[i].trim();
		  if (!row || !row.startsWith("|") || !row.endsWith("|")) {
			break; // Stop when no more valid table rows are found
		  }
	  
		  // Split the row into cells
		  const cells = row.split("|").map((cell) => cell.trim());
	  
		  // Ensure that there are at least as many cells as the number of headers
		  if (cells.length - 2 < headers.length) {
			continue;
		  }
	  
		  // Map only the cells corresponding to the headers
		  const rowData: { [key: string]: string } = {};
		  headers.forEach((header, index) => {
			rowData[header] = cells[index + 1] || ""; // Use an empty string if the cell is missing
		  });
	  
		  dataRows.push(rowData);
		}
	  
		return dataRows;
	}

	showSpinner(containerEl: HTMLElement): HTMLElement {
		const spinner = containerEl.createDiv({ cls: "loading-spinner" });
		return spinner;
	}
	
	hideSpinner(spinner: HTMLElement) {
		spinner.remove();
	}
}

class QueryAnimalModal extends Modal {
	_plugin: LabBookExpLogPlugin;
	_dbConfig: dbQueries.DBConfig
	private _resolvePromise: (value: string | null) => void; // Function to resolve the Promise
  	private _result: string | null = null; // To store the result
	private _animalDropdown: any; // Used for referencing by the other dropdown (PI)
	
	constructor(app: App, dbConfig: dbQueries.DBConfig, plugin: LabBookExpLogPlugin) {
	  super(app);
	  this._dbConfig = dbConfig;
	  this._plugin = plugin;
	}

	// Method to open the modal and return a Promise
	openWithPromise(): Promise<string | null> {
		return new Promise((resolve) => {
			this._resolvePromise = resolve; // Store the resolve function
			this.open();
		});
	}

	onOpen() {
	  const { contentEl } = this;
	  const modalContainer = contentEl.parentElement;
	  if (modalContainer) {
		modalContainer.addClass("my-queryanimal-modal");
	  }

	  contentEl.createEl('h2', { text: 'Search Animal' });

	  new Setting(contentEl)
		.setName("PI")
		//.setDesc("Choose a PI from the list")
		.addDropdown(async (dropdown) => {
			dropdown.addOption("", "Please select");
			
			try {
				// Fetch the list of PIs
				const piList = await dbQueries.queryPIs(this._dbConfig);

				// Populate the dropdown with PIs
				if (piList) {
					piList.forEach((pi) => {
						dropdown.addOption(pi, pi);
					});
				}
			
			} catch (err) {
				console.error("Failed to load PIs:", err);
				dropdown.addOption("error", "Error loading PIs");
				new CustomNotice(err.message, "error-notice");
			}

			// Handle dropdown value change
			dropdown.onChange(async (value) => {
				if (value) {
					console.log(`Selected PI: ${value}`);
					const animalIDList = await dbQueries.queryAnimals(this._dbConfig, value);

					// Reset and populate the second dropdown
					this._animalDropdown.selectEl.innerHTML = ""; // Clear previous options
					this._animalDropdown.addOption("", "Please select");
					animalIDList.forEach((animalID) => {
						this._animalDropdown.addOption(animalID, animalID);
					});
				} else {
					console.log("No PI selected.");
					// Reset the second dropdown
					this._animalDropdown.selectEl.innerHTML = ""; // Clear all options
					this._animalDropdown.addOption("", "Please select");
				}
			});
		});

	new Setting(contentEl)
		.setName("Animal")
		.addDropdown(async (dropdown) => {
			dropdown.addOption("", "Please select");
			this._animalDropdown = dropdown; // Assign for easy reference

			// Handle dropdown value change
			dropdown.onChange(async (value) => {
				if (value) {
					console.log(`Selected Animal: ${value}`);
					this._result = value;
				} else {
					console.log("No Animal selected.");
					this._result = null;
				}
			});
		});

	new Setting(contentEl)
		.addButton(button => {
			button
			.setButtonText('Select')
			.setCta()
			.onClick(async () => {
				// Check if this.result` is set
				if (!this._result) {
					new Notice("Please select an animal before proceeding, or cancel by closing this window.");
					return; // Prevent closing the modal
				}

				this.close();
			});
		});
	}
  
	onClose() {
	  const { contentEl } = this;
	  contentEl.empty(); // Clean up modal

	  this._resolvePromise(this._result); // Resolve the Promise with the result
	}
  }

class LabBookSettingTab extends PluginSettingTab {
	_plugin: LabBookExpLogPlugin;

	constructor(app: App, plugin: LabBookExpLogPlugin) {
		super(app, plugin);
		this._plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		containerEl.createEl('h2', { text: 'Database Settings' });

		new Setting(containerEl)
			.setName('Database Server')
			.addText(text => text
				.setPlaceholder('localhost')
				.setValue(this._plugin._settings.dbServer)
				.onChange(async (value) => {
				this._plugin._settings.dbServer = value;
				await this._plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Database Name')
			.addText(text => text
				.setPlaceholder('ExpLog')
				.setValue(this._plugin._settings.dbName)
				.onChange(async (value) => {
				this._plugin._settings.dbName = value;
				await this._plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Database User')
			.addText(text => text
				.setPlaceholder('dbuser')
				.setValue(this._plugin._settings.dbUser)
				.onChange(async (value) => {
				this._plugin._settings.dbUser = value;
				await this._plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Database Password')
			.addText(text => {
				text
					.setPlaceholder('password')
					.setValue(this._plugin._settings.dbPassword)
					.onChange(async (value) => {
						this._plugin._settings.dbPassword = value;
						await this._plugin.saveSettings();
					});
				
				// Set the input type to 'password' to mask the input
				text.inputEl.setAttribute('type', 'password');
			});

		new Setting(containerEl)
			.setName('Encrypt')
			.addToggle(text => text
				.setValue(this._plugin._settings.dbEncrypt)
				.onChange(async (value) => {
				this._plugin._settings.dbEncrypt = value;
				await this._plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Trust Server Certificate')
			.addToggle(text => text
				.setValue(this._plugin._settings.dbTrustServerCertificate)
				.onChange(async (value) => {
				this._plugin._settings.dbTrustServerCertificate = value;
				await this._plugin.saveSettings();
				}));

		containerEl.createEl('h2', { text: 'Other Settings' });

		new Setting(containerEl)
			.setName('Input Date Format')
			.addText(text => text
				.setPlaceholder('YYYY-MM-DD')
				.setValue(this._plugin._settings.inputDateFormat)
				.onChange(async (value) => {
				this._plugin._settings.inputDateFormat = value;
				await this._plugin.saveSettings();
				}));

		new Setting(containerEl)
		.setName('Input Time Format')
		.addText(text => text
			.setPlaceholder('HH:mm')
			.setValue(this._plugin._settings.inputTimeFormat)
			.onChange(async (value) => {
			this._plugin._settings.inputTimeFormat = value;
			await this._plugin.saveSettings();
			}));
	}
}