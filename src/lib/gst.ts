/**
 * GST on telecom services in India (SAC 9984), 18%. Catalogue prices, quotes and stored totals all exclude it,
 * so quotes show it as its own line instead of folding it into the price. Safe to import in the browser.
 */
export const GST_RATE = 0.18;

/** The GST on an amount, to the nearest rupee. */
export const gstOn = (amount: number) => Math.round(amount * GST_RATE);

/** The amount the customer pays, GST included. */
export const withGst = (amount: number) => amount + gstOn(amount);
