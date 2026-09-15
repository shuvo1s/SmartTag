import type { SourceFormat } from '@smarttag/import-core';

export type FormatDetection =
  | { readonly ok: true; readonly format: SourceFormat; readonly extension: string }
  | { readonly ok: false; readonly code: 'UNSUPPORTED_IMPORT_FORMAT'; readonly message: string };

const ZIP_LOCAL_HEADER = [0x50, 0x4b, 0x03, 0x04];
const ZIP_EMPTY_ARCHIVE = [0x50, 0x4b, 0x05, 0x06];
const OLE_COMPOUND_FILE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

const BINARY_SIGNATURES: readonly { readonly bytes: readonly number[]; readonly name: string }[] = [
  { bytes: ZIP_LOCAL_HEADER, name: 'a ZIP archive (for example an Excel workbook)' },
  { bytes: OLE_COMPOUND_FILE, name: 'a legacy Office document' },
  { bytes: [0x25, 0x50, 0x44, 0x46], name: 'a PDF document' },
  { bytes: [0x89, 0x50, 0x4e, 0x47], name: 'a PNG image' },
  { bytes: [0xff, 0xd8, 0xff], name: 'a JPEG image' },
  { bytes: [0x47, 0x49, 0x46, 0x38], name: 'a GIF image' },
  { bytes: [0x1f, 0x8b], name: 'a gzip archive' },
  { bytes: [0x7f, 0x45, 0x4c, 0x46], name: 'an executable' },
  { bytes: [0x4d, 0x5a], name: 'a Windows executable' },
];

function startsWith(head: Uint8Array, bytes: readonly number[]): boolean {
  return bytes.every((byte, index) => head[index] === byte);
}

function extensionOf(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase();
}

const UNSUPPORTED_EXTENSIONS: Readonly<Record<string, string>> = {
  xls: 'Legacy XLS (Excel 97–2003) is not supported. Save the workbook as XLSX or CSV and upload it again.',
  xlt: 'Legacy XLS templates are not supported. Save the workbook as XLSX or CSV and upload it again.',
  xlsm: 'Macro-enabled workbooks (.xlsm) are not supported. Save the workbook as XLSX (without macros) or CSV.',
  xltm: 'Macro-enabled templates (.xltm) are not supported. Save the workbook as XLSX or CSV.',
  xlam: 'Excel add-ins are not supported. Upload an XLSX or CSV file.',
  xlsb: 'Binary workbooks (.xlsb) are not supported. Save the workbook as XLSX or CSV.',
  ods: 'OpenDocument spreadsheets (.ods) are not supported. Save the file as XLSX or CSV.',
  numbers: 'Apple Numbers files are not supported. Export the spreadsheet as XLSX or CSV.',
  tsv: 'Upload tab-separated data with the .csv extension; the delimiter can be chosen after upload.',
  txt: 'Upload delimited text with the .csv extension; the delimiter can be chosen after upload.',
};

/**
 * Decides the format from the file name AND the actual content. The browser's MIME type is never
 * trusted. Only `.csv` and `.xlsx` are accepted, and the content must match the extension (a ZIP
 * or legacy Office file renamed to .csv is refused, and so is a legacy or password-protected
 * workbook renamed to .xlsx).
 */
export function detectSourceFormat(filename: string, head: Uint8Array): FormatDetection {
  const extension = extensionOf(filename);
  const refuse = (message: string): FormatDetection => ({
    ok: false,
    code: 'UNSUPPORTED_IMPORT_FORMAT',
    message,
  });
  const known = UNSUPPORTED_EXTENSIONS[extension];
  if (known) return refuse(known);

  if (extension === 'xlsx') {
    if (startsWith(head, ZIP_LOCAL_HEADER)) return { ok: true, format: 'XLSX', extension };
    if (startsWith(head, OLE_COMPOUND_FILE)) {
      return refuse(
        'This file is not an XLSX workbook: it is a legacy (XLS) or password-protected workbook. Remove the password or save it as XLSX or CSV.',
      );
    }
    if (startsWith(head, ZIP_EMPTY_ARCHIVE)) return refuse('The XLSX file is empty.');
    return refuse('The file content is not an XLSX workbook.');
  }

  if (extension === 'csv') {
    for (const signature of BINARY_SIGNATURES) {
      if (startsWith(head, signature.bytes)) {
        return refuse(`The file content is not CSV text: it is ${signature.name}.`);
      }
    }
    const utf16 = (head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff);
    if (!utf16 && head.includes(0)) {
      return refuse('The file content is not CSV text: it contains binary data.');
    }
    return { ok: true, format: 'CSV', extension };
  }

  return refuse(
    extension
      ? `.${extension} files are not supported. Upload a CSV (.csv) or Excel workbook (.xlsx).`
      : 'The file has no extension. Upload a CSV (.csv) or Excel workbook (.xlsx).',
  );
}
