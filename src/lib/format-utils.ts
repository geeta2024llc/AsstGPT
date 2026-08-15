/**
 * Utility functions for formatting contact names, phone numbers, and WhatsApp JIDs.
 */

/**
 * Formats a raw phone number or WhatsApp JID into an international format.
 */
export function formatPhoneNumber(raw?: string): string {
  if (!raw) return '';

  // Clean out common WhatsApp JID suffixes
  let cleaned = raw.replace(/@(s\.whatsapp\.net|lid|c\.us|newsletter|broadcast)/g, '').trim();

  // If already formatted with spaces/dashes and starts with +, return it
  if (cleaned.startsWith('+') && cleaned.includes(' ')) {
    return cleaned;
  }

  // Extract only digits and possible leading plus
  const hasPlus = cleaned.startsWith('+');
  const digitsOnly = cleaned.replace(/\D/g, '');

  if (!digitsOnly) return raw;

  // Nepal phone numbers (977...)
  if (digitsOnly.startsWith('977') && digitsOnly.length >= 12) {
    const country = '+977';
    const main = digitsOnly.slice(3);
    if (main.length === 10) {
      return `${country} ${main.slice(0, 4)}-${main.slice(4)}`;
    }
    return `${country} ${main}`;
  }

  // US/Canada numbers (1...)
  if (digitsOnly.startsWith('1') && digitsOnly.length === 11) {
    return `+1 (${digitsOnly.slice(1, 4)}) ${digitsOnly.slice(4, 7)}-${digitsOnly.slice(7)}`;
  }

  // 10-digit US/North America local
  if (digitsOnly.length === 10) {
    return `(${digitsOnly.slice(0, 3)}) ${digitsOnly.slice(3, 6)}-${digitsOnly.slice(6)}`;
  }

  // Standard generic international formatting
  if (digitsOnly.length >= 7) {
    return `+${digitsOnly}`;
  }

  return hasPlus ? `+${digitsOnly}` : digitsOnly;
}

/**
 * Returns a human-friendly display name for a contact.
 * Prioritizes actual contact names over raw numbers or JIDs.
 */
export function formatContactName(name?: string, fallbackId?: string): string {
  const cleanName = (name || '').trim();

  // If we have a valid non-system name containing letters, use it
  if (cleanName && cleanName.toLowerCase() !== 'me' && cleanName.toLowerCase() !== 'system') {
    const hasLetters = /[a-zA-Z\u0900-\u097F]/.test(cleanName);
    if (hasLetters) {
      return cleanName;
    }
  }

  // If name is numeric or missing, try formatting the phone number
  const candidate = cleanName || fallbackId || '';
  const isLid = candidate.endsWith('@lid') || (fallbackId && fallbackId.endsWith('@lid'));
  const cleanedDigits = candidate.replace(/@(s\.whatsapp\.net|lid|c\.us)/g, '').replace(/\D/g, '');

  if (isLid && cleanedDigits.length > 12) {
    return `WhatsApp User (${cleanedDigits.slice(-4)})`;
  }

  if (cleanedDigits.length >= 7) {
    return formatPhoneNumber(cleanedDigits);
  }

  return cleanName || fallbackId || 'WhatsApp Contact';
}

/**
 * Returns a clean, user-friendly channel subtitle for the chat header.
 */
export function formatChatSubtitle(chatId?: string, company?: string): string {
  if (!chatId) return '';

  let channelLabel = 'WhatsApp';
  const isLid = chatId.endsWith('@lid');
  const isPhone = chatId.endsWith('@s.whatsapp.net');

  let phoneDisplay = '';
  if (isPhone) {
    phoneDisplay = formatPhoneNumber(chatId);
  } else if (isLid) {
    const rawNum = chatId.replace('@lid', '');
    phoneDisplay = `LID: ${rawNum.slice(-6)}`;
  } else {
    phoneDisplay = formatPhoneNumber(chatId);
  }

  const parts = [channelLabel, phoneDisplay];
  if (company) {
    parts.push(company);
  }

  return parts.filter(Boolean).join(' • ');
}

/**
 * Generates 1-2 uppercase avatar fallback initials from a name or ID.
 */
export function getAvatarInitials(name?: string, fallbackId?: string): string {
  const target = (name || '').trim() || (fallbackId || '').trim();
  if (!target) return '👤';

  // Extract letters (including Nepali/Devanagari if present)
  const lettersOnly = target.replace(/[^a-zA-Z\u0900-\u097F\s]/g, '').trim();

  if (lettersOnly) {
    const words = lettersOnly.split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
      return `${words[0].charAt(0)}${words[1].charAt(0)}`.toUpperCase();
    }
    return words[0].slice(0, 2).toUpperCase();
  }

  // If purely digits / phone, return last 2 digits or user icon
  const digits = target.replace(/\D/g, '');
  if (digits.length >= 2) {
    return digits.slice(-2);
  }

  return target.charAt(0).toUpperCase() || '👤';
}
