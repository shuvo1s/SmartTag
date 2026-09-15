import type { Readable } from 'node:stream';
import sax from 'sax';
import { SourceReadError } from '../errors';

export type XmlAttributes = Readonly<Record<string, string>>;

export interface XmlHandlers {
  readonly open?: (name: string, attributes: XmlAttributes) => void;
  readonly text?: (text: string) => void;
  readonly close?: (name: string) => void;
}

/** "x:row" → "row": workbooks written by some libraries prefix every element. */
export function localName(name: string): string {
  const colon = name.indexOf(':');
  return colon === -1 ? name : name.slice(colon + 1);
}

/** An attribute by local name ("id" finds "r:id"), or undefined. */
export function attribute(attributes: XmlAttributes, name: string): string | undefined {
  if (Object.hasOwn(attributes, name)) return attributes[name];
  for (const key of Object.keys(attributes)) {
    if (localName(key) === name && key !== name) return attributes[key];
  }
  return undefined;
}

const NUL = String.fromCharCode(0);

/**
 * A strict, non-validating XML reader for workbook parts. It never loads DTDs or external entities
 * (DOCTYPE declarations are refused outright), and only the five predefined entities and character
 * references are expanded, so entity-expansion attacks are impossible.
 */
export function createXmlParser(part: string, handlers: XmlHandlers) {
  const parser = sax.parser(true, { trim: false, normalize: false, position: true });
  const malformed = (reason: string) =>
    new SourceReadError(
      'MALFORMED_FILE',
      `The workbook part "${part}" is not valid XML (${reason}).`,
    );
  parser.onerror = (error: Error) => {
    throw malformed(error.message.split('\n')[0] ?? 'syntax error');
  };
  parser.ondoctype = () => {
    throw malformed('DOCTYPE declarations are not allowed');
  };
  parser.onopentag = (tag) => {
    const attributes: Record<string, string> = Object.create(null) as Record<string, string>;
    const raw = tag.attributes as Readonly<Record<string, string | { readonly value: string }>>;
    for (const [key, value] of Object.entries(raw)) {
      attributes[key] = typeof value === 'string' ? value : value.value;
      if (attributes[key].includes(NUL)) throw malformed('it contains U+0000');
    }
    handlers.open?.(localName(tag.name), attributes);
  };
  if (handlers.text) {
    const text = handlers.text;
    // XML 1.0 cannot contain U+0000; the tokenizer refuses "&#0;" but not a raw NUL character.
    const checked = (value: string) => {
      if (value.includes(NUL)) throw malformed('it contains U+0000');
      text(value);
    };
    parser.ontext = checked;
    parser.oncdata = checked;
  }
  if (handlers.close) {
    const close = handlers.close;
    parser.onclosetag = (name) => close(localName(name));
  }
  return {
    write(text: string): void {
      parser.write(text);
    },
    close(): void {
      parser.close();
    },
  };
}

/** Decodes a part stream as UTF-8 text chunks. */
export async function* textChunks(stream: Readable, part: string): AsyncGenerator<string> {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      yield decoder.decode(chunk, { stream: true });
    }
    const rest = decoder.decode();
    if (rest) yield rest;
  } catch (error) {
    if (error instanceof SourceReadError) throw error;
    throw new SourceReadError(
      'MALFORMED_FILE',
      `The workbook part "${part}" is not valid UTF-8 XML.`,
    );
  } finally {
    stream.destroy();
  }
}

/** Parses a whole (bounded) part with the given handlers. */
export async function parseXmlPart(
  stream: Readable,
  part: string,
  handlers: XmlHandlers,
): Promise<void> {
  const parser = createXmlParser(part, handlers);
  for await (const text of textChunks(stream, part)) parser.write(text);
  parser.close();
}
