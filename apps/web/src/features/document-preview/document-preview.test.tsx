import {
  SAMPLE_HANG_TAG_RECORD,
  createSampleHangTagDocument,
} from '@smarttag/document-utils/fixtures';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentPreview, ValidatedDocumentPreview } from './document-preview';

const canvas = () => screen.getByTestId('document-preview-canvas');

describe('DocumentPreview', () => {
  it('renders the canonical document as SVG sized from physical dimensions', () => {
    render(<DocumentPreview document={createSampleHangTagDocument()} initialZoom={1} />);
    const svg = canvas().querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('data-page-side', 'FRONT');
    // 56 mm (50 mm trim + 2 × 3 mm bleed) at 96 CSS px per inch
    expect(parseFloat(canvas().style.width)).toBeCloseTo((56 / 25.4) * 96, 3);
    expect(canvas().querySelector('[data-object-id="front-product-name"]')?.textContent).toBe(
      'Organic Cotton Tee',
    );
    expect(canvas().querySelector('[data-guide="bleed"]')).not.toBeNull();
    expect(screen.getByText('50 mm × 90 mm (141.73 pt × 255.12 pt)')).toBeInTheDocument();
  });

  it('switches between front and back pages', async () => {
    render(<DocumentPreview document={createSampleHangTagDocument()} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Back' }));
    expect(screen.getByRole('tab', { name: 'Back' })).toHaveAttribute('aria-selected', 'true');
    expect(canvas().querySelector('svg')).toHaveAttribute('data-page-side', 'BACK');
    expect(canvas().querySelector('[data-object-type="qrCode"]')).not.toBeNull();
  });

  it('toggles guides and the finished-piece view', async () => {
    render(<DocumentPreview document={createSampleHangTagDocument()} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'safe' }));
    expect(canvas().querySelector('[data-guide="safe"]')).toBeNull();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'View' }), 'TRIM');
    expect(canvas().querySelector('mask')).not.toBeNull();
  });

  it('applies a data record to bound properties only', () => {
    render(
      <DocumentPreview
        document={createSampleHangTagDocument()}
        record={{ ...SAMPLE_HANG_TAG_RECORD, product_name: 'Linen Shirt', price: '49.50' }}
      />,
    );
    expect(canvas().querySelector('[data-object-id="front-product-name"]')?.textContent).toBe(
      'Linen Shirt',
    );
    expect(canvas().querySelector('[data-object-id="front-price"]')?.textContent).toBe('49.50');
    expect(canvas().querySelector('[data-object-id="front-size-label"]')?.textContent).toBe('SIZE');
  });

  it('reports data record issues by layer and artwork property', () => {
    render(
      <DocumentPreview
        document={createSampleHangTagDocument()}
        record={{ ...SAMPLE_HANG_TAG_RECORD, gtin: undefined }}
      />,
    );
    expect(screen.getByText(/The data record has issues/)).toBeInTheDocument();
    const issues = screen.getByTestId('record-issues');
    expect(issues).toHaveTextContent('REQUIRED_VALUE_MISSING');
    expect(issues).toHaveTextContent('Front / EAN-13 barcode / Value');
  });

  it('warns that text uses substitute fonts when controlled fonts are not loaded', () => {
    render(<DocumentPreview document={createSampleHangTagDocument()} />);
    const notice = screen.getByTestId('font-availability-notice');
    expect(notice).toHaveTextContent('substitute font, not the production font');
    expect(notice).toHaveTextContent('controlled fonts are not loaded in this view');
  });
});

/** ValidatedDocumentPreview loads the organization's font registry. */
function renderWithQueries(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('ValidatedDocumentPreview', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }),
        ),
      ),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('refuses to render invalid documents and lists issues', () => {
    const broken = { ...createSampleHangTagDocument(), pages: [] };
    renderWithQueries(<ValidatedDocumentPreview document={broken} />);
    expect(
      screen.getByText('This document cannot be rendered because it failed validation'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('document-preview-canvas')).toBeNull();
  });

  it('refuses unsupported schema versions', () => {
    renderWithQueries(
      <ValidatedDocumentPreview
        document={{ ...createSampleHangTagDocument(), schemaVersion: 42 }}
      />,
    );
    expect(screen.getByText('UNSUPPORTED_SCHEMA_VERSION')).toBeInTheDocument();
  });

  it('renders valid stored JSON', () => {
    renderWithQueries(
      <ValidatedDocumentPreview
        document={JSON.parse(JSON.stringify(createSampleHangTagDocument())) as unknown}
      />,
    );
    expect(canvas().querySelector('svg')).not.toBeNull();
  });

  it('names fonts that are missing from the organization registry', async () => {
    renderWithQueries(<ValidatedDocumentPreview document={createSampleHangTagDocument()} />);
    expect(screen.getByTestId('font-availability-loading')).toBeInTheDocument();
    const notice = await screen.findByTestId('font-availability-notice');
    expect(notice).toHaveTextContent('Noto Sans 700');
    expect(notice).toHaveTextContent('not in this organization’s font registry');
  });
});
