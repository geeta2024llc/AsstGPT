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
 * Returns empty string if the input is an @lid privacy ID, a contact name, or invalid.
 */
export function formatPhoneNumber(raw?: string): string {
  if (!raw) return '';

  const str = raw.trim();

  // If raw is an @lid or contains @lid, it is an internal WhatsApp device ID, NOT a phone number
  if (str.endsWith('@lid') || str.includes('@lid')) {
    return '';
  }

  // If raw contains letters and does not end with @s.whatsapp.net, it's a contact name/tag, not a phone number
  const withoutDomain = str.replace(/@(s\.whatsapp\.net|c\.us|broadcast|newsletter)/g, '').trim();
  if (/[a-zA-Z\u0900-\u097F]/.test(withoutDomain)) {
    return '';
  }

  // Extract only digits and possible leading plus
  const digitsOnly = withoutDomain.replace(/\D/g, '');

  if (!digitsOnly || digitsOnly.length < 7 || digitsOnly.length > 15) {
    return '';
  }

  // Nepal phone numbers (977...)
  if (digitsOnly.startsWith('977') && (digitsOnly.length === 12 || digitsOnly.length === 13)) {
    const country = '+977';
    const main = digitsOnly.slice(3);
    if (main.length === 10) {
      return `${country} ${main.slice(0, 4)}-${main.slice(4)}`;
    }
    return `${country} ${main}`;
  }

  // Local Nepal 10-digit mobile (98XXXXXXXX or 97XXXXXXXX)
  if ((digitsOnly.startsWith('98') || digitsOnly.startsWith('97')) && digitsOnly.length === 10) {
    return `+977 ${digitsOnly.slice(0, 4)}-${digitsOnly.slice(4)}`;
  }

  // US/Canada numbers (1...) with 11 digits
  if (digitsOnly.startsWith('1') && digitsOnly.length === 11) {
    return `+1 (${digitsOnly.slice(1, 4)}) ${digitsOnly.slice(4, 7)}-${digitsOnly.slice(7)}`;
  }

  // 10-digit US/North America local
  if (digitsOnly.length === 10 && !digitsOnly.startsWith('98') && !digitsOnly.startsWith('97')) {
    return `(${digitsOnly.slice(0, 3)}) ${digitsOnly.slice(3, 6)}-${digitsOnly.slice(6)}`;
  }

  // Standard generic international formatting (e.g. +44..., +91..., etc.)
  if (digitsOnly.length >= 7 && digitsOnly.length <= 14) {
    return `+${digitsOnly}`;
  }

  return '';
}

/**
 * Returns a human-friendly display name for a contact.
 * Prioritizes authentic human names and safely filters out synthetic bot labels.
 */
export function formatContactName(name?: string, fallbackId?: string): string {
  const cleanName = (name || '').trim();
  const cleanFallback = (fallbackId || '').trim();

  // 1. If name is authentic and not synthetic, use it
  if (cleanName && !isSyntheticOrGenericName(cleanName)) {
    const hasLetters = /[a-zA-Z\u0900-\u097F]/.test(cleanName);
    if (hasLetters) {
      return cleanName;
    }
  }

  // 2. If fallbackId is authentic and not synthetic, use it (e.g. "Manav Shah", "Sherpa Mingma")
  if (cleanFallback && !isSyntheticOrGenericName(cleanFallback)) {
    const hasLetters = /[a-zA-Z\u0900-\u097F]/.test(cleanFallback);
    if (hasLetters && !cleanFallback.includes('@')) {
      return cleanFallback;
    }
  }

  // 3. If fallbackId or candidate is a phone JID or phone number, format it
  const phone = formatPhoneNumber(cleanFallback || cleanName);
  if (phone) {
    return phone;
  }

  // 4. If fallbackId is an @lid privacy account
  const isLid = cleanFallback.endsWith('@lid') || cleanName.endsWith('@lid');
  if (isLid) {
    const digits = (cleanFallback || cleanName).replace(/\D/g, '');
    if (digits.length >= 4) {
      return `WhatsApp User (${digits.slice(-4)})`;
    }
  }

  // 5. If cleanFallback is not synthetic and not empty, use its user part
  if (cleanFallback && !isSyntheticOrGenericName(cleanFallback)) {
    return cleanFallback.split('@')[0];
  }

  return 'WhatsApp Contact';
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
  const isSynthetic = isSyntheticOrGenericName(cleanName);

  // Check if fallbackId is an @lid
  const isLid = Boolean(fallbackId && fallbackId.endsWith('@lid'));

  // Extract real phone number ONLY if valid
  let phone = '';
  if (fallbackId && fallbackId.endsWith('@s.whatsapp.net')) {
    phone = formatPhoneNumber(fallbackId);
  } else if (fallbackId && !isLid) {
    phone = formatPhoneNumber(fallbackId);
  }
  if (!phone && name) {
    phone = formatPhoneNumber(name);
  }

  let displayName = '';
  let hasCustomName = false;

  if (!isSynthetic && cleanName && /[a-zA-Z\u0900-\u097F]/.test(cleanName)) {
    displayName = cleanName;
    hasCustomName = true;
  }

  if (!displayName) {
    if (phone) {
      displayName = phone;
      hasCustomName = false;
    } else if (isLid) {
      const lidDigits = (fallbackId || '').replace(/\D/g, '');
      displayName = `WhatsApp User (${lidDigits.slice(-4)})`;
      hasCustomName = false;
    } else {
      displayName = cleanName || 'WhatsApp Contact';
      hasCustomName = false;
    }
  }

  const avatarInitials = getAvatarInitials(displayName, fallbackId);

  return {
    displayName,
    phoneNumber: phone, // will be empty string if no valid real phone number exists
    hasCustomName: Boolean(hasCustomName && phone), // only true if custom name AND valid phone exist
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
    const rawNum = chatId.replace('@lid', '').replace(/\D/g, '');
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
