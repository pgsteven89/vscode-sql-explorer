/**
 * Drop Zone Component
 * Handles file drag and drop
 */

export class DropZone {
    private container: HTMLElement;
    private onFileDrop: (file: File) => void;

    constructor(container: HTMLElement, onFileDrop: (file: File) => void) {
        this.container = container;
        this.onFileDrop = onFileDrop;
        this.setupEventListeners();
    }

    private setupEventListeners(): void {
        // Prevent default drag behaviors on document
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            document.addEventListener(eventName, this.preventDefaults.bind(this), false);
        });

        // Highlight drop zone when dragging over document
        ['dragenter', 'dragover'].forEach(eventName => {
            document.addEventListener(eventName, () => {
                this.container.classList.add('drag-over');
            }, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            document.addEventListener(eventName, () => {
                this.container.classList.remove('drag-over');
            }, false);
        });

        // Handle dropped files on document
        document.addEventListener('drop', (e: DragEvent) => {
            this.handleDrop(e);
        }, false);

        // Also handle click to select files
        this.container.addEventListener('click', () => {
            this.openFilePicker();
        });
    }

    private preventDefaults(e: Event): void {
        e.preventDefault();
        e.stopPropagation();
    }

    private handleDrop(e: DragEvent): void {
        const files = e.dataTransfer?.files;
        if (!files) { return; }

        // Process each dropped file
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            if (this.isValidFileType(file.name)) {
                this.onFileDrop(file);
            } else {
                console.warn(`Unsupported file type: ${file.name}`);
            }
        }
    }

    private openFilePicker(): void {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.accept = '.csv,.parquet,.xlsx,.xls,.sqlite,.db,.json';

        input.addEventListener('change', () => {
            const files = input.files;
            if (!files) { return; }

            for (let i = 0; i < files.length; i++) {
                this.onFileDrop(files[i]);
            }
        });

        input.click();
    }

    private isValidFileType(fileName: string): boolean {
        const validExtensions = ['csv', 'parquet', 'xlsx', 'xls', 'sqlite', 'db', 'json'];
        const ext = fileName.toLowerCase().split('.').pop();
        return validExtensions.includes(ext || '');
    }
}
