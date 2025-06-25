import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';
import * as yaml from 'js-yaml';
import moment from "moment"; // A namespace-style import cannot be called or constructed, and will cause a failure at runtime.
import * as dbQueries from "./db-queries";
import { ExportData } from "./export-data";
import { ExportWizardModal } from "./export-wizard";
import { CustomNotice } from "./custom-notice";
import * as fs from "fs";
import * as path from "path";

const SERVICE_NAME_ENCRYPTION = "LabBookExpLogSettings";

interface LabBookExpLogSettings {
	// Basic DB settings
	dbType: "mssql" | "postgres";
	dbUser: string;
  	dbPassword: string;
  	dbServer: string;
	dbPort?: number;
  	dbName: string;

	// Security DB settings
	dbEncrypt: boolean; // mssql: encrypt; pg: ssl: true/false
	dbTrustServerCertificate: boolean; // mssql: trustServerCert; pg: ssl.rejectUnauthorized = !this

	// Input formats
	inputDateFormat: string;
	inputTimeFormat: string;

	// Other
	defaultLightCycle: string;
}

const DEFAULT_SETTINGS: LabBookExpLogSettings = {
	dbType: "mssql",
	dbUser: '',
  	dbPassword: '',
  	dbServer: 'localhost',
	dbPort: undefined,
  	dbName: 'ExpLog',
	dbEncrypt: false,
	dbTrustServerCertificate: true,
	inputDateFormat: "YYYY-MM-DD",
	inputTimeFormat: "HH:mm",
	defaultLightCycle: "20:00 – 8:00 CEST lights on"
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
	_keytar: typeof import("keytar") | null = null;

	public async onload() {
		// Resolve the plugin root directory
        const vaultBasePath = (this.app.vault.adapter as any).basePath;
        const pluginRoot = path.join(vaultBasePath, ".obsidian/plugins/labbook-explog-fmi");
        const keytarPath = path.join(pluginRoot, "node_modules/keytar/build/Release/keytar.node");

        console.log("Vault Base Path:", vaultBasePath);
        console.log("Plugin Root:", pluginRoot);
        console.log("Keytar Path:", keytarPath);

        // Load keytar first (used below when loading settings)
        if (fs.existsSync(keytarPath)) {
            try {
                this._keytar = require(keytarPath);
                console.log("Keytar loaded successfully:", this._keytar);
            } catch (error) {
                console.error("Failed to load keytar:", error);
                this._keytar = null;
            }
        } else {
            console.error("Keytar.node file not found at:", keytarPath);
        }

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

	public onunload() {

	}

	private async savePassword(username: string, password: string): Promise<void> {
		await this._keytar!.setPassword(SERVICE_NAME_ENCRYPTION, username, password);
	}
	
	private async getPassword(username: string): Promise<string | null> {
		return await this._keytar!.getPassword(SERVICE_NAME_ENCRYPTION, username);
	}

	@catchLabBookExpLogPluginErrors
	private async loadSettings() {
		// Improved by casting and better null handling (might be undefined/null)
		//this._settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		const loaded = (await this.loadData()) as Partial<LabBookExpLogSettings> || {};
		this._settings = Object.assign({}, DEFAULT_SETTINGS, loaded);
		if (this._keytar && this._settings.dbUser) {
			const password = await this.getPassword(this._settings.dbUser);
			if (password) {
				this._settings.dbPassword = password;
			}
		}
	}

	@catchLabBookExpLogPluginErrors
	public async saveSettings() {
		const password = this._settings.dbPassword;
		if (this._keytar && password) {
			if (this._settings.dbUser) {
				// Persist password with keytar for specific user
				await this.savePassword(this._settings.dbUser, password);
			}
			else {
				new CustomNotice("Database Password has not been saved!\nIt is only persisted together with the Database User.", "warning-notice");
			}
			this._settings.dbPassword = ""; // Reset (only persisted by keytar)
		}

		await this.saveData(this._settings);
		if (this._keytar && password) {
			// Keep password in memory only
			this._settings.dbPassword = password;
		}

		await this.updateDBConfig();
	}

	private async updateDBConfig() {
		this._dbConfig = {
		  dbType: this._settings.dbType,
		  user: this._settings.dbUser || "",
		  password: this._settings.dbPassword || "",
		  server: this._settings.dbServer || "",
		  port: this._settings.dbPort || undefined,
		  database: this._settings.dbName || "",
		  encrypt: this._settings.dbEncrypt ?? true,
		  trustServerCertificate: this._settings.dbTrustServerCertificate ?? true,
		};
	
		// Validate the configuration
		if (!this._dbConfig.user || !this._dbConfig.password || !this._dbConfig.server) {
			new Notice("DB Config is incomplete. Ensure all required settings are provided.");
		}
	}

	@catchLabBookExpLogPluginErrors
	private async createExpLogTable() {
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
		const headersV2 = this.getExpLogTableHeadersV2();

		const fileContent = await this.app.vault.read(file);

		// Check if any matching table already exists (with headersV2)
		if (this.matchingTableExist(fileContent, headersV2)) {
			new Notice("A table with matching headers already exists in this file.");
			return;
		}

		// There might be table with "old" headers (missing Paradigm)
		if (this.matchingTableExist(fileContent, headers)) {
			// Adapt the table to include the missing "Paradigm" column
			const updatedContent = this.adaptTable(fileContent, headers, headersV2);
			await this.app.vault.modify(file, updatedContent);
			new Notice("Existing table updated to match new schema (with Paradigm).");
			return;
		}
	  
		// Create and insert the table
		const newTable = this.generateTableWithHeaders(headersV2);
		await this.insertTableIntoFile(file, fileContent, newTable);
	}

	@catchLabBookExpLogPluginErrors
	private async exportExpLogData() {
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

			const exportModal = new ExportWizardModal(this.app, this._dbConfig, this._settings.defaultLightCycle, animalID, actualExportData); //TODO
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

	private async updateYamlMetadata(file: TFile, newMetadata: Record<string, any>): Promise<void> {
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

	private async parseYaml(content: string): Promise<Record<string, any>> {
		try {
		  return yaml.load(content) as Record<string, any>;
		} catch (err) {
		  console.error("Failed to parse YAML:", err);
		  return {};
		}
	}
	  
	private async stringifyYaml(data: Record<string, any>): Promise<string> {
		try {
		  return yaml.dump(data);
		} catch (err) {
		  console.error("Failed to stringify YAML:", err);
		  return "";
		}
	}
	
	private matchingTableExist(content: string, headers: string[]): boolean {
		const headerRegex = new RegExp(
		  `\\|\\s*${headers.join("\\s*\\|\\s*")}\\s*\\|`
		);
		return headerRegex.test(content);
	}
	
	private getExpLogTableHeaders(): string[] {
		return ["Date", "Time", "StackID", "ExpID", "SiteID", "Comment"];
	}

	private getExpLogTableHeadersV2(): string[] { 
		return ["Date", "Time", "StackID", "ExpID", "SiteID", "Paradigm", "Comment"]; 
	}
	
	private generateTableWithHeaders(headers: string[]): string {
		const headerRow = `| ${headers.join(" | ")} |`;
		const separatorRow = `| ${headers.map(() => "---").join(" | ")} |`;
	  
		// Generate a blank row below the headers
		const blankRow = `| ${headers.map(() => " ").join(" | ")} |`;
	  
		return `${headerRow}\n${separatorRow}\n${blankRow}`;
	}
	
	private adaptTable(content: string, headersOld: string[], headersNew: string[]): string {
		const lines = content.split("\n");
	
		// Step 1: Find the header row that matches headersOld
		const headerRegex = new RegExp(`\\|\\s*${headersOld.join("\\s*\\|\\s*")}\\s*\\|`);
		let headerIndex = lines.findIndex(line => headerRegex.test(line));
		if (headerIndex === -1) return content; // No matching table found
	
		// Step 2: Compute the new column order and mapping
		let newHeaderOrder: string[] = [];
		let columnMapping: Map<number, number> = new Map(); // Old column index → New index
	
		let oldColIdx = 0, newColIdx = 0;
		while (newColIdx < headersNew.length) {
			if (oldColIdx < headersOld.length && headersOld[oldColIdx] === headersNew[newColIdx]) {
				columnMapping.set(oldColIdx, newColIdx); // Keep existing columns mapped
				newHeaderOrder.push(headersOld[oldColIdx]);
				oldColIdx++;
			} else {
				// This is a new column being inserted
				newHeaderOrder.push(headersNew[newColIdx]);
			}
			newColIdx++;
		}
	
		// Step 3: Replace the header row and separator row
		lines[headerIndex] = `| ${newHeaderOrder.join(" | ")} |`;
		if (lines.length > headerIndex + 1) {
			lines[headerIndex + 1] = `| ${newHeaderOrder.map(() => "---").join(" | ")} |`;
		}
	
		// Step 4: Update each row, ensuring existing values stay in their correct columns
		for (let i = headerIndex + 2; i < lines.length; i++) {
			// Skip lines that don't look like table rows
			if (!lines[i].trim().startsWith("|") || !lines[i].trim().endsWith("|")) {
				continue;
			}
	
			// Strip off leading/trailing bars and trim cells
			let oldCells = lines[i].trim().split("|").slice(1, -1).map(cell => cell.trim());
			if (oldCells.length !== headersOld.length) {
				// If malformed or doesn't match old header count, skip or handle differently
				continue;
			}
	
			// Create a new row with empty placeholders for the new columns
			let newRow = new Array(newHeaderOrder.length).fill("");
	
			// Move data from old columns to new columns
			columnMapping.forEach((newIndex, oldIndex) => {
				newRow[newIndex] = oldCells[oldIndex];
			});
	
			lines[i] = `| ${newRow.join(" | ")} |`;
		}
	
		return lines.join("\n");
	}
	
	private async insertTableIntoFile(file: TFile, content: string, table: string) {
		const updatedContent = `${content}\n\n${table}`;
		await this.app.vault.modify(file, updatedContent);
	}

	private async extractExpLogData(): Promise<ExportData[]> {
		const file = this.app.workspace.getActiveFile();
		if (!file) {
		  new Notice("No active file.");
		  return[];
		}

		const headers = this.getExpLogTableHeadersV2();
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
					data.paradigm = row["Paradigm"];
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
	
	private async extractTableData(content: string, headers: string[]): Promise<{ [key: string]: string }[]> {
		// Create a regex to match the table headers
		const headerRegex = new RegExp(
		  `^\\|\\s*${headers.join("\\s*\\|\\s*")}\\s*(\\|.*)?\\|\\s*$`,
		  "m"
		);

		// Find the header row in the content
		const headerMatch = content.match(headerRegex);
		if (!headerMatch) {
		  new CustomNotice("A table with matching headers cannot be found.\n\nPlease add ExpLog table (existing table with older headers will be automatically updated).", "error-notice");
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
			.setName("Database Type")
			.addDropdown((dropdown) => {
				dropdown
				.addOption("mssql", "MSSQL")
				.addOption("postgres", "PostgreSQL")
				.setValue(this._plugin._settings.dbType)
				.onChange(async (value) => {
					this._plugin._settings.dbType = value as "mssql" | "postgres";
					await this._plugin.saveSettings();
				});
		});

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
			.setName("Port (optional)")
			.setDesc("Leave blank to use the default (1433 for MSSQL, 5432 for PostgreSQL)")
			.addText(text => {
				text
				//.setPlaceholder("1433")
				.setValue(this._plugin._settings.dbPort?.toString() ?? "")
				.onChange(async (value) => {
					// If blank or non‐numeric, treat as undefined
					const num = parseInt(value.trim(), 10);
					this._plugin._settings.dbPort = isNaN(num) || num <= 0 ? undefined : num;
					await this._plugin.saveSettings();

					if(value && (isNaN(num) || num <= 0)) {
						new Notice("Port has been reset - not a valid number.");
					}
				});
			});

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
			.setName('Encrypt (SSL)')
			.addToggle(text => text
				.setValue(this._plugin._settings.dbEncrypt)
				.onChange(async (value) => {
					this._plugin._settings.dbEncrypt = value;
					await this._plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Trust Server Certificate (Skip Validation)')
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

		new Setting(containerEl)
			.setName('Default Light Cycle')
			.addText(text => text
				//.setPlaceholder('8:00 – 20:00 CET')
				.setValue(this._plugin._settings.defaultLightCycle)
				.onChange(async (value) => {
				this._plugin._settings.defaultLightCycle = value;
				await this._plugin.saveSettings();
				}));
	}
}