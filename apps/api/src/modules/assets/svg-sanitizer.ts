import { DOMParser, type Document, type Element } from '@xmldom/xmldom';

/**
 * Server-side SVG sanitizer (see docs/security.md#svg-uploads).
 *
 * Strategy: parse as strict XML (the same grammar browsers use for image/svg+xml), then REBUILD a
 * new document from allow-listed elements and attributes and serialize it ourselves. Nothing from
 * the input is copied verbatim, so unknown constructs cannot survive by accident.
 *
 * Two outcomes for content outside the allow-list:
 * - REJECT the whole upload when the content shows executable or tracking intent: script, event
 *   handlers, animation (which can rewrite href to `javascript:`), `javascript:`/external URLs,
 *   unsafe CSS, DTD entity declarations, embedded HTML frames/objects.
 * - STRIP content that is merely non-rendering editor noise (comments, metadata, Inkscape /
 *   Illustrator namespaces, foreignObject fallbacks, unknown attributes) so that ordinary
 *   exports from design tools remain usable.
 *
 * The sanitized bytes are what gets stored, checksummed and served. Content is additionally served
 * with a sandboxing CSP and loaded by the editor only as an image, so the sanitizer is one layer of
 * defence, not the only one.
 */

export const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink';
const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace';
const XMLNS_NAMESPACE = 'http://www.w3.org/2000/xmlns/';

export const SVG_SANITIZER_VERSION = '1';

const MAX_DEPTH = 128;
const MAX_ELEMENTS = 50_000;
const MAX_VIOLATIONS = 20;

export type SvgViolationCode =
  | 'NOT_UTF8'
  | 'MALFORMED_XML'
  | 'NOT_SVG'
  | 'DOCTYPE_NOT_ALLOWED'
  | 'SCRIPT_NOT_ALLOWED'
  | 'EVENT_HANDLER_NOT_ALLOWED'
  | 'ANIMATION_NOT_ALLOWED'
  | 'EMBEDDED_CONTENT_NOT_ALLOWED'
  | 'UNSAFE_URL'
  | 'EXTERNAL_REFERENCE_NOT_ALLOWED'
  | 'UNSAFE_CSS'
  | 'TOO_COMPLEX';

export interface SvgViolation {
  readonly code: SvgViolationCode;
  readonly message: string;
}

export interface SvgSanitizationReport {
  /** Distinct element names that were removed (sorted). */
  readonly removedElements: readonly string[];
  /** Distinct attribute names that were removed (sorted). */
  readonly removedAttributes: readonly string[];
}

export type SvgSanitizationResult =
  | { readonly ok: true; readonly content: Buffer; readonly report: SvgSanitizationReport }
  | { readonly ok: false; readonly violations: readonly SvgViolation[] };

// ---------------------------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------------------------

const ALLOWED_ELEMENTS = new Set([
  'svg',
  'g',
  'defs',
  'symbol',
  'use',
  'switch',
  'title',
  'desc',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'textPath',
  'image',
  'clipPath',
  'mask',
  'pattern',
  'marker',
  'linearGradient',
  'radialGradient',
  'stop',
  'style',
  'filter',
  'feBlend',
  'feColorMatrix',
  'feComponentTransfer',
  'feComposite',
  'feConvolveMatrix',
  'feDiffuseLighting',
  'feDisplacementMap',
  'feDistantLight',
  'feDropShadow',
  'feFlood',
  'feFuncA',
  'feFuncB',
  'feFuncG',
  'feFuncR',
  'feGaussianBlur',
  'feImage',
  'feMerge',
  'feMergeNode',
  'feMorphology',
  'feOffset',
  'fePointLight',
  'feSpecularLighting',
  'feSpotLight',
  'feTile',
  'feTurbulence',
]);

/** Element names (any namespace, case-insensitive) that cause the upload to be rejected. */
const REJECTED_ELEMENTS: ReadonlyMap<string, SvgViolationCode> = new Map([
  ['script', 'SCRIPT_NOT_ALLOWED'],
  ['handler', 'SCRIPT_NOT_ALLOWED'],
  ['listener', 'SCRIPT_NOT_ALLOWED'],
  ['animate', 'ANIMATION_NOT_ALLOWED'],
  ['animatecolor', 'ANIMATION_NOT_ALLOWED'],
  ['animatemotion', 'ANIMATION_NOT_ALLOWED'],
  ['animatetransform', 'ANIMATION_NOT_ALLOWED'],
  ['set', 'ANIMATION_NOT_ALLOWED'],
  ['discard', 'ANIMATION_NOT_ALLOWED'],
  ['mpath', 'ANIMATION_NOT_ALLOWED'],
  ['iframe', 'EMBEDDED_CONTENT_NOT_ALLOWED'],
  ['frame', 'EMBEDDED_CONTENT_NOT_ALLOWED'],
  ['frameset', 'EMBEDDED_CONTENT_NOT_ALLOWED'],
  ['embed', 'EMBEDDED_CONTENT_NOT_ALLOWED'],
  ['object', 'EMBEDDED_CONTENT_NOT_ALLOWED'],
  ['applet', 'EMBEDDED_CONTENT_NOT_ALLOWED'],
  ['base', 'EMBEDDED_CONTENT_NOT_ALLOWED'],
  ['link', 'EMBEDDED_CONTENT_NOT_ALLOWED'],
  ['meta', 'EMBEDDED_CONTENT_NOT_ALLOWED'],
  ['form', 'EMBEDDED_CONTENT_NOT_ALLOWED'],
  ['input', 'EMBEDDED_CONTENT_NOT_ALLOWED'],
  ['button', 'EMBEDDED_CONTENT_NOT_ALLOWED'],
  ['audio', 'EMBEDDED_CONTENT_NOT_ALLOWED'],
  ['video', 'EMBEDDED_CONTENT_NOT_ALLOWED'],
]);

/** Elements whose children are kept but which are themselves removed. */
const UNWRAPPED_ELEMENTS = new Set(['a']);

const ALLOWED_ATTRIBUTES = new Set([
  // core
  'id',
  'class',
  'style',
  'lang',
  // geometry & structure
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'fx',
  'fy',
  'fr',
  'width',
  'height',
  'd',
  'points',
  'pathLength',
  'transform',
  'transform-origin',
  'viewBox',
  'preserveAspectRatio',
  'version',
  'baseProfile',
  // conditional processing (string comparison only, never fetched)
  'requiredFeatures',
  'requiredExtensions',
  'systemLanguage',
  // presentation
  'alignment-baseline',
  'baseline-shift',
  'clip',
  'clip-path',
  'clip-rule',
  'color',
  'color-interpolation',
  'color-interpolation-filters',
  'color-rendering',
  'direction',
  'display',
  'dominant-baseline',
  'enable-background',
  'fill',
  'fill-opacity',
  'fill-rule',
  'filter',
  'flood-color',
  'flood-opacity',
  'font-family',
  'font-size',
  'font-size-adjust',
  'font-stretch',
  'font-style',
  'font-variant',
  'font-weight',
  'glyph-orientation-horizontal',
  'glyph-orientation-vertical',
  'image-rendering',
  'isolation',
  'kerning',
  'letter-spacing',
  'lighting-color',
  'marker',
  'marker-end',
  'marker-mid',
  'marker-start',
  'mask',
  'mask-type',
  'mix-blend-mode',
  'opacity',
  'overflow',
  'paint-order',
  'shape-rendering',
  'stop-color',
  'stop-opacity',
  'stroke',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-opacity',
  'stroke-width',
  'text-anchor',
  'text-decoration',
  'text-rendering',
  'unicode-bidi',
  'vector-effect',
  'visibility',
  'word-spacing',
  'writing-mode',
  // text
  'dx',
  'dy',
  'rotate',
  'textLength',
  'lengthAdjust',
  'method',
  'spacing',
  'startOffset',
  'side',
  // paint servers, clipping, masking, markers
  'gradientUnits',
  'gradientTransform',
  'spreadMethod',
  'offset',
  'patternUnits',
  'patternContentUnits',
  'patternTransform',
  'clipPathUnits',
  'maskUnits',
  'maskContentUnits',
  'markerUnits',
  'markerWidth',
  'markerHeight',
  'orient',
  'refX',
  'refY',
  // filters
  'filterUnits',
  'primitiveUnits',
  'in',
  'in2',
  'result',
  'mode',
  'type',
  'values',
  'tableValues',
  'slope',
  'intercept',
  'amplitude',
  'exponent',
  'k1',
  'k2',
  'k3',
  'k4',
  'operator',
  'order',
  'kernelMatrix',
  'divisor',
  'bias',
  'targetX',
  'targetY',
  'edgeMode',
  'preserveAlpha',
  'surfaceScale',
  'diffuseConstant',
  'specularConstant',
  'specularExponent',
  'kernelUnitLength',
  'scale',
  'xChannelSelector',
  'yChannelSelector',
  'stdDeviation',
  'radius',
  'baseFrequency',
  'numOctaves',
  'seed',
  'stitchTiles',
  'azimuth',
  'elevation',
  'z',
  'pointsAtX',
  'pointsAtY',
  'pointsAtZ',
  'limitingConeAngle',
]);

/** Elements that may embed a raster image as a data: URL. */
const RASTER_HREF_ELEMENTS = new Set(['image', 'feImage']);
const RASTER_DATA_URL = /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=\s]+$/;
const LOCAL_FRAGMENT = /^#[^\s'"()<>\\]+$/;
const URL_FUNCTION = /url\s*\(\s*(['"]?)([^'")]*)\1\s*\)/gi;

// ---------------------------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------------------------

interface OutputElement {
  readonly name: string;
  readonly attributes: [string, string][];
  readonly children: (OutputElement | string)[];
}

class SanitizationContext {
  readonly violations: SvgViolation[] = [];
  readonly removedElements = new Set<string>();
  readonly removedAttributes = new Set<string>();
  elementCount = 0;
  usesXlink = false;

  reject(code: SvgViolationCode, message: string): void {
    if (
      this.violations.length < MAX_VIOLATIONS &&
      !this.violations.some((existing) => existing.code === code && existing.message === message)
    ) {
      this.violations.push({ code, message });
    }
  }
}

/**
 * Sanitizes SVG bytes. Pure function; never throws for untrusted input (only for internal bugs).
 */
export function sanitizeSvg(input: Buffer): SvgSanitizationResult {
  const first = sanitizeOnce(input);
  if (!first.ok) {
    return first;
  }
  // Defence against serializer bugs: sanitized output must be a fixed point of the sanitizer.
  const second = sanitizeOnce(first.content);
  if (!second.ok || !second.content.equals(first.content)) {
    throw new Error('SVG sanitizer output is not stable');
  }
  return first;
}

function sanitizeOnce(input: Buffer): SvgSanitizationResult {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(input);
  } catch {
    return rejected('NOT_UTF8', 'SVG files must be UTF-8 encoded');
  }

  // Entity declarations enable expansion attacks and external entity (XXE) references.
  if (/<!ENTITY/i.test(text)) {
    return rejected('DOCTYPE_NOT_ALLOWED', 'Entity declarations are not allowed');
  }

  const parseErrors: string[] = [];
  let document: Document;
  try {
    document = new DOMParser({
      locator: false,
      onError: (level, message) => {
        if (level !== 'warning') {
          parseErrors.push(message);
        }
      },
    }).parseFromString(text, 'image/svg+xml');
  } catch {
    return rejected('MALFORMED_XML', 'The file is not well-formed XML');
  }
  if (parseErrors.length > 0) {
    return rejected('MALFORMED_XML', 'The file is not well-formed XML');
  }

  if (document.doctype && document.doctype.internalSubset.trim().length > 0) {
    return rejected(
      'DOCTYPE_NOT_ALLOWED',
      'Document type definitions with declarations are not allowed',
    );
  }

  const root = document.documentElement;
  if (!root || root.localName !== 'svg' || !isSvgNamespace(root.namespaceURI)) {
    return rejected('NOT_SVG', 'The root element must be an SVG <svg> element');
  }

  const context = new SanitizationContext();
  const output = sanitizeElement(root, 0, context);
  if (context.violations.length > 0) {
    return { ok: false, violations: context.violations };
  }
  if (!output || Array.isArray(output)) {
    return rejected('NOT_SVG', 'The root element must be an SVG <svg> element');
  }

  const namespaces: [string, string][] = [['xmlns', SVG_NAMESPACE]];
  if (context.usesXlink) {
    namespaces.push(['xmlns:xlink', XLINK_NAMESPACE]);
  }
  output.attributes.unshift(...namespaces);

  return {
    ok: true,
    content: Buffer.from(serialize(output), 'utf8'),
    report: {
      removedElements: [...context.removedElements].sort(),
      removedAttributes: [...context.removedAttributes].sort(),
    },
  };
}

function rejected(code: SvgViolationCode, message: string): SvgSanitizationResult {
  return { ok: false, violations: [{ code, message }] };
}

function isSvgNamespace(namespace: string | null): boolean {
  return namespace === SVG_NAMESPACE;
}

/**
 * Returns the sanitized element, an array of children (for unwrapped elements), or null when the
 * element is removed.
 */
function sanitizeElement(
  element: Element,
  depth: number,
  context: SanitizationContext,
): OutputElement | (OutputElement | string)[] | null {
  context.elementCount += 1;
  if (context.elementCount > MAX_ELEMENTS || depth > MAX_DEPTH) {
    context.reject('TOO_COMPLEX', 'The SVG is too large or too deeply nested');
    return null;
  }

  const localName = element.localName ?? element.nodeName;
  const rejectedCode = REJECTED_ELEMENTS.get(localName.toLowerCase());
  if (rejectedCode) {
    context.reject(rejectedCode, `<${localName}> elements are not allowed`);
    return null;
  }
  // Scan attributes even of elements that will be stripped: event handlers or javascript: URLs
  // anywhere in the file are a clear signal the upload is hostile.
  inspectAttributesForThreats(element, context);

  const inSvgNamespace = isSvgNamespace(element.namespaceURI);
  if (inSvgNamespace && UNWRAPPED_ELEMENTS.has(localName)) {
    context.removedElements.add(localName);
    return sanitizeChildren(element, depth, context, localName);
  }
  if (!inSvgNamespace || !ALLOWED_ELEMENTS.has(localName)) {
    context.removedElements.add(element.nodeName);
    // Still walk the subtree so hostile content inside stripped elements is detected.
    sanitizeChildren(element, depth, context, localName);
    return null;
  }

  const attributes = sanitizeAttributes(element, localName, context);
  const children = sanitizeChildren(element, depth, context, localName);
  return { name: localName, attributes, children };
}

function sanitizeChildren(
  element: Element,
  depth: number,
  context: SanitizationContext,
  parentName: string,
): (OutputElement | string)[] {
  const children: (OutputElement | string)[] = [];
  const nodes = element.childNodes;
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes.item(index);
    if (!node) continue;
    switch (node.nodeType) {
      case 1: {
        const result = sanitizeElement(node as Element, depth + 1, context);
        if (Array.isArray(result)) {
          children.push(...result);
        } else if (result) {
          children.push(result);
        }
        break;
      }
      case 3:
      case 4: {
        const value = node.nodeValue ?? '';
        if (parentName === 'style') {
          checkCss(value, context);
        }
        children.push(value);
        break;
      }
      case 5:
        context.reject('DOCTYPE_NOT_ALLOWED', 'Entity references are not allowed');
        break;
      default:
        // comments and processing instructions are dropped
        break;
    }
  }
  return children;
}

function inspectAttributesForThreats(element: Element, context: SanitizationContext): void {
  const attributes = element.attributes;
  for (let index = 0; index < attributes.length; index += 1) {
    const attribute = attributes.item(index);
    if (!attribute) continue;
    const name = attribute.localName ?? attribute.name;
    if (/^on/i.test(name)) {
      context.reject(
        'EVENT_HANDLER_NOT_ALLOWED',
        `Event handler attributes (${name}) are not allowed`,
      );
    }
    if (containsScriptUrl(attribute.value)) {
      context.reject('UNSAFE_URL', `Attribute ${attribute.name} contains a script URL`);
    }
  }
}

function sanitizeAttributes(
  element: Element,
  elementName: string,
  context: SanitizationContext,
): [string, string][] {
  const result: [string, string][] = [];
  const attributes = element.attributes;
  for (let index = 0; index < attributes.length; index += 1) {
    const attribute = attributes.item(index);
    if (!attribute) continue;
    const namespace = attribute.namespaceURI;
    const localName = attribute.localName ?? attribute.name;
    const value = attribute.value;

    if (namespace === XMLNS_NAMESPACE || attribute.name === 'xmlns') {
      continue; // namespace declarations are regenerated
    }
    if (/^on/i.test(localName)) {
      continue; // already reported
    }

    if (localName === 'href' && (namespace === null || namespace === XLINK_NAMESPACE)) {
      if (checkHref(value, elementName, context)) {
        if (namespace === XLINK_NAMESPACE) {
          context.usesXlink = true;
          result.push(['xlink:href', value.trim()]);
        } else {
          result.push(['href', value.trim()]);
        }
      }
      continue;
    }
    if (namespace === XML_NAMESPACE && (localName === 'space' || localName === 'lang')) {
      result.push([`xml:${localName}`, value]);
      continue;
    }
    if (namespace !== null || !ALLOWED_ATTRIBUTES.has(localName)) {
      context.removedAttributes.add(attribute.name);
      continue;
    }
    if (localName === 'style') {
      checkCss(value, context);
    } else {
      checkUrlFunctions(value, attribute.name, context);
    }
    result.push([localName, value]);
  }
  return result;
}

function checkHref(value: string, elementName: string, context: SanitizationContext): boolean {
  const trimmed = value.trim();
  if (LOCAL_FRAGMENT.test(trimmed)) {
    return true;
  }
  if (RASTER_HREF_ELEMENTS.has(elementName) && RASTER_DATA_URL.test(trimmed)) {
    return true;
  }
  if (containsScriptUrl(trimmed) || /^data:/i.test(trimmed)) {
    context.reject('UNSAFE_URL', `<${elementName}> references unsafe content`);
  } else {
    context.reject(
      'EXTERNAL_REFERENCE_NOT_ALLOWED',
      `<${elementName}> references an external resource; embed or remove it`,
    );
  }
  return false;
}

function checkUrlFunctions(
  value: string,
  attributeName: string,
  context: SanitizationContext,
): void {
  const occurrences = (value.match(/url\s*\(/gi) ?? []).length;
  if (occurrences === 0) {
    return;
  }
  const matches = [...value.matchAll(URL_FUNCTION)];
  if (
    matches.length !== occurrences ||
    matches.some((match) => !LOCAL_FRAGMENT.test((match[2] ?? '').trim()))
  ) {
    context.reject(
      'EXTERNAL_REFERENCE_NOT_ALLOWED',
      `Attribute ${attributeName} references an external resource`,
    );
  }
}

function checkCss(css: string, context: SanitizationContext): void {
  if (css.includes('\\')) {
    context.reject('UNSAFE_CSS', 'CSS escape sequences are not allowed');
  }
  if (/@import|@font-face|expression\s*\(|behavior\s*:|-moz-binding|<\/?\s*[a-z!]/i.test(css)) {
    context.reject('UNSAFE_CSS', 'CSS contains constructs that are not allowed');
  }
  checkUrlFunctions(css, 'style', context);
}

/** Detects script-capable URL schemes, including whitespace/control-character obfuscation. */
function containsScriptUrl(value: string): boolean {
  let normalized = '';
  for (const char of value) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (codePoint > 0x20 && codePoint !== 0x7f) {
      normalized += char;
    }
  }
  return /(?:javascript|vbscript|livescript):/i.test(normalized) || /data:text\//i.test(normalized);
}

function serialize(element: OutputElement): string {
  const attributes = element.attributes
    .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
    .join('');
  if (element.children.length === 0) {
    return `<${element.name}${attributes}/>`;
  }
  const children = element.children
    .map((child) => (typeof child === 'string' ? escapeText(child) : serialize(child)))
    .join('');
  return `<${element.name}${attributes}>${children}</${element.name}>`;
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttribute(value: string): string {
  return escapeText(value)
    .replace(/"/g, '&quot;')
    .replace(/\t/g, '&#9;')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;');
}
