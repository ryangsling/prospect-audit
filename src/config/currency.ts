export const countries = ['US', 'UK', 'CA', 'AU'] as const;
export type Country = typeof countries[number];

export const countryNames = { US: 'United States', UK: 'United Kingdom', CA: 'Canada', AU: 'Australia' };
export const currency = {
  US: { code: 'USD', perUsd: 1 },
  UK: { code: 'GBP', perUsd: 0.8 },
  CA: { code: 'CAD', perUsd: 1.35 },
  AU: { code: 'AUD', perUsd: 1.5 },
} as const;

export function formatMoney(amount: number, country: Country) {
  const locale = { US: 'en-US', UK: 'en-GB', CA: 'en-CA', AU: 'en-AU' }[country];
  return new Intl.NumberFormat(locale, {
    style: 'currency', currency: currency[country].code, maximumFractionDigits: 0,
  }).format(amount);
}
