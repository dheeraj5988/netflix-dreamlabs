import 'server-only';
import Imap from 'imap';
import { simpleParser } from 'mailparser';
import { aliasKey, mailboxKey } from './emails';
import { parseNetflixVerificationLink } from './emailParser';
import { getMailboxSecrets } from './store';

/**
 * Reads the Netflix "update household" email for ONE Netflix ID.
 *
 * Several Netflix IDs usually share one Gmail inbox (name+4@gmail.com,
 * name+5@gmail.com, na.me@gmail.com ... all deliver to name@gmail.com), so
 * the newest Netflix email in the inbox can belong to another customer's
 * account. Every message is therefore matched on its recipient address and
 * only mail addressed to the customer's own Netflix ID is ever used.
 *
 * Inbox logins (Gmail address + Google app password) are saved in the admin
 * panel (Settings > Gmail Inboxes). The old environment variables
 *   GMAIL_USER_1 / GMAIL_APP_PASSWORD_1, GMAIL_USER_2 / GMAIL_APP_PASSWORD_2, ...
 * (or GMAIL_USER / GMAIL_APP_PASSWORD) still work as a fallback, so nothing
 * breaks while moving; an inbox saved in the panel wins over the same inbox in
 * the environment. A Netflix ID is matched to the inbox with the same Gmail
 * address, ignoring +tags and dots.
 */

export interface EmailData {
  from: string;
  subject: string;
  text: string;
  html: string;
  date: Date;
}

export interface MailboxCredentials {
  user: string;
  password: string;
  /** Where the login comes from: saved in the admin panel, or a Vercel environment variable. */
  source?: 'panel' | 'env';
  id?: string;
}

export type MailboxErrorCode = 'not_configured' | 'auth' | 'timeout' | 'connection' | 'imap';

export class MailboxError extends Error {
  code: MailboxErrorCode;
  constructor(code: MailboxErrorCode, message: string) {
    super(message);
    this.name = 'MailboxError';
    this.code = code;
  }
}

export type HouseholdLookup =
  | { ok: true; url: string; emailDate: Date; subject: string }
  | { ok: false; reason: 'no_email' | 'no_link'; scanned: number };

const MAX_INBOX_SLOTS = 30;
const HEADER_SCAN_LIMIT = 60;
const BODY_FETCH_LIMIT = 5;
const OVERALL_TIMEOUT_MS = 45_000;

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

export function envMailboxes(): MailboxCredentials[] {
  const out: MailboxCredentials[] = [];
  const suffixes = ['', ...Array.from({ length: MAX_INBOX_SLOTS }, (_, i) => `_${i + 1}`)];
  for (const s of suffixes) {
    const user = (process.env[`GMAIL_USER${s}`] || '').trim();
    const password = (process.env[`GMAIL_APP_PASSWORD${s}`] || '').replace(/\s/g, '');
    if (user && password) out.push({ user, password, source: 'env' });
  }
  return out;
}

/** Every inbox we can log in to: the ones saved in the panel, then environment ones not already saved. */
export async function loadMailboxes(): Promise<MailboxCredentials[]> {
  let saved: MailboxCredentials[] = [];
  try {
    saved = (await getMailboxSecrets()).map((m) => ({ ...m, source: 'panel' as const }));
  } catch (err: any) {
    // For example the settings SQL has not been run yet: the environment fallback still works.
    console.error('[mailboxes] could not load saved inboxes:', err?.message);
  }
  const have = new Set(saved.map((m) => mailboxKey(m.user)));
  return [...saved, ...envMailboxes().filter((m) => !have.has(mailboxKey(m.user)))];
}

/** The inbox login that receives mail for this Netflix ID, if any. */
export async function findMailbox(netflixEmail: string): Promise<MailboxCredentials | null> {
  const key = mailboxKey(netflixEmail);
  return (await loadMailboxes()).find((m) => mailboxKey(m.user) === key) ?? null;
}

// ---------------------------------------------------------------------------
// IMAP plumbing
// ---------------------------------------------------------------------------

function classify(err: any): MailboxError {
  if (err instanceof MailboxError) return err;
  const msg = String(err?.message || err || 'IMAP error');
  const text = String(err?.textCode || '');
  if (text === 'AUTHENTICATIONFAILED' || /auth|invalid credentials|login failed|application-specific/i.test(msg)) {
    return new MailboxError('auth', 'Gmail rejected the login. Check the app password for this inbox.');
  }
  if (/timed out|timeout|ETIMEDOUT/i.test(msg)) return new MailboxError('timeout', 'Gmail did not answer in time.');
  if (/ECONN|ENOTFOUND|EAI_AGAIN|socket|closed/i.test(msg)) {
    return new MailboxError('connection', 'Could not connect to Gmail.');
  }
  return new MailboxError('imap', msg);
}

function connect(creds: MailboxCredentials): Promise<Imap> {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: creds.user,
      password: creds.password,
      host: 'imap.gmail.com',
      port: 993,
      tls: true,
      tlsOptions: { servername: 'imap.gmail.com' },
      connTimeout: 15_000,
      authTimeout: 12_000,
    });
    let ready = false;
    imap.once('ready', () => {
      ready = true;
      resolve(imap);
    });
    // Keep an error listener for the whole life of the connection: an unhandled 'error'
    // event after login (e.g. a reset socket) would otherwise crash the function.
    imap.on('error', (err: Error) => {
      if (!ready) reject(classify(err));
      else console.error('[imap]', err.message);
    });
    imap.connect();
  });
}

function openInbox(imap: Imap): Promise<void> {
  // Read-only: looking up a link must never mark customers' mail as read.
  return new Promise((resolve, reject) => {
    imap.openBox('INBOX', true, (err) => (err ? reject(classify(err)) : resolve()));
  });
}

function search(imap: Imap, criteria: any[]): Promise<number[]> {
  return new Promise((resolve, reject) => {
    imap.search(criteria, (err, uids) => (err ? reject(classify(err)) : resolve(uids || [])));
  });
}

interface HeaderInfo {
  uid: number;
  date: Date;
  recipients: Set<string>;
  subject: string;
}

const EMAIL_IN_HEADER = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g;

function fetchHeaders(imap: Imap, uids: number[]): Promise<HeaderInfo[]> {
  return new Promise((resolve, reject) => {
    if (uids.length === 0) return resolve([]);
    const out: HeaderInfo[] = [];
    const f = imap.fetch(uids, {
      bodies: 'HEADER.FIELDS (FROM TO CC DELIVERED-TO X-ORIGINAL-TO SUBJECT DATE)',
      struct: false,
    });
    f.on('message', (msg) => {
      let uid = 0;
      let internalDate: Date | undefined;
      const chunks: Buffer[] = [];
      msg.on('body', (stream) => {
        stream.on('data', (c: Buffer) => chunks.push(c));
      });
      msg.once('attributes', (attrs) => {
        uid = attrs.uid;
        internalDate = attrs.date;
      });
      msg.once('end', () => {
        const header = Imap.parseHeader(Buffer.concat(chunks).toString('utf8'));
        const recipients = new Set<string>();
        for (const name of ['to', 'cc', 'delivered-to', 'x-original-to']) {
          for (const value of header[name] || []) {
            for (const addr of value.match(EMAIL_IN_HEADER) || []) recipients.add(aliasKey(addr));
          }
        }
        const headerDate = header.date?.[0] ? new Date(header.date[0]) : undefined;
        const date = internalDate || (headerDate && !Number.isNaN(headerDate.getTime()) ? headerDate : new Date(0));
        out.push({ uid, date, recipients, subject: header.subject?.[0] || '' });
      });
    });
    f.once('error', (err: Error) => reject(classify(err)));
    f.once('end', () => resolve(out));
  });
}

function fetchEmail(imap: Imap, uid: number): Promise<EmailData> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const f = imap.fetch([uid], { bodies: '' });
    f.on('message', (msg) => {
      const chunks: Buffer[] = [];
      msg.on('body', (stream) => {
        stream.on('data', (c: Buffer) => chunks.push(c));
      });
      msg.once('end', async () => {
        try {
          const parsed = await simpleParser(Buffer.concat(chunks));
          settled = true;
          resolve({
            from: parsed.from?.text || '',
            subject: parsed.subject || '',
            text: parsed.text || '',
            html: typeof parsed.html === 'string' ? parsed.html : '',
            date: parsed.date || new Date(),
          });
        } catch (err) {
          settled = true;
          reject(classify(err));
        }
      });
    });
    f.once('error', (err: Error) => reject(classify(err)));
    f.once('end', () => {
      setTimeout(() => {
        if (!settled) reject(new MailboxError('imap', 'Email body was empty'));
      }, 2_000);
    });
  });
}

function close(imap: Imap | null) {
  try {
    imap?.end();
  } catch {
    // already closed
  }
}

function withTimeout<T>(work: (setImap: (i: Imap) => void) => Promise<T>): Promise<T> {
  let imap: Imap | null = null;
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      close(imap);
      reject(new MailboxError('timeout', 'Gmail did not answer in time.'));
    }, OVERALL_TIMEOUT_MS);
  });
  return Promise.race([work((i) => (imap = i)), timeout]).finally(() => {
    clearTimeout(timer);
    close(imap);
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Finds the newest "update your Netflix household" link that Netflix emailed
 * to this Netflix ID within the last `minutes`.
 */
export async function findHouseholdLink(netflixEmail: string, minutes: number): Promise<HouseholdLookup> {
  const creds = await findMailbox(netflixEmail);
  if (!creds) throw new MailboxError('not_configured', 'No Gmail login is configured for this Netflix ID.');

  const target = aliasKey(netflixEmail);
  const cutoff = Date.now() - minutes * 60 * 1000;

  return withTimeout(async (setImap) => {
    const imap = await connect(creds);
    setImap(imap);
    try {
      await openInbox(imap);

      // IMAP SINCE only has day resolution (and uses the server's day), so ask for a
      // day of slack and apply the exact cutoff on the message's received time below.
      const since = new Date(cutoff - 24 * 60 * 60 * 1000);
      const uids = await search(imap, [['FROM', 'netflix.com'], ['SINCE', since]]);
      const recent = uids.slice(-HEADER_SCAN_LIMIT);

      const headers = await fetchHeaders(imap, recent);
      const mine = headers
        .filter((h) => h.date.getTime() >= cutoff && h.recipients.has(target))
        .sort((a, b) => b.date.getTime() - a.date.getTime())
        .slice(0, BODY_FETCH_LIMIT);

      if (mine.length === 0) return { ok: false as const, reason: 'no_email' as const, scanned: headers.length };

      // Newest first. Prefer a real "update primary location" link; accept the other
      // household/verification links only if none of the recent emails has one.
      let fallback: { url: string; emailDate: Date; subject: string } | null = null;
      for (const h of mine) {
        const email = await fetchEmail(imap, h.uid);
        const link = parseNetflixVerificationLink(email);
        if (!link) continue;
        const hit = { url: link.url, emailDate: h.date, subject: email.subject };
        if (link.kind === 'primary') return { ok: true as const, ...hit };
        fallback ??= hit;
      }
      if (fallback) return { ok: true as const, ...fallback };
      return { ok: false as const, reason: 'no_link' as const, scanned: headers.length };
    } catch (err) {
      throw classify(err);
    }
  });
}

/** Can we log in to this inbox? */
export async function testMailboxCredentials(creds: MailboxCredentials): Promise<{ ok: boolean; message: string; inbox: string }> {
  try {
    await withTimeout(async (setImap) => {
      const imap = await connect(creds);
      setImap(imap);
      await openInbox(imap);
    });
    return { ok: true, message: 'Connected to the Gmail inbox.', inbox: creds.user };
  } catch (err) {
    return { ok: false, message: classify(err).message, inbox: creds.user };
  }
}

/** Admin check: can we log in to the inbox that serves this Netflix ID? */
export async function testMailbox(netflixEmail: string): Promise<{ ok: boolean; message: string; inbox?: string }> {
  const creds = await findMailbox(netflixEmail);
  if (!creds) {
    return {
      ok: false,
      message: `No Gmail login is saved for ${mailboxKey(netflixEmail)}. Add it in Settings > Gmail Inboxes.`,
    };
  }
  return testMailboxCredentials(creds);
}
