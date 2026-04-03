import Imap from 'imap';
import { simpleParser } from 'mailparser';

export interface EmailData {
  from: string;
  subject: string;
  text: string;
  html: string;
}

export async function fetchEmails(
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
      connTimeout: 10000,
      authTimeout: 10000,
    });

    const emails: EmailData[] = [];
    let pendingMessages = 0;

    imap.on('error', (err) => {
      imap.end();
      reject(err);
    });

    imap.on('end', () => {
      if (pendingMessages === 0) {
        resolve(emails);
      }
    });

    imap.openBox('INBOX', false, (err) => {
      if (err) {
        reject(err);
        return;
      }

      const formattedDate = searchSince.toISOString().split('T')[0];
      imap.search([['SINCE', formattedDate]], (err, results) => {
        if (err) {
          imap.end();
          reject(err);
          return;
        }

        if (!results || results.length === 0) {
          imap.end();
          return;
        }

        pendingMessages = results.length;
        const f = imap.fetch(results, { bodies: '' });

        f.on('message', (msg) => {
          simpleParser(msg, (err, parsed) => {
            if (!err && parsed) {
              emails.push({
                from: parsed.from?.text || '',
                subject: parsed.subject || '',
                text: parsed.text || '',
                html: parsed.html || '',
              });
            }
            pendingMessages--;
            if (pendingMessages === 0) {
              imap.end();
            }
          });
        });

        f.on('error', (err) => {
          imap.end();
          reject(err);
        });

        f.on('end', () => {
          // Wait for all messages to be parsed
        });
      });
    });

    imap.openConnection();
  });
}
