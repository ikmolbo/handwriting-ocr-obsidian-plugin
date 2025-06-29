import { App, TFile } from "obsidian";

const SUPPORTED_EXTENSIONS = [
	'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.tif', 
	'.heic', '.webp', '.pdf'
];

const OBSIDIAN_LINK_REGEX = /!\[\[(.*?)\]\]/;
const MARKDOWN_LINK_REGEX = /!\[.*?\]\((.*?)\)/;

export function isSupportedFile(fileName: string): boolean {
	const lowerName = fileName.toLowerCase();
	return SUPPORTED_EXTENSIONS.some(ext => lowerName.endsWith(ext));
}

export function extractFilePathFromSelection(selection: string): string | null {
	// Check for Obsidian internal link
	const obsidianMatch = selection.match(OBSIDIAN_LINK_REGEX);
	if (obsidianMatch && obsidianMatch[1]) {
		// Remove any pipe notation (for aliases)
		return obsidianMatch[1].split('|')[0].trim();
	}

	// Check for markdown link
	const markdownMatch = selection.match(MARKDOWN_LINK_REGEX);
	if (markdownMatch && markdownMatch[1]) {
		return markdownMatch[1].trim();
	}

	// If it's just a plain file path
	const trimmed = selection.trim();
	if (isSupportedFile(trimmed)) {
		return trimmed;
	}

	return null;
}

export async function getFileFromPath(app: App, filePath: string): Promise<TFile | null> {
	// First try to get the file directly
	let file = app.vault.getAbstractFileByPath(filePath);
	
	// If not found, try to resolve it as a link
	if (!file) {
		file = app.metadataCache.getFirstLinkpathDest(filePath, '');
	}

	// Check if it's a TFile and is supported
	if (file instanceof TFile && isSupportedFile(file.path)) {
		return file;
	}

	return null;
}

export async function fileToBlob(app: App, file: TFile): Promise<File> {
	const arrayBuffer = await app.vault.readBinary(file);
	const blob = new Blob([arrayBuffer], { type: getMimeType(file.extension) });
	return new File([blob], file.name, { type: getMimeType(file.extension) });
}

function getMimeType(extension: string): string {
	const mimeTypes: Record<string, string> = {
		'jpg': 'image/jpeg',
		'jpeg': 'image/jpeg',
		'png': 'image/png',
		'gif': 'image/gif',
		'bmp': 'image/bmp',
		'tiff': 'image/tiff',
		'tif': 'image/tiff',
		'heic': 'image/heic',
		'webp': 'image/webp',
		'pdf': 'application/pdf'
	};
	
	return mimeTypes[extension.toLowerCase()] || 'application/octet-stream';
}

export function validateFileSize(file: TFile): boolean {
	// 20MB in bytes
	const maxSize = 20 * 1024 * 1024;
	return file.stat.size <= maxSize;
}