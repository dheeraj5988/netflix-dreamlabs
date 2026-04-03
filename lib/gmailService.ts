import Imap from 'imap';
import { simpleParser } from 'mailparser';

export interface EmailData {
  from: string;
  subject: string;
  text: string;
  html: string;
}

async function fetchEmails(
  userEmail: string,
  appPassword: string,
  searchSince: Date
): Promise<EmailData[]> {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: userEmail,
      password: appPassword.replace(/\s/g, ''),
      host: 'imap.gmail.com',
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
    });

    const emails: EmailData[] = [];

    const openInbox = (cb: (err: any, mailbox: any) => void) => {
      imap.openBox('INBOX', false, cb);
    };

    imap.on('error', reject);
    imap.on('end', () => {
      resolve(emails);
    });

    imap.openBox('INBOX', false, (err, mailbox) => {
      if (err) {
        reject(err);
        return;
      }

      const formattedDate = searchSince.toISOString().split('T')[0];
      imap.search([['SINCE', formattedDate]], (err, results) => {
        if (err) {
          reject(err);
          return;
        }

        if (!results || results.length === 0) {
          imap.end();
          return;
        }

        const f = imap.fetch(results, { bodies: '' });
        f.on('message', (msg: any) => {
          simpleParser(msg, async (err: any, parsed: any) => {
            if (!err && parsed) {
              emails.push({
                from: parsed.from?.text || '',
                subject: parsed.subject || '',
                text: parsed.text || '',
                html: parsed.html || '',
              });
            }
          });
        });

        f.on('error', reject);
        f.on('end', () => {
          imap.end();
        });
      });
    });

    imap.openBox('INBOX', false, (err) => {
      if (err) reject(err);
    });
  });
}

export { fetchEmails };
