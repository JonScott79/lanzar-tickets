/*
    emailService.js

    LANZAR Support Tickets email communication service.

    Responsibilities

    - Send outbound transactional email notifications (new ticket, admin more info, customer response)
    - Set up ticket-specific Reply-To headers for two-way email tracking
    - Handle SMTP connection configurations safely
    - Support automatic Ethereal Mail account generation for zero-config testing
*/

import nodemailer from 'nodemailer'
import dotenv from 'dotenv'

dotenv.config()

if (!process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
  console.log('[EMAIL] SMTP configuration missing')
  console.log('[EMAIL] Email delivery unavailable until production SMTP variables are configured')
}

let transporter = null

/**
 * Get or initialize the Nodemailer transporter.
 * If credentials are not supplied, it dynamically generates an Ethereal test account.
 */
async function getTransporter() {
  if (transporter) {
    return transporter
  }

  const host = process.env.SMTP_HOST || 'smtp.ethereal.email'
  const port = parseInt(process.env.SMTP_PORT || '587', 10)
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASSWORD

  if (user && pass) {
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass }
    })
    console.log(`[EMAIL] SMTP Transporter initialized using configured user: ${user}`)
  } else {
    // If running in production (or on Railway), do not spin up Ethereal mail dynamically!
    if (process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT) {
      console.warn('[EMAIL] SMTP configuration missing')
      console.warn('[EMAIL] Email delivery unavailable until production SMTP variables are configured')
      transporter = {
        sendMail: async (options) => {
          console.warn(`[EMAIL WARN] Email send attempted but SMTP is not configured. Recipient: ${options.to}`)
          throw new Error('SMTP configuration missing. Email delivery unavailable.')
        }
      }
    } else {
      console.log('[EMAIL] No SMTP credentials provided. Creating temporary Ethereal test account...')
      try {
        const testAccount = await nodemailer.createTestAccount()
        transporter = nodemailer.createTransport({
          host: 'smtp.ethereal.email',
          port: 587,
          secure: false,
          auth: {
            user: testAccount.user,
            pass: testAccount.pass
          }
        })
        console.log(`[EMAIL] Temporary Ethereal account created:`)
        console.log(`  User: ${testAccount.user}`)
        console.log(`  Pass: [Generated Pass]`)
      } catch (err) {
        console.error('[EMAIL ERROR] Failed to create Ethereal test account, falling back to mock transporter:', err.message)
        // Mock fallback so we don't throw
        transporter = {
          sendMail: async (options) => {
            console.log(`[EMAIL MOCK] Mock send (no SMTP configured):`)
            console.log(`  From: ${options.from}`)
            console.log(`  To: ${options.to}`)
            console.log(`  Subject: ${options.subject}`)
            return { messageId: 'mock-id-' + Date.now() }
          }
        }
      }
    }
  }
  return transporter
}

const fromEmail = process.env.EMAIL_FROM || 'support@lanzar.me'
const notificationEmail = process.env.TICKET_NOTIFICATION_EMAIL || 'jon@lanzar.me'
const inboundDomain = process.env.INBOUND_EMAIL_DOMAIN || 'lanzar.me'

/**
 * Log the Ethereal preview link if applicable.
 */
function logPreviewUrl(info) {
  if (info && info.messageId && !process.env.SMTP_USER) {
    const previewUrl = nodemailer.getTestMessageUrl(info)
    if (previewUrl) {
      console.log(`[EMAIL] Preview sent email at: ${previewUrl}`)
    }
  }
}

/**
 * Send a notification email when a new support ticket is submitted.
 */
export async function sendNewTicketNotification(ticket) {
  const subject = `New LANZAR Support Ticket #${ticket.ticketNumber}`
  const adminLink = `https://tickets.lanzar.me/?ticketId=${ticket.ticketNumber}`

  const textBody = `You got a new support ticket from ${ticket.customerName}.

Ticket: #${ticket.ticketNumber}
Subject: ${ticket.category}

Open in LANZAR Tickets admin portal:
${adminLink}`

  const mailOptions = {
    from: `"LANZAR Terminal" <${fromEmail}>`,
    to: notificationEmail,
    subject: subject,
    text: textBody,
  }

  try {
    const mailTransporter = await getTransporter()
    console.log(`[EMAIL] Provider request sent for ticket: ${ticket.ticketNumber} to recipient: ${notificationEmail}`)
    const info = await mailTransporter.sendMail(mailOptions)
    console.log(`[EMAIL] Provider accepted message for ${ticket.ticketNumber}. Message ID: ${info.messageId}`)
    logPreviewUrl(info)
    return info
  } catch (error) {
    console.error(`[EMAIL ERROR] Provider request failed for ${ticket.ticketNumber}:`, error.message)
  }
}

/**
 * Send a confirmation email to the customer when a new ticket is submitted.
 */
export async function sendCustomerConfirmation(ticket) {
  const subject = `LANZAR Support Ticket Received — #${ticket.ticketNumber}`

  const textBody = `Hello ${ticket.customerName},

We have received your support ticket #${ticket.ticketNumber}.

Basic Ticket Information:
- Service: ${ticket.service.toUpperCase()}
- Category: ${ticket.category}
- Description: ${ticket.description}

If you need to provide additional details or follow up, please email our support representative directly at jon@lanzar.me by clicking the link below:

mailto:jon@lanzar.me?subject=Follow-up%20on%20Support%20Ticket%20%23${ticket.ticketNumber}

Thank you,
LANZAR Support Terminal`

  const mailOptions = {
    from: `"LANZAR Terminal" <${fromEmail}>`,
    to: ticket.customerEmail,
    subject: subject,
    text: textBody,
  }

  try {
    const mailTransporter = await getTransporter()
    console.log(`[EMAIL] Confirmation request sent for ticket: ${ticket.ticketNumber} to customer: ${ticket.customerEmail}`)
    const info = await mailTransporter.sendMail(mailOptions)
    console.log(`[EMAIL] Confirmation accepted for ${ticket.ticketNumber}. Message ID: ${info.messageId}`)
    logPreviewUrl(info)
    return info
  } catch (error) {
    console.error(`[EMAIL ERROR] Confirmation request failed for ${ticket.ticketNumber}:`, error.message)
  }
}
