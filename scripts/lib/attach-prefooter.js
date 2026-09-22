import { PREFOOTER_TYPE } from './config.js';

function collectUnder(value, found) {
  if (typeof value === 'string') {
    if (/^blt[A-Za-z0-9]+$/.test(value)) found.add(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectUnder(item, found);
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (key !== '_metadata' && key !== 'title') collectUnder(child, found);
    }
  }
}

export function attachedPrefooterUids(footer) {
  const found = new Set();
  const visit = value => {
    if (Array.isArray(value)) { for (const child of value) visit(child); return; }
    if (!value || typeof value !== 'object') return;
    if (value._content_type_uid === PREFOOTER_TYPE) collectUnder(value.uid, found);
    for (const [key, child] of Object.entries(value)) {
      if (key === PREFOOTER_TYPE) collectUnder(child, found);
      else if (key !== '_metadata') visit(child);
    }
  };
  visit(footer);
  return [...found];
}

function hasPrefooterSlot(value) {
  if (Array.isArray(value)) return value.some(hasPrefooterSlot);
  if (!value || typeof value !== 'object') return false;
  if (value._content_type_uid === PREFOOTER_TYPE || PREFOOTER_TYPE in value) return true;
  return Object.entries(value).some(([key, child]) => key !== '_metadata' && hasPrefooterSlot(child));
}

function cloneSlot(value) {
  if (Array.isArray(value)) return value.map(cloneSlot);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => key !== '_metadata').map(([key, child]) => [key, cloneSlot(child)]));
  return value;
}

function replaceUnder(value, uid) {
  if (typeof value === 'string') return /^blt[A-Za-z0-9]+$/.test(value) ? uid : value;
  if (Array.isArray(value)) return value.map(child => replaceUnder(child, uid));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, key === '_metadata' || key === 'title' ? child : replaceUnder(child, uid)]));
  return value;
}

export function attachPrefooter(footer, templateFooter, uid) {
  if (!Array.isArray(footer) || !Array.isArray(templateFooter)) throw new Error('footer_components must be an array.');
  const templateSlots = templateFooter.filter(hasPrefooterSlot);
  const currentSlots = footer.filter(hasPrefooterSlot);
  if (templateSlots.length !== 1 || currentSlots.length > 1) throw new Error('Expected exactly one Pre Footer component slot.');
  const source = structuredClone(footer);
  if (!currentSlots.length) source.push(cloneSlot(templateSlots[0]));
  else if (!attachedPrefooterUids(currentSlots).length) source[footer.findIndex(hasPrefooterSlot)] = cloneSlot(templateSlots[0]);
  if (!attachedPrefooterUids(source).length) throw new Error('No preFooter200 reference slot exists in footer_components.');
  const replace = value => {
    if (Array.isArray(value)) return value.map(replace);
    if (!value || typeof value !== 'object') return value;
    if (value._content_type_uid === PREFOOTER_TYPE) return { ...value, uid };
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, key === PREFOOTER_TYPE ? replaceUnder(child, uid) : key === '_metadata' ? child : replace(child)]));
  };
  const result = replace(source);
  const refs = attachedPrefooterUids(result);
  if (refs.length !== 1 || refs[0] !== uid) throw new Error('Could not attach exactly one Pre Footer reference.');
  return result;
}
