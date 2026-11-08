import { describe, expect, it } from 'vitest';
import { gstOn, withGst } from '@/lib/gst';

describe('GST', () => {
  it('adds 18%, to the nearest rupee', () => {
    expect(gstOn(999)).toBe(180);
    expect(withGst(2000)).toBe(2360);
  });
});
