import { listDocumentTypes } from '@smarttag/document-utils';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { CreateTemplateForm } from './create-template-form';
import { customers } from './test-data';

function setup(onSubmit = vi.fn().mockResolvedValue(undefined)) {
  const user = userEvent.setup();
  render(
    <CreateTemplateForm
      customers={customers}
      documentTypes={listDocumentTypes('AVAILABLE')}
      onSubmit={onSubmit}
    />,
  );
  return { user, onSubmit };
}

const submit = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: 'Create template' }));

describe('CreateTemplateForm', () => {
  it('offers only available document types and sensible physical defaults', () => {
    setup();
    expect(screen.getByLabelText(/Document type/)).toHaveDisplayValue('Hang tag');
    expect(
      screen
        .getAllByRole('option', { name: /tag|label|ticket|sticker|artwork/i })
        .map((o) => o.textContent),
    ).toEqual(['Hang tag']);
    expect(screen.getByLabelText(/Unit/)).toHaveDisplayValue('Millimetres (mm)');
    expect(screen.getByLabelText(/Trim width \(mm\)/)).toHaveValue(50);
    expect(screen.getByLabelText(/Trim height \(mm\)/)).toHaveValue(90);
    expect(screen.getByLabelText('Front + back')).toBeChecked();
  });

  it('shows required-field errors and does not submit', async () => {
    const { user, onSubmit } = setup();
    await user.clear(screen.getByLabelText(/Trim width/));
    await submit(user);

    expect(await screen.findByText('Name is required')).toBeInTheDocument();
    expect(screen.getByText('Width is required')).toBeInTheDocument();
    expect(screen.getByLabelText(/Template name/)).toHaveAttribute('aria-invalid', 'true');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('validates physical constraints with the shared contract', async () => {
    const { user, onSubmit } = setup();
    await user.type(screen.getByLabelText(/Template name/), 'Tag');
    await user.type(screen.getByLabelText(/Template code/), 'HT-1');
    await user.clear(screen.getByLabelText(/Bleed/));
    await user.type(screen.getByLabelText(/Bleed/), '-1');
    await user.clear(screen.getByLabelText(/Trim width/));
    await user.type(screen.getByLabelText(/Trim width/), '4');
    await user.clear(screen.getByLabelText(/Safe margin/));
    await user.type(screen.getByLabelText(/Safe margin/), '45');
    await submit(user);

    expect(await screen.findByText('Bleed cannot be negative')).toBeInTheDocument();
    expect(screen.getByText('Width must be at least 5 mm')).toBeInTheDocument();
    expect(screen.getByText('Safe margin leaves no usable area')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('enables brands only for the selected customer and submits a normalised request', async () => {
    const { user, onSubmit } = setup();
    const brand = screen.getByLabelText(/Brand/);
    expect(brand).toBeDisabled();

    await user.type(screen.getByLabelText(/Template name/), 'Basic hang tag');
    await user.type(screen.getByLabelText(/Template code/), 'ht-basic-01');
    await user.selectOptions(screen.getByLabelText(/Customer/), 'Demo Apparel Co.');
    expect(brand).toBeEnabled();
    await user.selectOptions(brand, 'Demo Active');
    await user.selectOptions(screen.getByLabelText(/Unit/), 'in');
    await user.clear(screen.getByLabelText(/Trim width \(in\)/));
    await user.type(screen.getByLabelText(/Trim width \(in\)/), '2');
    await user.clear(screen.getByLabelText(/Trim height \(in\)/));
    await user.type(screen.getByLabelText(/Trim height \(in\)/), '3.5');
    await user.clear(screen.getByLabelText(/Bleed/));
    await user.type(screen.getByLabelText(/Bleed/), '0.125');
    await user.clear(screen.getByLabelText(/Safe margin/));
    await user.type(screen.getByLabelText(/Safe margin/), '0.125');
    await user.click(screen.getByLabelText('Front only'));
    await submit(user);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]![0]).toEqual({
      name: 'Basic hang tag',
      code: 'HT-BASIC-01',
      description: '',
      customerId: customers[0]!.id,
      brandId: customers[0]!.brands[0]!.id,
      documentType: 'HANG_TAG',
      dimensions: { unit: 'in', width: 2, height: 3.5, bleed: 0.125, safeMargin: 0.125 },
      pageLayout: 'FRONT_ONLY',
    });
  });

  it('clears the brand when the customer changes', async () => {
    const { user } = setup();
    await user.selectOptions(screen.getByLabelText(/Customer/), 'Demo Apparel Co.');
    await user.selectOptions(screen.getByLabelText(/Brand/), 'Demo Active');
    await user.selectOptions(screen.getByLabelText(/Customer/), 'Brandless Ltd.');
    expect(screen.getByLabelText(/Brand/)).toBeDisabled();
    expect(screen.getByLabelText(/Brand/)).toHaveDisplayValue('No brand');
  });

  it('maps server field errors back onto the form', async () => {
    const onSubmit = vi
      .fn()
      .mockRejectedValue(
        new ApiError(
          409,
          'VALIDATION_ERROR',
          'Invalid',
          {
            fieldErrors: [{ path: 'code', message: 'A template with code "HT-1" already exists' }],
          },
          'req-1',
        ),
      );
    const { user } = setup(onSubmit);
    await user.type(screen.getByLabelText(/Template name/), 'Tag');
    await user.type(screen.getByLabelText(/Template code/), 'HT-1');
    await submit(user);
    expect(
      await screen.findByText('A template with code "HT-1" already exists'),
    ).toBeInTheDocument();
  });

  it('shows non-field server errors with the request reference', async () => {
    const onSubmit = vi
      .fn()
      .mockRejectedValue(
        new ApiError(409, 'CONFLICT', 'A template with code "HT-1" already exists', null, 'req-42'),
      );
    const { user } = setup(onSubmit);
    await user.type(screen.getByLabelText(/Template name/), 'Tag');
    await user.type(screen.getByLabelText(/Template code/), 'HT-1');
    await submit(user);
    expect(
      await screen.findByText('A template with code "HT-1" already exists (reference req-42)'),
    ).toBeInTheDocument();
  });
});
