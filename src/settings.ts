import { App, PluginSettingTab, Setting, Notice, TFolder } from "obsidian";
import HandwritingOCRPlugin from "./main";
import { HandwritingOCRAPI } from "./api";

export interface HandwritingOCRSettings {
	apiKey: string;
	includeThumbnails: boolean;
}

export const DEFAULT_SETTINGS: HandwritingOCRSettings = {
	apiKey: "",
	includeThumbnails: false
};

export class HandwritingOCRSettingTab extends PluginSettingTab {
	plugin: HandwritingOCRPlugin;
	private creditDisplay: HTMLElement | null = null;

	constructor(app: App, plugin: HandwritingOCRPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// Add introductory text
		const introDiv = containerEl.createDiv({ cls: "handwriting-ocr-intro" });
		
		introDiv.createEl("p", {
			text: "Transform handwritten documents and scanned images into editable text with our AI-powered OCR technology. Perfect for digitizing handwritten notes, converting legacy documents, and making your analog content searchable within Obsidian."
		});
		
		introDiv.createEl("p", {
			text: "Extract text directly to your clipboard, create new notes with formatted content, or append OCR results to your existing notes. Supports PDFs and common image formats (JPG, PNG, TIFF, etc.)."
		});
		
		const ctaP = introDiv.createEl("p");
		ctaP.createEl("span", { text: "Get started with " });
		ctaP.createEl("a", {
			text: "free trial credits",
			href: "https://dashboard.handwritingocr.com/register"
		});
		ctaP.createEl("span", { text: " to test the service." });

		// API Key setting
		new Setting(containerEl)
			.setName("API key")
			.setDesc("Enter your Handwriting OCR API key")
			.addText(text => text
				.setPlaceholder("Enter your API key")
				.setValue(this.plugin.settings.apiKey)
				.onChange(async (value) => {
					this.plugin.settings.apiKey = value;
					await this.plugin.saveSettings();
				}));

		// Add a button to validate the API key
		new Setting(containerEl)
			.setName("Validate API key")
			.setDesc("Check if your API key is valid and view your credit balance")
			.addButton(button => button
				.setButtonText("Validate")
				.onClick(async () => {
					await this.validateApiKey();
				}));

		// Credit balance display area
		this.creditDisplay = containerEl.createDiv({ cls: "handwriting-ocr-credit-display" });
		
		// If we have an API key, automatically validate it
		if (this.plugin.settings.apiKey) {
			void this.validateApiKey();
		}

		// Thumbnail setting
		new Setting(containerEl)
			.setName("Include thumbnails")
			.setDesc("Include page thumbnails in extracted notes (creates a folder called OCR Thumbnails)")
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.includeThumbnails)
				.onChange(async (value) => {
					this.plugin.settings.includeThumbnails = value;
					await this.plugin.saveSettings();
					
					// Create OCR Thumbnails folder when enabled
					if (value) {
						await this.createThumbnailFolder();
					}
				}));

		// Add help text
		containerEl.createDiv({ cls: "setting-item-description", text: "Get your API key from " })
			.createEl("a", { 
				text: "dashboard.handwritingocr.com/settings",
				href: "https://dashboard.handwritingocr.com/settings?tab=api"
			});
	}

	private async validateApiKey() {
		if (!this.plugin.settings.apiKey) {
			new Notice("Please enter an API key first");
			return;
		}

		if (!this.creditDisplay) return;

		try {
			this.creditDisplay.setText("Validating API key...");
			
			const api = new HandwritingOCRAPI(this.plugin.settings.apiKey);
			const userInfo = await api.validateApiKey();
			
			// Display success message with credit balance
			this.creditDisplay.empty();
			this.creditDisplay.createEl("div", { 
				text: `✓ API key is valid`,
				cls: "handwriting-ocr-success"
			});
			this.creditDisplay.createEl("div", {
				text: `Account: ${userInfo.name} (${userInfo.email})`,
				cls: "handwriting-ocr-info"
			});
			this.creditDisplay.createEl("div", {
				text: `Credits remaining: ${userInfo.balance}`,
				cls: "handwriting-ocr-info"
			});
			this.creditDisplay.createEl("div", {
				text: `Account type: ${userInfo.type}`,
				cls: "handwriting-ocr-info"
			});
			
			new Notice("API key validated successfully!");
			
		} catch (error) {
			// Display error message
			this.creditDisplay.empty();
			const errorMessage = error.message.toLowerCase().includes('invalid api key') || error.message.includes('401') 
				? 'Invalid API key' 
				: error.message;
			
			this.creditDisplay.createEl("div", { 
				text: `✗ ${errorMessage}`,
				cls: "handwriting-ocr-error"
			});
			
			const noticeMessage = error.message.toLowerCase().includes('invalid api key') || error.message.includes('401')
				? 'API key is invalid. Please check your API key and try again.'
				: `API key validation failed: ${error.message}`;
			
			new Notice(noticeMessage);
		}
	}

	private async createThumbnailFolder() {
		const thumbnailFolder = "OCR Thumbnails";
		try {
			const folderExists = this.app.vault.getAbstractFileByPath(thumbnailFolder) instanceof TFolder;
			if (!folderExists) {
				await this.app.vault.createFolder(thumbnailFolder);
				new Notice("Created 'OCR Thumbnails' folder for storing page images");
			}
		} catch (_error) {
			// Folder creation failed silently
		}
	}
}