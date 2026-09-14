import { describe, expect, it } from 'vitest';
import { sanitizeSvg, type SvgSanitizationResult, type SvgViolationCode } from './svg-sanitizer';

const svg = (body: string, rootAttributes = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100"${rootAttributes}>${body}</svg>`;

function run(source: string | Buffer): SvgSanitizationResult {
  return sanitizeSvg(typeof source === 'string' ? Buffer.from(source, 'utf8') : source);
}

function expectAccepted(source: string | Buffer) {
  const result = run(source);
  if (!result.ok) {
    throw new Error(`Expected acceptance, got ${JSON.stringify(result.violations)}`);
  }
  return { ...result, text: result.content.toString('utf8') };
}

function expectRejected(source: string | Buffer, code: SvgViolationCode) {
  const result = run(source);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.violations.map((violation) => violation.code)).toContain(code);
  }
}

describe('sanitizeSvg — preserves safe vector artwork', () => {
  it('keeps shapes, gradients, local references, text and CSS classes from design-tool exports', () => {
    const illustrator = `<?xml version="1.0" encoding="utf-8"?>
<!-- Generator: Adobe Illustrator 27.0.0, SVG Export Plug-In . SVG Version: 6.00 Build 0)  -->
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px"
	 viewBox="0 0 200 80" style="enable-background:new 0 0 200 80;" xml:space="preserve">
<style type="text/css">
	.st0{fill:url(#grad);}
	.st1{font-family:'NotoSans-Bold';font-size:24px;}
</style>
<defs><linearGradient id="grad" x1="0" y1="0" x2="1" y2="0"><stop offset="0" style="stop-color:#FF0000"/><stop offset="1" stop-color="#0000FF"/></linearGradient>
<path id="shape" d="M10 10 H 90 V 70 H 10 Z"/></defs>
<use xlink:href="#shape" class="st0"/>
<text transform="matrix(1 0 0 1 100 50)" class="st1">A &amp; B &lt; C</text>
</svg>`;
    const { text, report } = expectAccepted(illustrator);
    expect(
      text.startsWith(
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"',
      ),
    ).toBe(true);
    expect(text).not.toContain('<!--');
    expect(text).not.toContain('DOCTYPE');
    expect(text).toContain('<linearGradient id="grad"');
    expect(text).toContain('<use xlink:href="#shape" class="st0"/>');
    expect(text).toContain('.st0{fill:url(#grad);}');
    expect(text).toContain('A &amp; B &lt; C');
    expect(text).toContain('xml:space="preserve"');
    expect(report.removedElements).toEqual([]);
  });

  it('strips non-rendering editor metadata and foreign namespaces', () => {
    const inkscape = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
      xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
      width="50mm" height="20mm" viewBox="0 0 50 20" sodipodi:docname="logo.svg" data-name="x">
      <sodipodi:namedview id="base" inkscape:zoom="1"/>
      <metadata><rdf:RDF/></metadata>
      <g inkscape:label="Layer 1" inkscape:groupmode="layer"><rect x="1" y="1" width="10" height="5" fill="#123456"/></g>
    </svg>`;
    const { text, report } = expectAccepted(inkscape);
    expect(text).not.toMatch(/sodipodi|inkscape|rdf|metadata|data-name/);
    expect(text).toContain('<rect x="1" y="1" width="10" height="5" fill="#123456"/>');
    expect(report.removedElements).toEqual(['metadata', 'rdf:RDF', 'sodipodi:namedview']);
    expect(report.removedAttributes).toEqual([
      'data-name',
      'inkscape:groupmode',
      'inkscape:label',
      'sodipodi:docname',
    ]);
  });

  it('removes foreignObject fallbacks and unwraps links while keeping their artwork', () => {
    const { text } = expectAccepted(
      svg(
        '<switch><foreignObject requiredExtensions="http://ns.adobe.com/AdobeIllustrator/10.0/" width="1" height="1"/>' +
          '<g><a href="https://example.com"><circle cx="5" cy="5" r="4"/></a></g></switch>',
      ),
    );
    expect(text).not.toContain('foreignObject');
    expect(text).not.toContain('example.com');
    expect(text).toContain('<g><circle cx="5" cy="5" r="4"/></g>');
  });

  it('allows embedded raster images as base64 data URLs', () => {
    const { text } = expectAccepted(
      svg('<image width="10" height="10" href="data:image/png;base64,iVBORw0KGgo="/>'),
    );
    expect(text).toContain('href="data:image/png;base64,iVBORw0KGgo="');
  });

  it('produces output that is stable under re-sanitization and removes unknown attributes', () => {
    const first = expectAccepted(svg('<rect width="1" height="1" foo="bar" fill="#000"/>'));
    expect(first.text).not.toContain('foo=');
    const second = expectAccepted(first.content);
    expect(second.text).toBe(first.text);
  });

  it('adds the SVG namespace to hand-written files that omit it', () => {
    const { text } = expectAccepted('<svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>');
    expect(text).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>',
    );
  });

  it('only declares the xlink namespace when it is used', () => {
    const { text } = expectAccepted(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>',
    );
    expect(text).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>',
    );
  });
});

describe('sanitizeSvg — rejects active and unsafe content', () => {
  it.each<[string, string, SvgViolationCode]>([
    ['script element', svg('<script>alert(1)</script>'), 'SCRIPT_NOT_ALLOWED'],
    ['CDATA script', svg('<script><![CDATA[alert(1)]]></script>'), 'SCRIPT_NOT_ALLOWED'],
    ['onload on root', svg('<rect/>', ' onload="alert(1)"'), 'EVENT_HANDLER_NOT_ALLOWED'],
    ['upper-case handler', svg('<g ONCLICK="alert(1)"/>'), 'EVENT_HANDLER_NOT_ALLOWED'],
    [
      'handler on stripped element',
      svg('<metadata><x onmouseover="alert(1)"/></metadata>'),
      'EVENT_HANDLER_NOT_ALLOWED',
    ],
    ['javascript link', svg('<a xlink:href="javascript:alert(1)"><rect/></a>'), 'UNSAFE_URL'],
    ['obfuscated javascript', svg('<a href="java&#x09;script:alert(1)"><rect/></a>'), 'UNSAFE_URL'],
    ['javascript in use', svg('<use href="javascript:alert(1)"/>'), 'UNSAFE_URL'],
    [
      'set animation to javascript',
      svg('<a><set attributeName="href" to="javascript:alert(1)"/></a>'),
      'ANIMATION_NOT_ALLOWED',
    ],
    [
      'animate element',
      svg('<rect><animate attributeName="x" values="0;1"/></rect>'),
      'ANIMATION_NOT_ALLOWED',
    ],
    [
      'external image',
      svg('<image href="https://tracker.example/pixel.png"/>'),
      'EXTERNAL_REFERENCE_NOT_ALLOWED',
    ],
    [
      'protocol-relative image',
      svg('<image xlink:href="//tracker.example/p.png"/>'),
      'EXTERNAL_REFERENCE_NOT_ALLOWED',
    ],
    [
      'external use',
      svg('<use href="https://evil.example/sprite.svg#icon"/>'),
      'EXTERNAL_REFERENCE_NOT_ALLOWED',
    ],
    [
      'nested svg data URL',
      svg('<image href="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="/>'),
      'UNSAFE_URL',
    ],
    [
      'html data URL',
      svg('<image href="data:text/html,&lt;script&gt;alert(1)&lt;/script&gt;"/>'),
      'UNSAFE_URL',
    ],
    [
      'external paint server',
      svg('<rect fill="url(https://evil.example/p.svg#g)"/>'),
      'EXTERNAL_REFERENCE_NOT_ALLOWED',
    ],
    [
      'external url in style attribute',
      svg('<rect style="fill:url(//evil.example/a)"/>'),
      'EXTERNAL_REFERENCE_NOT_ALLOWED',
    ],
    ['css import', svg('<style>@import url(https://evil.example/x.css);</style>'), 'UNSAFE_CSS'],
    ['css font-face', svg('<style>@font-face{font-family:x;src:url(#a)}</style>'), 'UNSAFE_CSS'],
    [
      'css escape obfuscation',
      svg('<style>rect{fill:u\\72l(https://evil.example)}</style>'),
      'UNSAFE_CSS',
    ],
    [
      'foreignObject html script',
      svg(
        '<foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><script>alert(1)</script></body></foreignObject>',
      ),
      'SCRIPT_NOT_ALLOWED',
    ],
    [
      'foreignObject iframe',
      svg(
        '<foreignObject><iframe xmlns="http://www.w3.org/1999/xhtml" src="https://evil.example"/></foreignObject>',
      ),
      'EMBEDDED_CONTENT_NOT_ALLOWED',
    ],
    [
      'handler element',
      svg('<handler type="application/ecmascript">alert(1)</handler>'),
      'SCRIPT_NOT_ALLOWED',
    ],
  ])('rejects %s', (_label, source, code) => {
    expectRejected(source, code);
  });

  it('rejects entity declarations (XXE / expansion bombs)', () => {
    expectRejected(
      '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg">&xxe;</svg>',
      'DOCTYPE_NOT_ALLOWED',
    );
    expectRejected(
      '<!DOCTYPE svg [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;">]><svg xmlns="http://www.w3.org/2000/svg"><text>&b;</text></svg>',
      'DOCTYPE_NOT_ALLOWED',
    );
  });

  it('rejects malformed XML, non-SVG roots, non-UTF-8 content and excessive nesting', () => {
    expectRejected('<svg xmlns="http://www.w3.org/2000/svg"><rect></svg>', 'MALFORMED_XML');
    expectRejected(
      '<html><body><svg xmlns="http://www.w3.org/2000/svg"/></body></html>',
      'NOT_SVG',
    );
    expectRejected('<svg xmlns="http://www.w3.org/1999/xhtml"><rect/></svg>', 'NOT_SVG');
    const utf16 = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from(svg('<rect/>'), 'utf16le'),
    ]);
    expectRejected(utf16, 'NOT_UTF8');
    expectRejected(svg(`${'<g>'.repeat(200)}${'</g>'.repeat(200)}`), 'TOO_COMPLEX');
  });

  it('never leaks rejected content into a result', () => {
    const result = run(svg('<rect/><script>alert(1)</script>'));
    expect(result).toEqual({
      ok: false,
      violations: [{ code: 'SCRIPT_NOT_ALLOWED', message: '<script> elements are not allowed' }],
    });
  });
});
