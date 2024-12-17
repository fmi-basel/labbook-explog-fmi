import { Notice } from 'obsidian';

export class CustomNotice extends Notice {
    constructor(message: string, cssClass?: string, timeout: number = 5000) {
        super(message, timeout); // Call the parent class constructor
        if (cssClass) {
            const noticeEl = this.noticeEl; // Access the underlying DOM element
            noticeEl.classList.add(cssClass); // Apply the custom CSS class
        }
    }
}