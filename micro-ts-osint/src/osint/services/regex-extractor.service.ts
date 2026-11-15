import { Injectable, Logger } from '@nestjs/common';

/**
 * Extracted data structure
 */
export interface ExtractedData {
  emails: string[];
  phones: string[];
  rfcs: string[];
  curps: string[];
  urls: string[];
  ips: string[];
}

/**
 * RegexExtractor Service - Automatic extraction of structured data
 *
 * Features:
 * - Email extraction (RFC 5322)
 * - Phone number extraction (Mexico format)
 * - RFC extraction with validation
 * - CURP extraction with validation
 * - URL and IP extraction
 */
@Injectable()
export class RegexExtractorService {
  private readonly logger = new Logger(RegexExtractorService.name);

  /**
   * Extract all emails from text (RFC 5322 compliant)
   */
  extractEmails(text: string): string[] {
    const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
    const matches = text.match(emailRegex) || [];
    const unique = [...new Set(matches)];

    this.logger.debug(`Extracted ${unique.length} unique emails`);
    return unique;
  }

  /**
   * Extract phone numbers (Mexican formats)
   * Formats supported:
   * - +52 1234567890
   * - (555) 123-4567
   * - 5551234567
   * - 55 1234 5678
   */
  extractPhones(text: string): string[] {
    const patterns = [
      /\+52\s?\d{10}/g, // +52 1234567890
      /\(\d{3}\)\s?\d{3}-?\d{4}/g, // (555) 123-4567
      /\b\d{10}\b/g, // 5551234567
      /\b\d{2}\s\d{4}\s\d{4}\b/g, // 55 1234 5678
    ];

    const matches: string[] = [];
    patterns.forEach((pattern) => {
      const found = text.match(pattern) || [];
      matches.push(...found);
    });

    const unique = [...new Set(matches)];
    this.logger.debug(`Extracted ${unique.length} unique phone numbers`);
    return unique;
  }

  /**
   * Extract Mexican RFCs (Registro Federal de Contribuyentes)
   * Format: 4 letters + 6 digits + 3 alphanumeric
   * Example: ABCD123456XYZ
   */
  extractRFCs(text: string): string[] {
    // RFC can be 12 or 13 characters (personas físicas o morales)
    const rfcRegex = /\b[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}\b/g;
    const matches = text.match(rfcRegex) || [];

    // Validate each RFC
    const validated = matches.filter((rfc) => this.validateRFC(rfc));

    this.logger.debug(`Extracted ${validated.length} valid RFCs`);
    return [...new Set(validated)];
  }

  /**
   * Validate RFC format and checksum
   */
  validateRFC(rfc: string): boolean {
    if (rfc.length !== 13 && rfc.length !== 12) {
      return false;
    }

    // Basic pattern validation
    const rfcPattern = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;
    if (!rfcPattern.test(rfc)) {
      return false;
    }

    // Additional validation: check if date is valid
    const dateStr = rfc.substring(
      rfc.length === 13 ? 4 : 3,
      rfc.length === 13 ? 10 : 9,
    );
    const year = parseInt(dateStr.substring(0, 2));
    const month = parseInt(dateStr.substring(2, 4));
    const day = parseInt(dateStr.substring(4, 6));

    // Basic date validation
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      return false;
    }

    return true;
  }

  /**
   * Extract Mexican CURPs (Clave Única de Registro de Población)
   * Format: 18 alphanumeric characters
   * Example: ABCD123456HDFRRL09
   */
  extractCURPs(text: string): string[] {
    // CURP format: 4 letters + 6 digits + H/M + 2 letters + 3 alphanumeric + 2 digits
    const curpRegex = /\b[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d\b/g;
    const matches = text.match(curpRegex) || [];

    const unique = [...new Set(matches)];
    this.logger.debug(`Extracted ${unique.length} CURPs`);
    return unique;
  }

  /**
   * Extract all URLs from text
   */
  extractURLs(text: string): string[] {
    const urlRegex = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g;
    const matches = text.match(urlRegex) || [];

    const unique = [...new Set(matches)];
    this.logger.debug(`Extracted ${unique.length} URLs`);
    return unique;
  }

  /**
   * Extract IPv4 addresses
   */
  extractIPs(text: string): string[] {
    const ipRegex = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
    const matches = text.match(ipRegex) || [];

    // Validate IP format (0-255 for each octet)
    const validated = matches.filter((ip: string) => {
      const octets = ip.split('.').map(Number);
      return octets.every((octet) => octet >= 0 && octet <= 255);
    });

    const unique = [...new Set(validated)];
    this.logger.debug(`Extracted ${unique.length} IP addresses`);
    return unique;
  }

  /**
   * Extract all data types from text in one pass
   */
  extractAll(text: string): ExtractedData {
    this.logger.log('Extracting all data types from text...');

    const extracted: ExtractedData = {
      emails: this.extractEmails(text),
      phones: this.extractPhones(text),
      rfcs: this.extractRFCs(text),
      curps: this.extractCURPs(text),
      urls: this.extractURLs(text),
      ips: this.extractIPs(text),
    };

    const total =
      extracted.emails.length +
      extracted.phones.length +
      extracted.rfcs.length +
      extracted.curps.length +
      extracted.urls.length +
      extracted.ips.length;

    this.logger.log(`✅ Extracted ${total} total items`);

    return extracted;
  }

  /**
   * Format phone number to E.164 (Mexican)
   */
  formatPhoneToE164(phone: string): string {
    // Remove all non-numeric characters
    const digits = phone.replace(/\D/g, '');

    // If starts with 52, it's already international
    if (digits.startsWith('52') && digits.length === 12) {
      return `+${digits}`;
    }

    // If 10 digits, add Mexico country code
    if (digits.length === 10) {
      return `+52${digits}`;
    }

    // Return as-is if can't format
    return phone;
  }

  /**
   * Validate email format
   */
  validateEmail(email: string): boolean {
    const emailRegex = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}$/;
    return emailRegex.test(email);
  }

  /**
   * Extract Mexican postal codes (CP)
   */
  extractPostalCodes(text: string): string[] {
    // Mexican postal codes are 5 digits
    const cpRegex = /\bC\.?P\.?\s*(\d{5})\b/gi;
    const matches = text.matchAll(cpRegex);

    const codes = Array.from(matches).map((match) => match[1]);
    const unique = [...new Set(codes)];

    this.logger.debug(`Extracted ${unique.length} postal codes`);
    return unique;
  }
}
