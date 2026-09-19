export interface CurrencyInfo {
  symbol: string;
  name: string;
}

export const CURRENCIES: Record<string, CurrencyInfo> = {
  INR: { symbol: '₹', name: 'Indian Rupee' },
  USD: { symbol: '$', name: 'US Dollar' },
  EUR: { symbol: '€', name: 'Euro' },
  GBP: { symbol: '£', name: 'British Pound' },
  AED: { symbol: 'د.إ', name: 'UAE Dirham' },
  SAR: { symbol: '﷼', name: 'Saudi Riyal' },
  SGD: { symbol: 'S$', name: 'Singapore Dollar' },
  MYR: { symbol: 'RM', name: 'Malaysian Ringgit' },
  AUD: { symbol: 'A$', name: 'Australian Dollar' },
  CAD: { symbol: 'C$', name: 'Canadian Dollar' },
  JPY: { symbol: '¥', name: 'Japanese Yen' },
  CNY: { symbol: '¥', name: 'Chinese Yuan' },
  BDT: { symbol: '৳', name: 'Bangladeshi Taka' },
  PKR: { symbol: '₨', name: 'Pakistani Rupee' },
  LKR: { symbol: '₨', name: 'Sri Lankan Rupee' },
  NPR: { symbol: '₨', name: 'Nepalese Rupee' },
  THB: { symbol: '฿', name: 'Thai Baht' },
  IDR: { symbol: 'Rp', name: 'Indonesian Rupiah' },
  VND: { symbol: '₫', name: 'Vietnamese Dong' },
  PHP: { symbol: '₱', name: 'Philippine Peso' },
  KRW: { symbol: '₩', name: 'South Korean Won' },
};

export const CURRENCY_ORDER: readonly string[] = [
  'INR',
  'USD',
  'EUR',
  'GBP',
  'AED',
  'SAR',
  'SGD',
  'MYR',
  'AUD',
  'CAD',
  'JPY',
  'CNY',
  'BDT',
  'PKR',
  'LKR',
  'NPR',
  'THB',
  'IDR',
  'VND',
  'PHP',
  'KRW',
];

export interface TimezoneOption {
  id: string;
  label: string;
}

export const TIMEZONES: readonly TimezoneOption[] = [
  { id: 'Asia/Kolkata', label: 'Asia/Kolkata' },
  { id: 'Asia/Dubai', label: 'Asia/Dubai' },
  { id: 'Asia/Karachi', label: 'Asia/Karachi' },
  { id: 'Asia/Dhaka', label: 'Asia/Dhaka' },
  { id: 'Asia/Singapore', label: 'Asia/Singapore' },
  { id: 'Asia/Tokyo', label: 'Asia/Tokyo' },
  { id: 'Europe/London', label: 'Europe/London' },
  { id: 'Europe/Berlin', label: 'Europe/Berlin' },
  { id: 'America/New_York', label: 'America/New_York' },
  { id: 'America/Chicago', label: 'America/Chicago' },
  { id: 'America/Los_Angeles', label: 'America/Los_Angeles' },
  { id: 'Australia/Sydney', label: 'Australia/Sydney' },
];

export function currencySymbol(code: string): string {
  return CURRENCIES[code]?.symbol ?? code;
}

export function formatAmount(value: string | number, code: string): string {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return `${currencySymbol(code)}${value}`;
  const sign = num < 0 ? '-' : '';
  const [intPart = '0', decPart = ''] = Math.abs(num).toFixed(2).split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const decimals = decPart && decPart !== '00' ? `.${decPart}` : '';
  return `${sign}${currencySymbol(code)}${grouped}${decimals}`;
}
