/**
 * Utility functions for formatting contact names, phone numbers, and WhatsApp JIDs.
 */

const SYNTHETIC_NAMES_BLACKLIST = [
  'ai follow-up',
  'ai follow up',
  'client pro inquiries',
  'pro inquiries',
  'sample inquiry',
  'me',
  'system',
  'unknown',
  'whatsapp contact',
  'whatsapp user',
  'auto ai',
  'ai agent',
  'ai assistant',
  're-engagement engine',
];

/**
 * Checks if a candidate string is a synthetic bot/system tag or test artifact
 * rather than an authentic human customer name.
 */
export function isSyntheticOrGenericName(name?: string): boolean {
  if (!name) return true;
  const lower = name.trim().toLowerCase();
  if (SYNTHETIC_NAMES_BLACKLIST.some((b) => lower === b || lower.startsWith(b))) {
    return true;
  }
  if (
    lower.startsWith('test_') ||
    lower.startsWith('test-') ||
    lower.includes('_iso_') ||
    lower.includes('_stale_') ||
    lower.includes('iso_178')
  ) {
    return true;
  }
  return false;
}

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
 * Prioritizes authentic human names and safely filters out synthetic bot labels.
 */
export function formatContactName(name?: string, fallbackId?: string): string {
  const cleanName = (name || '').trim();

  // If we have a valid non-synthetic name containing letters, use it
  if (cleanName && !isSyntheticOrGenericName(cleanName)) {
    const hasLetters = /[a-zA-Z\u0900-\u097F]/.test(cleanName);
    if (hasLetters) {
      return cleanName;
    }
  }

  // If name is synthetic, numeric or missing, format the recipient phone number
  const candidate = fallbackId || cleanName || '';
  const isLid = candidate.endsWith('@lid') || (fallbackId && fallbackId.endsWith('@lid'));
  const cleanedDigits = candidate.replace(/@(s\.whatsapp\.net|lid|c\.us)/g, '').replace(/\D/g, '');

  if (isLid && cleanedDigits.length > 12) {
    return `WhatsApp User (${cleanedDigits.slice(-4)})`;
  }

  if (cleanedDigits.length >= 7) {
    return formatPhoneNumber(cleanedDigits);
  }

  return fallbackId?.split('@')[0] || 'WhatsApp Contact';
}

export interface ContactIdentifier {
  displayName: string;
  phoneNumber: string;
  hasCustomName: boolean;
  avatarInitials: string;
}

/**
 * Extracts comprehensive contact credentials: real human name, formatted phone number,
 * and whether a distinct custom name exists.
 */
export function getContactIdentifier(name?: string, fallbackId?: string, company?: string): ContactIdentifier {
  const cleanName = (name || '').trim();
  const phone = formatPhoneNumber(fallbackId || name);
  const isSynthetic = isSyntheticOrGenericName(cleanName);

  let displayName = '';
  let hasCustomName = false;

  if (!isSynthetic && cleanName) {
    const hasLetters = /[a-zA-Z\u0900-\u097F]/.test(cleanName);
    if (hasLetters) {
      displayName = cleanName;
      hasCustomName = true;
    }
  }

  if (!displayName) {
    displayName = phone || formatContactName(name, fallbackId);
    hasCustomName = false;
  }

  const avatarInitials = getAvatarInitials(displayName, fallbackId);

  return {
    displayName,
    phoneNumber: phone || (fallbackId?.split('@')[0] || ''),
    hasCustomName,
    avatarInitials,
  };
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

  // If synthetic name, return user icon
  if (isSyntheticOrGenericName(target)) {
    const digits = target.replace(/\D/g, '');
    if (digits.length >= 2) {
      return digits.slice(-2);
    }
    return '👤';
  }

  // Extract letters (including Nepali/Devanagari if present)
  const lettersOnly = target.replace(/[^a-zA-Z\u0900-\u097F\s]/g, '').trim();

  if (lettersOnly) {
    const words = lettersOnly.split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
      return `${words[0].charAt(0)}${words[1].charAt(0)}`.toUpperCase();
    }
    return words[0].slice(0, 2).toUpperCase();
  }

  // If purely digits / phone, return last 2 digits
  const digits = target.replace(/\D/g, '');
  if (digits.length >= 2) {
    return digits.slice(-2);
  }

  return target.charAt(0).toUpperCase() || '👤';
}
