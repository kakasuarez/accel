import { describe, expect, it } from 'vitest';
import {
  gstinCheckChar,
  gstinLookalikeCandidates,
  repairGstin,
  repairUdyam,
  validateGstin,
  validateUdyam,
} from '../../src/lib/kyc/extract/identifiers';

describe('GSTIN check character', () => {
  it.each(['27AAPFU0939F1ZV', '29AAGCB7383J1Z4'])('matches real GSTIN %s', (g) => {
    expect(gstinCheckChar(g)).toBe(g[14]);
  });

  it('validates a dataset GSTIN (X at PAN position 4)', () => {
    expect(validateGstin('37IHKXV5167L1ZS')).toBeNull();
  });

  it('rejects a wrong check character', () => {
    expect(validateGstin('37IHKXV5167L1ZT')).toBe('CHECKSUM');
  });

  it('rejects bad structure and unknown state codes', () => {
    expect(validateGstin('37IHKXV5167L1Z')).toBe('FORMAT');
    expect(validateGstin('37IHKAV5167L1ZS')).toBe('FORMAT'); // PAN 4th char must be X (dataset rule D2)
    const bad = '98IHKXV5167L1Z';
    expect(validateGstin(bad + gstinCheckChar(bad))).toBe('STATE_CODE');
  });
});

describe('repairGstin', () => {
  it('maps digit/letter look-alikes to the class each position requires', () => {
    // 0 in a letter position → O, O in a digit position → 0
    expect(repairGstin('19E0GXH4115Y1ZL')?.value).toBe('19EOGXH4115Y1ZL');
    expect(repairGstin('27XUIXGO767D1ZP')?.value).toBe('27XUIXG0767D1ZP');
  });

  it("forces position 14 to 'Z' when read as 2 or 7", () => {
    expect(repairGstin('32TZAXB5481U171')?.value).toBe('32TZAXB5481U1Z1');
  });

  it('never changes the check character', () => {
    // Only the check character is wrong; the repair must not "fix" it.
    const r = repairGstin('37IHKXV5167L1Z5');
    expect(r?.value).toBe('37IHKXV5167L1Z5');
    expect(validateGstin(r!.value)).toBe('CHECKSUM');
  });

  it('drops one character of a split glyph only when that yields a valid GSTIN', () => {
    expect(repairGstin('07CPCXN0O398P1ZT')?.value).toBe('07CPCXN0398P1ZT');
    // 16 characters with no confusable pair: left as read.
    expect(repairGstin('37IHKXV5167L1ZSW')?.value).toBe('37IHKXV5167L1ZSW');
  });

  it('strips spaces and punctuation', () => {
    expect(repairGstin(' 37IHKXV5167L1ZS. ')?.value).toBe('37IHKXV5167L1ZS');
  });
});

describe('gstinLookalikeCandidates', () => {
  it('includes the true GSTIN when one letter was misread as a look-alike (J read as I)', () => {
    expect(gstinLookalikeCandidates('27QHIXK0658U1ZL')).toContain('27QHJXK0658U1ZL');
  });

  it('only returns checksum-valid candidates and keeps the check character', () => {
    for (const c of gstinLookalikeCandidates('37IHKXV5167L1ZT')) {
      expect(validateGstin(c)).toBeNull();
      expect(c[14]).toBe('T');
    }
  });
});

describe('Udyam', () => {
  it('validates the dataset format and state codes from the registry data', () => {
    expect(validateUdyam('UDYAM-KR-00-1234567')).toBeNull(); // Karnataka is KR in the data
    expect(validateUdyam('UDYAM-ZZ-00-1234567')).toBe('STATE_CODE');
    expect(validateUdyam('UDYAM-MH-00-123456')).toBe('FORMAT');
  });

  it('repairs separators and look-alikes per segment', () => {
    expect(repairUdyam('UDYAM MH 0O 95l6696')?.value).toBe('UDYAM-MH-00-9516696');
    expect(repairUdyam('UDYAM-W8-00-5053330')?.value).toBe('UDYAM-WB-00-5053330');
  });
});
