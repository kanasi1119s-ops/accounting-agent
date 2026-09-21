import { describe, expect, it } from 'vitest';
import {
  checkInvoiceRegistrationNumber,
  resolveDeemedDeductionRate,
  resolveVendorRegistrationStatus,
} from '../src/lib/invoiceNumber.js';

describe('checkInvoiceRegistrationNumber', () => {
  it('accepts a valid T+13-digit number', () => {
    const result = checkInvoiceRegistrationNumber('T1234567890123');
    expect(result.isValidFormat).toBe(true);
    expect(result.normalized).toBe('T1234567890123');
  });

  it('normalizes full-width characters before checking', () => {
    const result = checkInvoiceRegistrationNumber('Ｔ１２３４５６７８９０１２３');
    expect(result.isValidFormat).toBe(true);
    expect(result.normalized).toBe('T1234567890123');
  });

  it('rejects wrong digit counts', () => {
    expect(checkInvoiceRegistrationNumber('T123').isValidFormat).toBe(false);
    expect(checkInvoiceRegistrationNumber('T123456789012345').isValidFormat).toBe(false);
  });

  it('rejects a missing T prefix', () => {
    expect(checkInvoiceRegistrationNumber('1234567890123').isValidFormat).toBe(false);
  });

  it('returns null normalized value for empty input', () => {
    const result = checkInvoiceRegistrationNumber('');
    expect(result.normalized).toBeNull();
    expect(result.isValidFormat).toBe(false);
  });
});

describe('resolveVendorRegistrationStatus', () => {
  it('trusts the vendor master when it says registered', () => {
    const status = resolveVendorRegistrationStatus({
      vendorMasterStatus: 'registered',
      invoiceNumberOnDocument: null,
    });
    expect(status).toBe('registered');
  });

  it('falls back to the document number when the vendor is unknown', () => {
    expect(
      resolveVendorRegistrationStatus({ invoiceNumberOnDocument: 'T1234567890123' })
    ).toBe('registered');
    expect(
      resolveVendorRegistrationStatus({ invoiceNumberOnDocument: 'not-a-number' })
    ).toBe('unregistered');
    expect(resolveVendorRegistrationStatus({ invoiceNumberOnDocument: '' })).toBe('unknown');
  });
});

describe('resolveDeemedDeductionRate', () => {
  it('returns null for registered vendors', () => {
    expect(resolveDeemedDeductionRate('registered', '2024-01-01')).toBeNull();
  });

  it('applies the 80% phase for 2023-10 through 2026-09', () => {
    expect(resolveDeemedDeductionRate('unregistered', '2024-06-01')).toBe(0.8);
  });

  it('applies the 50% phase for 2026-10 through 2029-09', () => {
    expect(resolveDeemedDeductionRate('unregistered', '2027-01-01')).toBe(0.5);
  });

  it('applies 0% after the transitional measure ends', () => {
    expect(resolveDeemedDeductionRate('unregistered', '2030-01-01')).toBe(0);
  });

  it('returns null before the invoice system started', () => {
    expect(resolveDeemedDeductionRate('unregistered', '2022-01-01')).toBeNull();
  });
});
