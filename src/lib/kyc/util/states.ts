/**
 * State lookup between GST numeric codes, Udyam letter codes and names.
 * Udyam codes follow the registry data (Karnataka = KR, Telangana = TS), not the rules doc (which says KA).
 */
export interface StateInfo {
  name: string;
  gstCode: string;
  udyamCode: string;
}

export const STATES: readonly StateInfo[] = [
  { name: 'Jammu and Kashmir', gstCode: '01', udyamCode: 'JK' },
  { name: 'Himachal Pradesh', gstCode: '02', udyamCode: 'HP' },
  { name: 'Punjab', gstCode: '03', udyamCode: 'PB' },
  { name: 'Chandigarh', gstCode: '04', udyamCode: 'CH' },
  { name: 'Uttarakhand', gstCode: '05', udyamCode: 'UK' },
  { name: 'Haryana', gstCode: '06', udyamCode: 'HR' },
  { name: 'Delhi', gstCode: '07', udyamCode: 'DL' },
  { name: 'Rajasthan', gstCode: '08', udyamCode: 'RJ' },
  { name: 'Uttar Pradesh', gstCode: '09', udyamCode: 'UP' },
  { name: 'Bihar', gstCode: '10', udyamCode: 'BR' },
  { name: 'Sikkim', gstCode: '11', udyamCode: 'SK' },
  { name: 'Arunachal Pradesh', gstCode: '12', udyamCode: 'AR' },
  { name: 'Nagaland', gstCode: '13', udyamCode: 'NL' },
  { name: 'Manipur', gstCode: '14', udyamCode: 'MN' },
  { name: 'Mizoram', gstCode: '15', udyamCode: 'MZ' },
  { name: 'Tripura', gstCode: '16', udyamCode: 'TR' },
  { name: 'Meghalaya', gstCode: '17', udyamCode: 'ML' },
  { name: 'Assam', gstCode: '18', udyamCode: 'AS' },
  { name: 'West Bengal', gstCode: '19', udyamCode: 'WB' },
  { name: 'Jharkhand', gstCode: '20', udyamCode: 'JH' },
  { name: 'Odisha', gstCode: '21', udyamCode: 'OD' },
  { name: 'Chhattisgarh', gstCode: '22', udyamCode: 'CG' },
  { name: 'Madhya Pradesh', gstCode: '23', udyamCode: 'MP' },
  { name: 'Gujarat', gstCode: '24', udyamCode: 'GJ' },
  { name: 'Dadra and Nagar Haveli and Daman and Diu', gstCode: '26', udyamCode: 'DH' },
  { name: 'Maharashtra', gstCode: '27', udyamCode: 'MH' },
  { name: 'Karnataka', gstCode: '29', udyamCode: 'KR' },
  { name: 'Goa', gstCode: '30', udyamCode: 'GA' },
  { name: 'Lakshadweep', gstCode: '31', udyamCode: 'LD' },
  { name: 'Kerala', gstCode: '32', udyamCode: 'KL' },
  { name: 'Tamil Nadu', gstCode: '33', udyamCode: 'TN' },
  { name: 'Puducherry', gstCode: '34', udyamCode: 'PY' },
  { name: 'Andaman and Nicobar Islands', gstCode: '35', udyamCode: 'AN' },
  { name: 'Telangana', gstCode: '36', udyamCode: 'TS' },
  { name: 'Andhra Pradesh', gstCode: '37', udyamCode: 'AP' },
  { name: 'Ladakh', gstCode: '38', udyamCode: 'LA' },
];

const key = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z]/g, '');

const byGst = new Map(STATES.map((s) => [s.gstCode, s]));
const byUdyam = new Map(STATES.map((s) => [s.udyamCode, s]));
const byKey = new Map(STATES.map((s) => [key(s.name), s]));

export const stateByGstCode = (code: string): StateInfo | undefined => byGst.get(code);
export const stateByUdyamCode = (code: string): StateInfo | undefined => byUdyam.get(code.toUpperCase());

/** Exact match on the normalized name (case, spaces, punctuation and "&"/"and" ignored). */
export function stateByName(name: string | null | undefined): StateInfo | undefined {
  if (!name) return undefined;
  return byKey.get(key(name));
}

/** All state names, longest first (so "Andhra Pradesh" is tried before shorter names when scanning text). */
export const STATE_NAMES_LONGEST_FIRST = [...STATES].map((s) => s.name).sort((a, b) => b.length - a.length);
