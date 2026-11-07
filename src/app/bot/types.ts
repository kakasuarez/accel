// Wire types for the leads API, derived from the server's own view functions (type-only imports).
import type { CustomerLead, IntakeState } from '@/lib/dashboard/data';
import type { BundleTotals } from '@/lib/recommender/types';

export type { CustomerLead, IntakeState, BundleTotals };
export type PublicQuestion = NonNullable<IntakeState['nextQuestion']>;
export type CustomerRecommendation = NonNullable<IntakeState['recommendation']>;
export type AddOn = CustomerRecommendation['addOns'][number];
export type BundleChoice = NonNullable<IntakeState['bundles']>[number];
export type LeadState = IntakeState & { lead: CustomerLead };
export type AnswerResult = IntakeState & ({ status: 'answered'; value: unknown } | { status: 'unclear'; reason: string });
