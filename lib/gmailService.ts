import Imap from 'imap'
import { simpleParser } from 'mailparser'

export interface EmailData {
  from: string
  subject: string
  text: string
  html: string
  date: Date
}

class GmailService {
  private imap: Imap

  constructor(userEmail: string, appPassword: string) {
    this.imap = new Imap({
      user: userEmail,
      password: appPassword.replace(/\s/g, ''),
      host: 'imap.gmail.com',
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
      connTimeout: 15000,
      authTimeout: 10000,
    })
  }

  private createConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.imap.once('ready', () => resolve())
      this.imap.once('error', (err) => reject(err))
      this.imap.once('close', () => reject(new Error('Connection closed')))
      this.imap.connect()
    })
  }

  private openInbox(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.imap.openBox('INBOX', false, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  private searchEmails(
    emailAddresses: string[],
    searchSince: Date
  ): Promise<number[]> {
    return new Promise((resolve, reject) => {
      // Build sequential searches: try first email address, then second if needed
      const performSearch = (index: number) => {
        if (index >= emailAddresses.length) {
          resolve([])
          return
        }

        const criteria = [['FROM', emailAddresses[index]], ['SINCE', searchSince]]

        this.imap.search(criteria, (err, results) => {
          if (err) {
            reject(err)
            return
          }

          if (results && results.length > 0) {
            resolve(results)
          } else {
            // No results, try next email address
            performSearch(index + 1)
          }
        })
      }

      performSearch(0)
    })
  }

  private fetchEmail(uid: number): Promise<EmailData> {
    return new Promise((resolve, reject) => {
      const f = this.imap.fetch(uid, { bodies: '' })

      f.on('message', (msg) => {
        const chunks: Buffer[] = []

        msg.on('body', (stream) => {
          stream.on('data', (chunk: Buffer) => chunks.push(chunk))
          stream.once('end', async () => {
            try {
              const buffer = Buffer.concat(chunks)
              const parsed = await simpleParser(buffer)
              resolve({
                from: parsed.from?.text || '',
                subject: parsed.subject || '',
                text: parsed.text || '',
                html: (parsed.html as string) || '',
                date: parsed.date || new Date(),
              })
            } catch (err) {
              reject(err)
            }
          })
        })
      })

      f.once('error', (err) => reject(err))
    })
  }

  private closeConnection(): Promise<void> {
    return new Promise((resolve) => {
      this.imap.end()
      this.imap.once('close', () => resolve())
      // Fallback timeout to prevent hanging
      setTimeout(resolve, 1000)
    })
  }

  async fetchLatestEmail(
    searchSince: Date
  ): Promise<EmailData | null> {
    try {
      await this.createConnection()
      await this.openInbox()

      // Sequential search: try info@account.netflix.com first, then noreply@netflix.com
      const results = await this.searchEmails(
        ['info@account.netflix.com', 'noreply@netflix.com'],
        searchSince
      )

      if (!results || results.length === 0) {
        return null
      }

      // Get the LATEST email UID (highest number = most recent)
      const latestEmailId = results[results.length - 1]

      // Fetch only this single email
      const email = await this.fetchEmail(latestEmailId)
      return email
    } finally {
      await this.closeConnection()
    }
  }
}

export async function fetchLatestNetflixEmail(
  userEmail: string,
  appPassword: string,
  searchSince: Date
): Promise<EmailData | null> {
  const service = new GmailService(userEmail, appPassword)
  return service.fetchLatestEmail(searchSince)
}
