import { SAMPLE_HANG_TAG_RECORD, createSampleHangTagDocument } from '@smarttag/document-utils/fixtures';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
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
    expect(canvas().querySelector('[data-object-id="front-product-name"]')?.textContent).toBe('Organic Cotton Tee');
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
    render(<DocumentPreview document={createSampleHangTagDocument()} record={{ ...SAMPLE_HANG_TAG_RECORD, product_name: 'Linen Shirt', price: '49.50' }} />);
    expect(canvas().querySelector('[data-object-id="front-product-name"]')?.textContent).toBe('Linen Shirt');
    expect(canvas().querySelector('[data-object-id="front-price"]')?.textContent).toBe('49.50');
    expect(canvas().querySelector('[data-object-id="front-size-label"]')?.textContent).toBe('SIZE');
  });

  it('reports unresolved bound values', () => {
    render(<DocumentPreview document={createSampleHangTagDocument()} record={{ ...SAMPLE_HANG_TAG_RECORD, gtin: undefined }} />);
    expect(screen.getByText(/could not be resolved/)).toBeInTheDocument();
    expect(screen.getByText(/front-barcode.value/)).toBeInTheDocument();
  });
});

describe('ValidatedDocumentPreview', () => {
  it('refuses to render invalid documents and lists issues', () => {
    const broken = { ...createSampleHangTagDocument(), pages: [] };
    render(<ValidatedDocumentPreview document={broken} />);
    expect(screen.getByText('This document cannot be rendered because it failed validation')).toBeInTheDocument();
    expect(screen.queryByTestId('document-preview-canvas')).toBeNull();
  });

  it('refuses unsupported schema versions', () => {
    render(<ValidatedDocumentPreview document={{ ...createSampleHangTagDocument(), schemaVersion: 42 }} />);
    expect(screen.getByText('UNSUPPORTED_SCHEMA_VERSION')).toBeInTheDocument();
  });

  it('renders valid stored JSON', () => {
    render(<ValidatedDocumentPreview document={JSON.parse(JSON.stringify(createSampleHangTagDocument())) as unknown} />);
    expect(canvas().querySelector('svg')).not.toBeNull();
  });
});
