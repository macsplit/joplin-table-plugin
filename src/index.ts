// Remove the import joplin from '@joplin/lib' lines and use this:
declare const joplin: any;

// Standard Joplin Setting Types for 2026
enum SettingItemType {
    Int = 1,
    String = 2,
    Bool = 3,
}

/**
 * Handles Markdown table parsing, linting, and pivoting.
 */
class TableProcessor {
    private maxRowWidth: number;

    constructor(maxRowWidth: number = 80) {
        this.maxRowWidth = maxRowWidth;
    }

    private splitLine(line: string): string[] {
        const cleanLine = line.trim().replace(/^\||\|$/g, '');
        return cleanLine.split(/(?<!\\)\|/).map(cell => cell.trim());
    }

    public static findTables(text: string): IterableIterator<RegExpMatchArray> {
        // Matches table blocks: Header, Separator, and Data rows
        const tableRegex = /((?:^|\n)\|?.+\|.+\|?.*\n\|?\s*[:\-].+[:\-].*\|?.*\n(?:\|?.+\|.+\|?.*\n?)*)/g;
        return text.matchAll(tableRegex);
    }

    public process(tableMarkdown: string): string {
        const lines = tableMarkdown.split('\n').filter(l => l.trim() !== "");
        if (lines.length < 3) return tableMarkdown;

        try {
            const headers = this.splitLine(lines[0]);
            const dataRows = lines.slice(2).map(line => this.splitLine(line));

            if (headers.length < 2) return tableMarkdown;

            const isTooWide = lines.some(l => l.length > this.maxRowWidth);

            const result = isTooWide
                ? this.pivotToList(headers, dataRows)
                : this.lintTable(headers, dataRows);

            return `\n\n${result.trim()}\n\n`;
        } catch (e) {
            console.error('TableProcessor Error:', e);
            return tableMarkdown;
        }
    }

    private pivotToList(headers: string[], dataRows: string[][]): string {
        let output = "";
        dataRows.forEach((row) => {
            const firstCol = row[0] || "(empty)";
            const isFormatted = /^[*_].+[*_]$/.test(firstCol.trim());

            output += isFormatted ? `* ${firstCol}\n` : `* **${firstCol}**\n`;

            for (let i = 1; i < headers.length; i++) {
                output += `  * ${headers[i]}: ${row[i] || "(empty)"}\n`;
            }
            output += "\n";
        });
        return output;
    }

    private lintTable(headers: string[], dataRows: string[][]): string {
        const allRows = [headers, ...dataRows];
        const colWidths = headers.map((_, colIndex) =>
            Math.max(...allRows.map(row => (row[colIndex] ? row[colIndex].length : 0)))
        );

        const formatRow = (row: string[]) =>
            "| " + row.map((cell, i) => cell.padEnd(colWidths[i])).join(" | ") + " |";

        const separator = "| " + colWidths.map(w => "-".repeat(w)).join(" | ") + " |";
        const bodyStr = dataRows.map(row => formatRow(row)).join("\n");

        return `${formatRow(headers)}\n${separator}\n${bodyStr}`;
    }
}

joplin.plugins.register({
    onStart: async function() {
        await joplin.settings.registerSection('tableIntelligenceSection', {
            label: 'Table Intelligence',
            iconName: 'fas fa-table',
        });

        await joplin.settings.registerSettings({
            'maxWidthThreshold': {
                value: 80,
                type: SettingItemType.Int,
                section: 'tableIntelligenceSection',
                public: true,
                label: 'Table Width Threshold',
            },
        });

        await joplin.commands.register({
            name: 'pivotOrLintTable',
            label: 'Table: Auto-Process All Tables',
            iconName: 'fas fa-table',
            execute: async () => {
                const threshold = await joplin.settings.value('maxWidthThreshold');
                const processor = new TableProcessor(threshold);

                let text: string = await joplin.commands.execute('selectedText');
                const isSelection = !!text;

                if (!isSelection) {
                    const note = await joplin.workspace.selectedNote();
                    text = note.body;
                }

                if (!text || !text.includes('|')) return;

                let newBody = text;
                const tables = Array.from(TableProcessor.findTables(text));

                for (let i = tables.length - 1; i >= 0; i--) {
                    const tableMatch = tables[i];
                    const originalTable = tableMatch[0];
                    const transformedTable = processor.process(originalTable);

                    newBody = newBody.substring(0, tableMatch.index!).trimEnd() +
                              transformedTable +
                              newBody.substring(tableMatch.index! + originalTable.length).trimStart();
                }

                if (isSelection) {
                    await joplin.commands.execute('replaceSelection', newBody);
                } else {
                    const note = await joplin.workspace.selectedNote();
                    if (newBody !== note.body) {
                        await joplin.data.put(['notes', note.id], null, { body: newBody });
                    }
                }
            },
        });

        await joplin.views.toolbarButtons.create(
            'toolbarPivotTable',
            'pivotOrLintTable',
            'editorToolbar'
        );
    },
});
