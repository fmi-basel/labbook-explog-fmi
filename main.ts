import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';
import * as yaml from 'js-yaml';
import moment from "moment"; // A namespace-style import cannot be called or constructed, and will cause a failure at runtime.
import { queryPIs, queryAnimals, DBConfig } from "./db-queries";
import { ExportData } from "./export-data";

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

export default class LabBookExpLogPlugin extends Plugin {
	settings: LabBookExpLogSettings;
	dbConfig: DBConfig;

	async onload() {
		await this.loadSettings();
		await this.updateDBConfig();

		this.addRibbonIcon("table", "Add ExpLog Table", async () => {
			await this.createExpLogTable();
		  }).addClass("my-addtable-icon");

		this.addRibbonIcon("database", "Export ExpLog Database", async () => {
			const extractData = await this.extractExpLogData();
			
			//TODO
			console.log(extractData);

		  }).addClass("my-exportdatabase-icon");

		this.addSettingTab(new LabBookSettingTab(this.app, this));
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		await this.updateDBConfig();
	}

	private async updateDBConfig() {
		this.dbConfig = {
		  user: this.settings.dbUser || "",
		  password: this.settings.dbPassword || "",
		  server: this.settings.dbServer || "",
		  database: this.settings.dbName || "",
		  encrypt: this.settings.dbEncrypt ?? true,
		  trustServerCertificate: this.settings.dbTrustServerCertificate ?? true,
		};
	
		// Optional: Validate the configuration
		if (!this.dbConfig.user || !this.dbConfig.password || !this.dbConfig.server) {
			new Notice("DB Config is incomplete. Ensure all required settings are provided.");
		}
	}

	async createExpLogTable() {
		const file = this.app.workspace.getActiveFile();
		if (!file) {
		  new Notice("No active file to insert the table.");
		  return;
		}

		// Check/get AnimalID from metadata
		const metadata = this.app.metadataCache.getFileCache(file);
		if (!metadata?.frontmatter?.AnimalID) {
			const modal = new QueryAnimalModal(this.app, this.dbConfig, this);
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
		} catch (e) {
		  console.error("Failed to parse YAML:", e);
		  return {};
		}
	  }
	  
	  async stringifyYaml(data: Record<string, any>): Promise<string> {
		try {
		  return yaml.dump(data);
		} catch (e) {
		  console.error("Failed to stringify YAML:", e);
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
				const dateFormat = this.settings.inputDateFormat + " " + this.settings.inputTimeFormat;

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
	plugin: LabBookExpLogPlugin;
	dbConfig: DBConfig
	private resolvePromise: (value: string | null) => void; // Function to resolve the Promise
  	private result: string | null = null; // To store the result
	private animalDropdown: any; // Used for referencing by the other dropdown (PI)
	
	constructor(app: App, dbConfig: DBConfig, plugin: LabBookExpLogPlugin) {
	  super(app);
	  this.dbConfig = dbConfig;
	  this.plugin = plugin;
	}

	// Method to open the modal and return a Promise
	openWithPromise(): Promise<string | null> {
		return new Promise((resolve) => {
		  this.resolvePromise = resolve; // Store the resolve function
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
				const piList = await queryPIs(this.dbConfig);

				// Populate the dropdown with PIs
				if (piList) {
					piList.forEach((pi) => {
						dropdown.addOption(pi, pi);
					});
				}
			
			} catch (err) {
				console.error("Failed to load PIs:", err);
				dropdown.addOption("error", "Error loading PIs");
				new Notice(err.message); 
			}

			// Handle dropdown value change
			dropdown.onChange(async (value) => {
				if (value) {
					console.log(`Selected PI: ${value}`);
					const animalIDList = await queryAnimals(this.dbConfig, value);

					// Reset and populate the second dropdown
					this.animalDropdown.selectEl.innerHTML = ""; // Clear previous options
					this.animalDropdown.addOption("", "Please select");
					animalIDList.forEach((animalID) => {
						this.animalDropdown.addOption(animalID, animalID);
					});
				} else {
					console.log("No PI selected.");
					// Reset the second dropdown
					this.animalDropdown.selectEl.innerHTML = ""; // Clear all options
					this.animalDropdown.addOption("", "Please select");
				}
			});
		});

	new Setting(contentEl)
		.setName("Animal")
		.addDropdown(async (dropdown) => {
			dropdown.addOption("", "Please select");
			this.animalDropdown = dropdown; // Assign for easy reference

			// Handle dropdown value change
			dropdown.onChange(async (value) => {
				if (value) {
					console.log(`Selected Animal: ${value}`);
					this.result = value;
				} else {
					console.log("No Animal selected.");
					this.result = null;
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
				if (!this.result) {
					new Notice("Please select an animal before proceeding, or cancel by closing this window.");
					return; // Prevent closing the modal
				}

				this.close();
			});
		});
	}
  
	onClose() {
	  const { contentEl } = this;
	  contentEl.empty();

	  this.resolvePromise(this.result); // Resolve the Promise with the result
	}
  }

class LabBookSettingTab extends PluginSettingTab {
	plugin: LabBookExpLogPlugin;

	constructor(app: App, plugin: LabBookExpLogPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		containerEl.createEl('h2', { text: 'Database Settings' });

		new Setting(containerEl)
			.setName('Database Server')
			.addText(text => text
				.setPlaceholder('localhost')
				.setValue(this.plugin.settings.dbServer)
				.onChange(async (value) => {
				this.plugin.settings.dbServer = value;
				await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Database Name')
			.addText(text => text
				.setPlaceholder('ExpLog')
				.setValue(this.plugin.settings.dbName)
				.onChange(async (value) => {
				this.plugin.settings.dbName = value;
				await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Database User')
			.addText(text => text
				.setPlaceholder('dbuser')
				.setValue(this.plugin.settings.dbUser)
				.onChange(async (value) => {
				this.plugin.settings.dbUser = value;
				await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Database Password')
			.addText(text => {
				text
					.setPlaceholder('password')
					.setValue(this.plugin.settings.dbPassword)
					.onChange(async (value) => {
						this.plugin.settings.dbPassword = value;
						await this.plugin.saveSettings();
					});
				
				// Set the input type to 'password' to mask the input
				text.inputEl.setAttribute('type', 'password');
			});

		new Setting(containerEl)
			.setName('Encrypt')
			.addToggle(text => text
				.setValue(this.plugin.settings.dbEncrypt)
				.onChange(async (value) => {
				this.plugin.settings.dbEncrypt = value;
				await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Trust Server Certificate')
			.addToggle(text => text
				.setValue(this.plugin.settings.dbTrustServerCertificate)
				.onChange(async (value) => {
				this.plugin.settings.dbTrustServerCertificate = value;
				await this.plugin.saveSettings();
				}));

		containerEl.createEl('h2', { text: 'Other Settings' });

		new Setting(containerEl)
			.setName('Input Date Format')
			.addText(text => text
				.setPlaceholder('YYYY-MM-DD')
				.setValue(this.plugin.settings.inputDateFormat)
				.onChange(async (value) => {
				this.plugin.settings.inputDateFormat = value;
				await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
		.setName('Input Time Format')
		.addText(text => text
			.setPlaceholder('HH:mm')
			.setValue(this.plugin.settings.inputTimeFormat)
			.onChange(async (value) => {
			this.plugin.settings.inputTimeFormat = value;
			await this.plugin.saveSettings();
			}));
	}
}
