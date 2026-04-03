import Imap from 'imap'
import { simpleParser } from 'mailparser'

export interface EmailData {
  from: string
  subject: string
  text: string
  html: string
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
      connTimeout: 15000,
      authTimeout: 10000,
    })

    const emails: EmailData[] = []

    imap.once('error', (err: Error) => {
      reject(err)
    })

    // CRITICAL: Must wait for 'ready' before calling openBox
    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err) => {
        if (err) {
          imap.end()
          reject(err)
          return
        }

        // Search for Netflix emails since the given date
        const searchCriteria = [
          ['OR',
            ['FROM', 'info@account.netflix.com'],
            ['FROM', 'noreply@netflix.com']
          ],
          ['SINCE', searchSince]
        ]

        imap.search(searchCriteria, (err, results) => {
          if (err) {
            imap.end()
            reject(err)
            return
          }

          if (!results || results.length === 0) {
            imap.end()
            resolve([])
            return
          }

          const fetch = imap.fetch(results, { bodies: '' })
          const parsePromises: Promise<void>[] = []

          fetch.on('message', (msg) => {
            const promise = new Promise<void>((res) => {
              const chunks: Buffer[] = []

              msg.on('body', (stream) => {
                stream.on('data', (chunk: Buffer) => chunks.push(chunk))
                stream.once('end', async () => {
                  try {
                    const buffer = Buffer.concat(chunks)
                    const parsed = await simpleParser(buffer)
                    emails.push({
                      from: parsed.from?.text || '',
                      subject: parsed.subject || '',
                      text: parsed.text || '',
                      html: (parsed.html as string) || '',
                    })
                  } catch {
                    // skip unparseable emails
                  }
                  res()
                })
              })
            })
            parsePromises.push(promise)
          })

          fetch.once('error', (err) => {
            imap.end()
            reject(err)
          })

          fetch.once('end', async () => {
            await Promise.all(parsePromises)
            imap.end()
            resolve(emails)
          })
        })
      })
    })

    // CRITICAL: This is the correct method to initiate connection
    imap.connect()
  })
}
