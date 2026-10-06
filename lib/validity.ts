/**
 * Date helpers and the customer sheet parser. Shared by the admin page (live
 * preview) and the server.
 *
 * The sheet has three columns: NETFLIX ID, MOBILE NUMBER, EXPIRY, e.g.
 *   yourname+4@gmail.com <tab> 91 98765 43210 <tab> 12-Oct-26
 */
import { isValidEmail, normalizeEmail } from './emails';

export function formatDisplayDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Today (YYYY-MM-DD) in India time. */
export function todayIso(now = new Date()): string {
  return new Date(now.getTime() + 330 * 60 * 1000).toISOString().slice(0, 10);
}

/** Adds whole months to a YYYY-MM-DD date, clamping to the end of shorter months. */
export function addMonthsIso(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10));
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function buildIso(year: number, month: number, day: number): string | null {
  if (year < 100) year += 2000;
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1) return null;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > lastDay) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// ISO, "14-Jan-27" / "14 January 2027", and day-first "14/01/2027".
const DATE_PATTERNS: Array<{ re: RegExp; toIso: (m: RegExpMatchArray) => string | null }> = [
  { re: /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/, toIso: (m) => buildIso(+m[1], +m[2], +m[3]) },
  {
    re: /\b(\d{1,2})[-\/\s.]+([A-Za-z]{3,9})[-\/\s.,]+(\d{2,4})\b/,
    toIso: (m) => {
      const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
      return month ? buildIso(+m[3], month, +m[1]) : null;
    },
  },
  { re: /\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\b/, toIso: (m) => buildIso(+m[3], +m[2], +m[1]) },
];

/** Normalizes a pasted date to YYYY-MM-DD, or null if it is not a real date. */
export function parseDateToIso(text: string): string | null {
  for (const { re, toIso } of DATE_PATTERNS) {
    const m = text.match(re);
    if (m) return toIso(m);
  }
  return null;
}

/** 10-digit mobile from "91 98765 43210", "+91-98765-43210", "09876543210" ..., or null. */
export function normalizeMobileNumber(raw: unknown): string | null {
  const d = String(raw ?? '').replace(/\D/g, '');
  if (/^\d{10}$/.test(d)) return d;
  if (/^91\d{10}$/.test(d) || /^0\d{10}$/.test(d)) return d.slice(-10);
  return null;
}

export interface ParsedRow {
  netflixEmail: string;
  mobile: string;
  expiryDate: string;
}

export interface SheetParseResult {
  rows: ParsedRow[];
  /** Lines with a Netflix ID but no mobile number (empty seats): ignored. */
  emptySeats: number;
  /** Rows for a mobile number that appeared more than once; the latest expiry was kept. */
  duplicates: number;
  /** Lines that could not be read, with the reason. */
  problems: string[];
}

const EMAIL_RE = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/;

/**
 * Parses rows pasted from Google Sheets / Excel (tab separated) or a CSV.
 * Column order and separators do not matter: each line is read for an email
 * (Netflix ID), a date (expiry) and a phone number (whatever digits are left).
 * A mobile number that appears more than once keeps the row with the latest
 * expiry, which is the customer's newest purchase.
 */
export function parseSheet(text: string): SheetParseResult {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const byMobile = new Map<string, ParsedRow>();
  const problems: string[] = [];
  let emptySeats = 0;
  let duplicates = 0;

  lines.forEach((rawLine, i) => {
    const line = rawLine.trim();
    if (!line) return;

    const emailMatch = line.match(EMAIL_RE);
    if (!emailMatch) {
      // Header ("NETFLIX ID MOBILE NUMBER EXPIRY"), blank-ish rows and notes.
      if (line.replace(/\D/g, '').length >= 8) problems.push(`Line ${i + 1}: no Netflix ID (email) found`);
      return;
    }
    const netflixEmail = normalizeEmail(emailMatch[0]);
    if (!isValidEmail(netflixEmail)) {
      problems.push(`Line ${i + 1}: "${emailMatch[0]}" is not a valid email`);
      return;
    }

    let rest = line.replace(emailMatch[0], ' ');
    let expiryDate: string | null = null;
    let badDate: string | null = null;
    for (const { re, toIso } of DATE_PATTERNS) {
      const m = rest.match(re);
      if (!m) continue;
      rest = rest.replace(m[0], ' ');
      const iso = toIso(m);
      if (iso) {
        expiryDate = iso;
        break;
      }
      badDate = m[0];
    }

    const digits = rest.replace(/\D/g, '');
    if (!digits) {
      emptySeats++;
      return;
    }
    const mobile = normalizeMobileNumber(digits);
    if (!mobile) {
      problems.push(`Line ${i + 1}: "${digits}" is not a valid 10-digit mobile number`);
      return;
    }
    if (!expiryDate) {
      problems.push(
        badDate
          ? `Line ${i + 1}: ${mobile} has an invalid expiry date "${badDate}"`
          : `Line ${i + 1}: ${mobile} has no expiry date`
      );
      return;
    }

    const row: ParsedRow = { netflixEmail, mobile, expiryDate };
    const prev = byMobile.get(mobile);
    if (prev) {
      duplicates++;
      if (row.expiryDate < prev.expiryDate) return;
    }
    byMobile.set(mobile, row);
  });

  return { rows: [...byMobile.values()], emptySeats, duplicates, problems };
}
