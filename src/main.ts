import { Editor, Notice, Plugin, TFile, MenuItem, setIcon } from "obsidian";
import { HandwritingOCRSettings, DEFAULT_SETTINGS, HandwritingOCRSettingTab } from "./settings";
import { HandwritingOCRAPI } from "./api";
import { extractFilePathFromSelection, getFileFromPath, fileToBlob, validateFileSize } from "./utils";

export default class HandwritingOCRPlugin extends Plugin {
	settings: HandwritingOCRSettings;
	api: HandwritingOCRAPI | null = null;

	async onload() {
		await this.loadSettings();

		// Initialize API if we have a key
		if (this.settings.apiKey) {
			this.api = new HandwritingOCRAPI(this.settings.apiKey);
		}

		// Create OCR Thumbnails folder if thumbnails are enabled
		if (this.settings.includeThumbnails) {
			await this.createThumbnailFolderIfNeeded();
		}

		// Add commands
		this.addCommand({
			id: "replace-selection",
			name: "Replace selection",
			editorCallback: (editor: Editor) => {
				this.processSelection(editor, "replace");
			}
		});

		this.addCommand({
			id: "append-to-selection",
			name: "Append to selection",
			editorCallback: (editor: Editor) => {
				this.processSelection(editor, "append");
			}
		});

		// Add context menu
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (file instanceof TFile && this.isSupportedFile(file)) {
					// Add separator before our menu items
					menu.addSeparator();

					menu.addItem((item: MenuItem) => {
						item
							.setTitle("Extract text to clipboard (Handwriting OCR)")
							.setIcon("clipboard-copy")
							.onClick(async () => {
								await this.extractToClipboard(file);
							});
					});

					menu.addItem((item: MenuItem) => {
						item
							.setTitle("Extract to new note (Handwriting OCR)")
							.setIcon("file-plus")
							.onClick(async () => {
								await this.extractToNewNote(file);
							});
					});

					menu.addItem((item: MenuItem) => {
						item
							.setTitle("Append OCR to active note (Handwriting OCR)")
							.setIcon("file-plus-2")
							.onClick(async () => {
								await this.appendToActiveNote(file);
							});
					});
				}
			})
		);

		// Add settings tab
		this.addSettingTab(new HandwritingOCRSettingTab(this.app, this));
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		// Update API instance when settings change
		if (this.settings.apiKey) {
			this.api = new HandwritingOCRAPI(this.settings.apiKey);
		} else {
			this.api = null;
		}
	}

	private isSupportedFile(file: TFile): boolean {
		const supportedExtensions = [
			'jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff', 'tif', 
			'heic', 'webp', 'pdf'
		];
		return supportedExtensions.includes(file.extension.toLowerCase());
	}

	private async processSelection(editor: Editor, mode: "replace" | "append") {
		if (!this.api) {
			new Notice("Please configure your API key in settings");
			return;
		}

		const selection = editor.getSelection();
		if (!selection) {
			new Notice("Please select an image or PDF link");
			return;
		}

		const filePath = extractFilePathFromSelection(selection);
		if (!filePath) {
			new Notice("Could not extract file path from selection");
			return;
		}

		const file = await getFileFromPath(this.app, filePath);
		if (!file) {
			new Notice("File not found in vault");
			return;
		}

		if (!validateFileSize(file)) {
			new Notice("File too large (max 20MB)");
			return;
		}

		try {
			const notice = new Notice("Processing with Handwriting OCR...", 0);
			// Add spinner icon to notice
			notice.noticeEl.prepend(this.createSpinnerIcon());
			
			const fileBlob = await fileToBlob(this.app, file);
			const result = await this.api.processDocument(fileBlob);
			
			// Combine all page transcripts for editor insertion
			const text = result.results.map(page => page.transcript).join('\n\n');
			
			notice.hide();

			if (mode === "replace") {
				editor.replaceSelection(text);
			} else {
				editor.replaceSelection(`${selection}\n\n${text}`);
			}

			new Notice("Text extracted successfully!");

		} catch (error) {
			new Notice(`OCR failed: ${error.message}`);
		}
	}

	private async extractToClipboard(file: TFile) {
		if (!this.api) {
			new Notice("Please configure your API key in settings");
			return;
		}

		if (!validateFileSize(file)) {
			new Notice("File too large (max 20MB)");
			return;
		}

		try {
			const notice = new Notice("Processing with Handwriting OCR...", 0);
			// Add spinner icon to notice
			notice.noticeEl.prepend(this.createSpinnerIcon());
			
			const fileBlob = await fileToBlob(this.app, file);
			const result = await this.api.processDocument(fileBlob);
			
			// Combine all page transcripts for clipboard
			const text = result.results.map(page => page.transcript).join('\n\n');
			
			notice.hide();

			await navigator.clipboard.writeText(text);
			new Notice("Text copied to clipboard!");

		} catch (error) {
			new Notice(`OCR failed: ${error.message}`);
		}
	}

	private async extractToNewNote(file: TFile) {
		if (!this.api) {
			new Notice("Please configure your API key in settings");
			return;
		}

		if (!validateFileSize(file)) {
			new Notice("File too large (max 20MB)");
			return;
		}

		try {
			const notice = new Notice("Processing with Handwriting OCR...", 0);
			// Add spinner icon to notice
			notice.noticeEl.prepend(this.createSpinnerIcon());
			
			const fileBlob = await fileToBlob(this.app, file);
			const result = await this.api.processDocument(fileBlob);
			
			notice.hide();

			// Create note content with pages and optional thumbnails
			let noteContent = `# OCR Extract from ${file.basename}\n\n`;
			const noteName = `OCR - ${file.basename.replace(/\.[^/.]+$/, "")}`;
			
			for (const pageResult of result.results) {
				if (this.settings.includeThumbnails && result.thumbnails) {
					const thumbnail = result.thumbnails.find(t => t.page_number === pageResult.page_number);
					if (thumbnail) {
						// Download and save thumbnail locally
						try {
							const thumbnailData = await this.api.downloadThumbnail(thumbnail.url);
							const thumbnailPath = await this.saveThumbnail(thumbnailData, noteName, pageResult.page_number);
							
							// Use Obsidian's wiki-link format for better compatibility
							noteContent += `## Page ${pageResult.page_number}\n\n![[${thumbnailPath}]]\n\n`;
						} catch (error) {
							noteContent += `## Page ${pageResult.page_number}\n\n`;
						}
					}
				} else {
					noteContent += `## Page ${pageResult.page_number}\n\n`;
				}
				noteContent += `${pageResult.transcript}\n\n`;
			}
			
			noteContent += `---\n\nSource: [[${file.path}]]`;
			
			// Small delay to ensure all thumbnails are saved before creating the note
			await new Promise(resolve => setTimeout(resolve, 100));
			
			const newFile = await this.app.vault.create(
				`${noteName}.md`,
				noteContent
			);

			// Open the new note
			await this.app.workspace.getLeaf().openFile(newFile);
			
			new Notice("Text extracted to new note!");

		} catch (error) {
			new Notice(`OCR failed: ${error.message}`);
		}
	}

	private async saveThumbnail(thumbnailData: ArrayBuffer, noteName: string, pageNumber: number): Promise<string> {
		// Create OCR Thumbnails folder if it doesn't exist
		const thumbnailFolder = "OCR Thumbnails";
		const folderExists = await this.app.vault.adapter.exists(thumbnailFolder);
		if (!folderExists) {
			await this.app.vault.createFolder(thumbnailFolder);
		}

		// Create subfolder for this document
		const docFolder = `${thumbnailFolder}/${noteName}`;
		const docFolderExists = await this.app.vault.adapter.exists(docFolder);
		if (!docFolderExists) {
			await this.app.vault.createFolder(docFolder);
		}

		// Save thumbnail image
		const thumbnailPath = `${docFolder}/page-${pageNumber}.jpg`;
		await this.app.vault.adapter.writeBinary(thumbnailPath, thumbnailData);
		
		return thumbnailPath;
	}

	private async createThumbnailFolderIfNeeded() {
		const thumbnailFolder = "OCR Thumbnails";
		try {
			const folderExists = await this.app.vault.adapter.exists(thumbnailFolder);
			if (!folderExists) {
				await this.app.vault.createFolder(thumbnailFolder);
			}
		} catch (error) {
			// Folder creation failed, but don't interrupt the flow
		}
	}

	private async appendToActiveNote(file: TFile) {
		if (!this.api) {
			new Notice("Please configure your API key in settings");
			return;
		}

		// Check if there's an active note
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			new Notice("No active note to append to");
			return;
		}

		if (!validateFileSize(file)) {
			new Notice("File too large (max 20MB)");
			return;
		}

		try {
			const notice = new Notice("Processing with Handwriting OCR...", 0);
			// Add spinner icon to notice
			notice.noticeEl.prepend(this.createSpinnerIcon());
			
			const fileBlob = await fileToBlob(this.app, file);
			const result = await this.api.processDocument(fileBlob);
			
			notice.hide();

			// Get current content of active note
			const currentContent = await this.app.vault.read(activeFile);
			
			// Create append content with pages and optional thumbnails
			let appendContent = `\n\n---\n\n# OCR Extract from ${file.basename}\n\n`;
			
			for (const pageResult of result.results) {
				if (this.settings.includeThumbnails && result.thumbnails) {
					const thumbnail = result.thumbnails.find(t => t.page_number === pageResult.page_number);
					if (thumbnail) {
						try {
							const thumbnailData = await this.api.downloadThumbnail(thumbnail.url);
							const thumbnailPath = await this.saveThumbnail(thumbnailData, `${file.basename}-append`, pageResult.page_number);
							
							appendContent += `## Page ${pageResult.page_number}\n\n![[${thumbnailPath}]]\n\n`;
						} catch (error) {
							appendContent += `## Page ${pageResult.page_number}\n\n`;
						}
					}
				} else {
					appendContent += `## Page ${pageResult.page_number}\n\n`;
				}
				appendContent += `${pageResult.transcript}\n\n`;
			}
			
			appendContent += `Source: [[${file.path}]]`;
			
			// Append to the active note
			await this.app.vault.modify(activeFile, currentContent + appendContent);
			
			new Notice("Text appended to active note!");

		} catch (error) {
			new Notice(`OCR failed: ${error.message}`);
		}
	}

	private createSpinnerIcon(): HTMLElement {
		const spinnerContainer = document.createElement("span");
		spinnerContainer.addClass("handwriting-ocr-spinner");
		
		// Use Obsidian's built-in loader-circle icon
		setIcon(spinnerContainer, "loader-circle");
		
		return spinnerContainer;
	}
}