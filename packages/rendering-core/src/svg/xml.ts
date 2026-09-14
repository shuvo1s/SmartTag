const XML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

/** Escapes text for use in XML character data and double-quoted attribute values. */
export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => XML_ESCAPES[char] ?? char);
}

/**
 * Compact, deterministic number formatting for SVG output (4 decimals ≈ 0.0014 mm).
 * Never emits "-0", exponent notation for realistic values, or trailing zeros.
 */
export function fmt(value: number): string {
  const rounded = Number(value.toFixed(4));
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

/** Builds ` name="value"` pairs, skipping null/undefined/false. Values are escaped. */
export function attrs(values: Readonly<Record<string, string | number | boolean | null | undefined>>): string {
  let result = '';
  for (const [name, value] of Object.entries(values)) {
    if (value === null || value === undefined || value === false) {
      continue;
    }
    const text = typeof value === 'number' ? fmt(value) : value === true ? name : value;
    result += ` ${name}="${escapeXml(text)}"`;
  }
  return result;
}

/** Font family names are inserted into a CSS list; strip characters that could break out of it. */
export function cssFontFamily(family: string): string {
  const safe = family.replace(/["'\\;{}<>]/g, '').trim();
  return `'${safe}', sans-serif`;
}

const SAFE_URL = /^(https?:\/\/|\/(?!\/)|blob:|data:image\/(png|jpeg|gif|webp);base64,)/i;

/** Only allow URL schemes that cannot execute script when used as an image source. */
export function isSafeImageUrl(url: string): boolean {
  return SAFE_URL.test(url.trim());
}
