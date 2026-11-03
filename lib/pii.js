/**
 * lib/pii.js — keep customers' phone numbers and emails away from the LLM.
 *
 * Russian law (152-ФЗ) does not allow passing personal data to a foreign
 * service such as DeepSeek. Contacts are collected by the widget's request
 * form and go straight to our own database (self-hosted Supabase in Russia).
 * But customers also type phones/emails into the chat itself, and every chat
 * message is sent to the LLM. So every text that leaves for the LLM goes
 * through redactText()/redactMessages() first: phones become «[телефон скрыт]»,
 * emails «[email скрыт]».
 *
 * The code still needs the real values in two places, both handled here on
 * our server and never sent to the LLM:
 *   - order status: ABCP checks the order number against the phone/email,
 *   - opening the request form when a customer typed a contact into the chat.
 * findContacts() returns them for that.
 *
 * Phone patterns are deliberately narrow so BMW part numbers (11 digits,
 * often written with spaces: «11 42 8 507 683», «83 19 2 158 851») are never
 * taken for phones:
 *   - Russian mobile: +7 / 7 / 8, then 9xx xxx xx xx (any spaces, dashes, brackets)
 *   - bare mobile:    9xx xxx xx xx (10 digits)
 *   - anything that starts with «+» and has 10-15 digits (+7 495…, foreign)
 *   - landline with the area code in brackets: 8 (495) 123-45-67
 */

const SEP = '[\\s\\-]*';
const PHONE_RES = [
  // +7 / 7 / 8 + mobile 9xx
  new RegExp(`(?<![\\w+])(?:\\+7|7|8)${SEP}\\(?9\\d{2}\\)?${SEP}\\d{3}${SEP}\\d{2}${SEP}\\d{2}(?![\\w])`, 'g'),
  // anything written with a leading «+»
  /\+\d[\d\s\-()]{8,18}\d(?![\w])/g,
  // 8 (495) 123-45-67 -- area code in brackets
  new RegExp(`(?<![\\w+])[78]${SEP}\\(\\d{3,5}\\)${SEP}\\d{1,3}${SEP}\\d{2}${SEP}\\d{2}(?![\\w])`, 'g'),
  // bare mobile 9xx xxx xx xx, not the tail of a longer spaced number
  new RegExp(`(?<![\\w+])(?<!\\d[\\s\\-])\\(?9\\d{2}\\)?${SEP}\\d{3}${SEP}\\d{2}${SEP}\\d{2}(?![\\w])(?![\\s\\-]\\d)`, 'g'),
];
const EMAIL_RE = /[A-Za-z0-9А-Яа-яЁё._%+\-]+@[A-Za-z0-9А-Яа-яЁё\-]+(?:\.[A-Za-z0-9А-Яа-яЁё\-]+)*\.[A-Za-zА-Яа-яЁё]{2,}/g;

const PHONE_MASK = '[телефон скрыт]';
const EMAIL_MASK = '[email скрыт]';

const digitCount = s => (String(s).match(/\d/g) || []).length;

/** Phones and emails in one text, in the order they appear. */
function findContacts(text) {
  const t = String(text || '');
  const emails = t.match(EMAIL_RE) || [];
  let rest = t.replace(EMAIL_RE, ' ');
  const phones = [];
  for (const re of PHONE_RES) {
    rest = rest.replace(re, m => {
      if (digitCount(m) >= 10 && digitCount(m) <= 15) { phones.push(m.trim()); return ' '; }
      return m;
    });
  }
  return { phones, emails };
}

/** The text with every phone and email replaced by a mask. */
function redactText(text) {
  if (typeof text !== 'string' || !text) return text;
  let out = text.replace(EMAIL_RE, EMAIL_MASK);
  for (const re of PHONE_RES) {
    out = out.replace(re, m => (digitCount(m) >= 10 && digitCount(m) <= 15 ? PHONE_MASK : m));
  }
  return out;
}

/** Deep copy of a chat history with every text part redacted. */
function redactMessages(messages) {
  if (!Array.isArray(messages)) return messages;
  return messages.map(m => {
    if (!m || typeof m !== 'object') return m;
    if (typeof m.content === 'string') return { ...m, content: redactText(m.content) };
    if (Array.isArray(m.content)) {
      return { ...m, content: m.content.map(p => (p && p.type === 'text' && typeof p.text === 'string' ? { ...p, text: redactText(p.text) } : p)) };
    }
    return m;
  });
}

const textOf = m => (typeof m?.content === 'string' ? m.content
  : Array.isArray(m?.content) ? m.content.filter(p => p && p.type === 'text').map(p => p.text).join(' ') : '');

/**
 * The newest phone and email the customer typed, looking back over their
 * last `lookBack` messages (an order number and the phone often come in two
 * messages). `inLast` tells whether one was in the very last message.
 */
function latestContacts(messages, lookBack = 6) {
  const users = (Array.isArray(messages) ? messages : []).filter(m => m && m.role === 'user').slice(-lookBack);
  let phone = null, email = null, inLast = false;
  for (let i = users.length - 1; i >= 0; i--) {
    const c = findContacts(textOf(users[i]));
    if (i === users.length - 1 && (c.phones.length || c.emails.length)) inLast = true;
    if (!phone && c.phones.length) phone = c.phones[c.phones.length - 1];
    if (!email && c.emails.length) email = c.emails[c.emails.length - 1];
    if (phone && email) break;
  }
  return { phone, email, inLast };
}

module.exports = { findContacts, redactText, redactMessages, latestContacts, PHONE_MASK, EMAIL_MASK };
