import type { BarcodeSymbology, QrCodeObject } from '@smarttag/document-schema';
import { computeGs1CheckDigit, expandUpceToUpca, hasValidGs1CheckDigit } from './gs1';
import { SYMBOLOGY_SPECS, type SymbologyLengths } from './symbologies';

export type BarcodeValueIssueCode =
  | 'EMPTY_VALUE'
  | 'INVALID_CHARACTERS'
  | 'INVALID_LENGTH'
  | 'INVALID_CHECK_DIGIT'
  | 'INVALID_GS1_SYNTAX'
  | 'CAPACITY_EXCEEDED';

export interface BarcodeValueIssue {
  readonly code: BarcodeValueIssueCode;
  readonly message: string;
}

export type BarcodeValueValidation =
  | {
      readonly valid: true;
      /** Value to encode, with the check digit appended where the symbology requires one. */
      readonly normalizedValue: string;
    }
  | { readonly valid: false; readonly issues: readonly BarcodeValueIssue[] };

const CODE39_PATTERN = /^[0-9A-Z \-.$/+%]+$/;
// eslint-disable-next-line no-control-regex
const ASCII_PATTERN = /^[\x00-\x7F]+$/;
const GS1_AI_SEGMENT = /\((\d{2,4})\)([^()]+)/gy;

function invalid(code: BarcodeValueIssueCode, message: string): BarcodeValueValidation {
  return { valid: false, issues: [{ code, message }] };
}

/**
 * Validates data for a linear symbology independent of any rendering library. Rendering adapters
 * receive only values that passed this check.
 */
export function validateBarcodeValue(
  symbology: BarcodeSymbology,
  value: string,
): BarcodeValueValidation {
  const spec = SYMBOLOGY_SPECS[symbology];
  if (value.length === 0) {
    return invalid('EMPTY_VALUE', `${spec.displayName} requires a value`);
  }

  switch (spec.charset) {
    case 'DIGITS':
      if (!/^\d+$/.test(value))
        return invalid('INVALID_CHARACTERS', `${spec.displayName} accepts digits only`);
      break;
    case 'ASCII':
      if (!ASCII_PATTERN.test(value))
        return invalid('INVALID_CHARACTERS', `${spec.displayName} accepts ASCII characters only`);
      break;
    case 'CODE39':
      if (!CODE39_PATTERN.test(value)) {
        return invalid('INVALID_CHARACTERS', 'Code 39 accepts 0-9, A-Z, space and - . $ / + %');
      }
      break;
    case 'GS1_ELEMENT_STRING':
      return validateGs1ElementString(value, spec.lengths);
  }

  const { lengths } = spec;
  const lengthOk =
    lengths.kind === 'FIXED'
      ? lengths.values.includes(value.length)
      : value.length >= lengths.min && value.length <= lengths.max;
  if (!lengthOk) {
    const expected =
      lengths.kind === 'FIXED' ? lengths.values.join(' or ') : `${lengths.min}–${lengths.max}`;
    return invalid('INVALID_LENGTH', `${spec.displayName} requires ${expected} characters`);
  }

  if (spec.checkDigit !== 'GS1_MOD10' || lengths.kind !== 'FIXED') {
    return { valid: true, normalizedValue: value };
  }

  const fullLength = Math.max(...lengths.values);
  if (symbology === 'UPCE') {
    return validateUpce(value, fullLength);
  }
  if (value.length === fullLength) {
    return hasValidGs1CheckDigit(value)
      ? { valid: true, normalizedValue: value }
      : invalid(
          'INVALID_CHECK_DIGIT',
          `Check digit should be ${computeGs1CheckDigit(value.slice(0, -1))}`,
        );
  }
  return { valid: true, normalizedValue: `${value}${computeGs1CheckDigit(value)}` };
}

function validateUpce(value: string, fullLength: number): BarcodeValueValidation {
  if (value[0] !== '0' && value[0] !== '1') {
    return invalid('INVALID_CHARACTERS', 'UPC-E number system must be 0 or 1');
  }
  if (value.length === fullLength) {
    const upca = expandUpceToUpca(value);
    return hasValidGs1CheckDigit(upca)
      ? { valid: true, normalizedValue: value }
      : invalid(
          'INVALID_CHECK_DIGIT',
          `Check digit should be ${computeGs1CheckDigit(upca.slice(0, -1))}`,
        );
  }
  const upcaBody = expandUpceToUpca(`${value}0`).slice(0, -1);
  return { valid: true, normalizedValue: `${value}${computeGs1CheckDigit(upcaBody)}` };
}

function validateGs1ElementString(
  value: string,
  lengths: SymbologyLengths,
): BarcodeValueValidation {
  GS1_AI_SEGMENT.lastIndex = 0;
  let consumed = 0;
  let dataLength = 0;
  const issues: BarcodeValueIssue[] = [];
  for (let match = GS1_AI_SEGMENT.exec(value); match; match = GS1_AI_SEGMENT.exec(value)) {
    const [segment, ai, data] = match as unknown as [string, string, string];
    consumed += segment.length;
    dataLength += ai.length + data.length;
    if ((ai === '01' || ai === '02') && !(/^\d{14}$/.test(data) && hasValidGs1CheckDigit(data))) {
      issues.push({
        code: 'INVALID_CHECK_DIGIT',
        message: `AI (${ai}) requires a 14-digit GTIN with a valid check digit`,
      });
    }
  }
  if (consumed !== value.length || consumed === 0) {
    return invalid(
      'INVALID_GS1_SYNTAX',
      'GS1-128 data must use bracketed AI syntax, e.g. (01)04006381333931(10)LOT42',
    );
  }
  const max = lengths.kind === 'FIXED' ? Math.max(...lengths.values) : lengths.max;
  if (dataLength > max) {
    issues.push({ code: 'CAPACITY_EXCEEDED', message: `GS1-128 data exceeds ${max} characters` });
  }
  return issues.length > 0 ? { valid: false, issues } : { valid: true, normalizedValue: value };
}

/** Byte-mode capacity of the largest QR symbol (version 40) per error-correction level. */
export const QR_BYTE_CAPACITY: Readonly<Record<QrCodeObject['errorCorrection'], number>> = {
  L: 2953,
  M: 2331,
  Q: 1663,
  H: 1273,
};

export function validateQrValue(
  value: string,
  errorCorrection: QrCodeObject['errorCorrection'],
): BarcodeValueValidation {
  if (value.length === 0) {
    return invalid('EMPTY_VALUE', 'QR code requires a value');
  }
  const bytes = utf8ByteLength(value);
  if (bytes > QR_BYTE_CAPACITY[errorCorrection]) {
    return invalid(
      'CAPACITY_EXCEEDED',
      `QR payload is ${bytes} bytes; level ${errorCorrection} holds at most ${QR_BYTE_CAPACITY[errorCorrection]}`,
    );
  }
  return { valid: true, normalizedValue: value };
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const char of value) {
    const codePoint = char.codePointAt(0)!;
    bytes += codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4;
  }
  return bytes;
}
