import { requestUrl } from "obsidian";

export interface UserInfo {
	id: string;
	name: string;
	email: string;
	verified: boolean;
	blocked: boolean;
	type: string;
	balance: number;
	token: string;
}

export interface UploadResponse {
	id: string;
	status: string;
	created_at: string;
	updated_at: string;
}

export interface DocumentStatus {
	id: string;
	status: 'new' | 'processing' | 'processed' | 'failed';
	pages?: number;
	error?: string;
}

export interface DocumentResult {
	id: string;
	file_name: string;
	action: string;
	page_count: number;
	status: string;
	results: Array<{
		page_number: number;
		transcript: string;
	}>;
	thumbnails?: Array<{
		page_number: number;
		url: string;
	}>;
	error?: string;
}

export class HandwritingOCRAPI {
	private baseUrl = 'https://www.handwritingocr.com/api/v3';
	
	constructor(private apiKey: string) {}

	async validateApiKey(): Promise<UserInfo> {
		const response = await requestUrl({
			url: `${this.baseUrl}/users/me`,
			method: 'GET',
			headers: {
				'Authorization': `Bearer ${this.apiKey}`,
				'Accept': 'application/json',
				'User-Agent': 'Obsidian-HandwritingOCR/1.0.0'
			}
		});

		if (response.status !== 200) {
			if (response.status === 401) {
				throw new Error('Invalid API key');
			}
			throw new Error(`API error: ${response.status}`);
		}

		return response.json;
	}

	async uploadDocument(file: File): Promise<string> {
		// Convert file to ArrayBuffer
		const fileBuffer = await file.arrayBuffer();
		
		// Create multipart form data manually
		const boundary = '----formdata-obsidian-' + Math.random().toString(36);
		const formData = this.createMultipartFormData(boundary, file, fileBuffer);
		
		const response = await requestUrl({
			url: `${this.baseUrl}/documents`,
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${this.apiKey}`,
				'Accept': 'application/json',
				'Content-Type': `multipart/form-data; boundary=${boundary}`,
				'User-Agent': 'Obsidian-HandwritingOCR/1.0.0'
			},
			body: formData
		});

		if (response.status === 403) {
			throw new Error('Insufficient credits');
		}
		if (response.status === 415) {
			throw new Error('Unsupported file type');
		}
		if (response.status === 413) {
			throw new Error('File too large (max 20MB)');
		}
		if (response.status !== 201) {
			throw new Error(`Upload failed: ${response.status}`);
		}

		const data: UploadResponse = response.json;
		return data.id;
	}

	private createMultipartFormData(boundary: string, file: File, fileBuffer: ArrayBuffer): ArrayBuffer {
		const encoder = new TextEncoder();
		const parts: Uint8Array[] = [];

		// Add action field
		parts.push(encoder.encode(`--${boundary}\r\n`));
		parts.push(encoder.encode('Content-Disposition: form-data; name="action"\r\n\r\n'));
		parts.push(encoder.encode('transcribe\r\n'));

		// Add file field
		parts.push(encoder.encode(`--${boundary}\r\n`));
		parts.push(encoder.encode(`Content-Disposition: form-data; name="file"; filename="${file.name}"\r\n`));
		parts.push(encoder.encode(`Content-Type: ${file.type}\r\n\r\n`));
		parts.push(new Uint8Array(fileBuffer));
		parts.push(encoder.encode('\r\n'));

		// Add closing boundary
		parts.push(encoder.encode(`--${boundary}--\r\n`));

		// Combine all parts
		const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
		const result = new Uint8Array(totalLength);
		let offset = 0;
		for (const part of parts) {
			result.set(part, offset);
			offset += part.length;
		}

		return result.buffer;
	}

	async downloadThumbnail(thumbnailUrl: string): Promise<ArrayBuffer> {
		const response = await requestUrl({
			url: thumbnailUrl,
			method: 'GET',
			headers: {
				'Authorization': `Bearer ${this.apiKey}`,
				'User-Agent': 'Obsidian-HandwritingOCR/1.0.0'
			}
		});

		if (response.status !== 200) {
			throw new Error(`Failed to download thumbnail: ${response.status}`);
		}

		return response.arrayBuffer;
	}

	async checkStatus(documentId: string): Promise<DocumentStatus> {
		const response = await requestUrl({
			url: `${this.baseUrl}/documents/${documentId}`,
			method: 'GET',
			headers: {
				'Authorization': `Bearer ${this.apiKey}`,
				'Accept': 'application/json',
				'User-Agent': 'Obsidian-HandwritingOCR/1.0.0'
			}
		});

		if (response.status !== 200) {
			throw new Error(`Status check failed: ${response.status}`);
		}

		return response.json;
	}

	async getResult(documentId: string): Promise<DocumentResult> {
		const response = await requestUrl({
			url: `${this.baseUrl}/documents/${documentId}.json`,
			method: 'GET',
			headers: {
				'Authorization': `Bearer ${this.apiKey}`,
				'Accept': 'application/json',
				'User-Agent': 'Obsidian-HandwritingOCR/1.0.0'
			}
		});

		if (response.status !== 200) {
			throw new Error(`Failed to get result: ${response.status}`);
		}

		const data: DocumentResult = response.json;
		
		if (data.error) {
			throw new Error(`OCR failed: ${data.error}`);
		}

		return data;
	}

	async processDocument(file: File): Promise<DocumentResult> {
		// Upload
		const documentId = await this.uploadDocument(file);
		
		// Poll for completion
		let attempts = 0;
		const maxAttempts = 60; // 2 minutes timeout
		
		while (attempts < maxAttempts) {
			await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
			
			const status = await this.checkStatus(documentId);
			
			if (status.status === 'processed') {
				return await this.getResult(documentId);
			} else if (status.status === 'failed') {
				throw new Error(status.error || 'Processing failed');
			}
			
			attempts++;
		}
		
		throw new Error('Processing timeout');
	}
}