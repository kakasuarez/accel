import { describe, expect, it } from 'vitest';
import { compareAddresses, parseAddress } from '../../src/lib/kyc/util/address';
import { daysBetween, parseDocDate } from '../../src/lib/kyc/util/dates';
import { businessNameScore, personNameScore } from '../../src/lib/kyc/util/fuzzy';
import { maskGstin, maskTail, maskText, maskUdyam } from '../../src/lib/kyc/util/mask';
import { stateByGstCode, stateByName, stateByUdyamCode } from '../../src/lib/kyc/util/states';

describe('states', () => {
  it('maps GST numeric codes and Udyam letter codes to the same state', () => {
    expect(stateByGstCode('29')?.name).toBe('Karnataka');
    expect(stateByUdyamCode('KR')?.gstCode).toBe('29');
    expect(stateByUdyamCode('TS')?.gstCode).toBe('36');
    expect(stateByName('andhra  pradesh')?.gstCode).toBe('37');
  });
});

describe('business name matching', () => {
  it('treats Pvt Ltd = Private Limited, & = and, ignores case and punctuation', () => {
    expect(businessNameScore('Trinity Bake House Pvt. Ltd.', 'TRINITY BAKE HOUSE PRIVATE LIMITED')).toBe(1);
    expect(businessNameScore('Vindhya Tours & Travels', 'Vindhya Tours and Travels')).toBe(1);
    expect(businessNameScore('Saffron Dental Care LLP', 'Saffron Dental Care')).toBe(1);
  });

  it('scores different businesses low', () => {
    expect(businessNameScore('Neelgiri Physio Clinic', 'Shri Physio Clinic')).toBeLessThan(0.85);
    expect(businessNameScore('Green Leaf Legal Associates', 'Green Leaf')).toBeLessThan(0.85);
  });

  it('ignores word order for person names', () => {
    expect(personNameScore('Kaur Neha', 'Neha Kaur')).toBe(1);
  });
});

describe('dates', () => {
  it.each([
    ['2026-06-26', '2026-06-26'],
    ['26/06/2026', '2026-06-26'],
    ['26-Jun-2026', '2026-06-26'],
    ['26 June 2026', '2026-06-26'],
    ['2O26-O6-26', '2026-06-26'],
  ])('parses %s', (raw, iso) => expect(parseDocDate(raw)).toBe(iso));

  it('rejects impossible dates and non-dates', () => {
    expect(parseDocDate('2026-02-30')).toBeNull();
    expect(parseDocDate('Regular')).toBeNull();
  });

  it('counts calendar days', () => {
    expect(daysBetween('2026-04-16', '2026-07-15')).toBe(90);
  });
});

describe('address', () => {
  it('splits street, city, state and PIN', () => {
    expect(parseAddress('Shop/Unit 1, Tech Park Road, Visakhapatnam, Andhra Pradesh - 118383')).toMatchObject({
      street: 'Shop/Unit 1, Tech Park Road',
      city: 'Visakhapatnam',
      state: 'Andhra Pradesh',
      pincode: '118383',
    });
  });

  it('handles a PIN glued to the state', () => {
    expect(parseAddress('Shop/Unit 80, Civil Lines, Nagpur, Maharashtra-411231')).toMatchObject({ state: 'Maharashtra', pincode: '411231', city: 'Nagpur' });
  });

  it('flags a different PIN code', () => {
    const a = parseAddress('Shop/Unit 1, Tech Park Road, Visakhapatnam, Andhra Pradesh - 118383');
    const b = parseAddress('Shop/Unit 1, Tech Park Road, Visakhapatnam, Andhra Pradesh - 118384');
    expect(compareAddresses(a, b, 0.8)).toMatchObject({ match: false, differences: ['pincode'] });
  });
});

describe('masking', () => {
  it('masks identifiers', () => {
    expect(maskGstin('37IHKXV5167L1ZS')).toBe('37**********1ZS');
    expect(maskUdyam('UDYAM-AP-00-9751562')).toBe('UDYAM-AP-00-***1562');
    expect(maskTail('SYN-ID-346190', 3)).toBe('**********190');
    expect(maskText('GSTIN 37IHKXV5167L1ZS consumer 9485717625')).toBe('GSTIN 37**********1ZS consumer ******7625');
  });
});
