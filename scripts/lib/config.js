export const LOCALE = 'en-us';
export const STACK_UID = 'blt964243cdd7810dea';
export const PREFOOTER_TYPE = 'preFooter200';
export const PREFOOTER_TEMPLATE_UID = 'blt29ddffbf843c45a2';

export const PLP_TYPES = Object.freeze({
  Brand: { contentType: 'brandPlpPage', templateUid: 'bltdb6f4024a49e825e' },
  L1: { contentType: 'l1CategoryPlpPage', templateUid: 'blt18272c4989346304' },
  L2: { contentType: 'l2CategoryPlpPage', templateUid: 'blte43b63cdf94f0aa9' },
  L3: { contentType: 'l3CategoryPlpPage', templateUid: 'blt83444413144bbd0f' }
});

export function canonicalPlpType(raw) {
  const key = String(raw || '').trim().toLowerCase();
  return Object.keys(PLP_TYPES).find(type => type.toLowerCase() === key) || null;
}
