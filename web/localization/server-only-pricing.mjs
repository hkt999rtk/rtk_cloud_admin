// Numeric currency comparisons belong only in the owner-scoped pricing API.
// Retain approved translations for the Go BFF, but omit them from public JS.
export const isServerOnlyPricingSource = source => /(?:US\$|NT\$).*?[0-9]|[0-9].*(?:US\$|NT\$)/.test(source);
