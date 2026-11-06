import { completeness, fieldsPresent } from './completeness';
import { consistencyAddress, consistencyName, consistencyProprietor, consistencyState } from './consistency';
import { dates, signatory } from './dates';
import { formatGstin, formatUdyam } from './format';
import { registryGst, registryUdyam } from './registry';
import type { Rule } from './context';

/** Rules in execution order. Later rules read state (gstin, gstRec, …) written by earlier ones. */
export const RULES: readonly Rule[] = [
  completeness,
  fieldsPresent,
  formatGstin,
  formatUdyam,
  registryGst,
  registryUdyam,
  consistencyName,
  consistencyState,
  consistencyAddress,
  consistencyProprietor,
  dates,
  signatory,
];

export type { Rule, RuleCtx } from './context';
