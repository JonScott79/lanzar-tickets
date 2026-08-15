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
  const subject = `LANZAR Support Ticket — ${ticket.ticketNumber}`
  const adminLink = `https://tickets.lanzar.me/?ticketId=${ticket.ticketNumber}`

  const textBody = `LANZAR SUPPORT TICKETS

NEW TICKET RECEIVED

Ticket:
${ticket.ticketNumber}

Customer:
${ticket.customerName}

Email:
${ticket.customerEmail}

Service:
${ticket.service.toUpperCase()}

Category:
${ticket.category}

Submitted:
${new Date().toLocaleString()}

Description:
${ticket.description}

--------------------------------------------------

VIEW TICKET
${adminLink}
`

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
    // Do not throw the error; satisfy the requirement "THE TICKET MUST REMAIN CREATED"
  }
}

/**
 * Send a clarification request email to the customer.
 */
export async function sendMoreInfoRequest(ticket, adminMessage) {
  const subject = `LANZAR Ticket ${ticket.ticketNumber} — More Information Requested`
  const replyTo = `reply+tkt-${ticket.ticketNumber}@${inboundDomain}`

  const textBody = `LANZAR SUPPORT TICKETS

Additional information is needed for your support ticket.

Ticket:
${ticket.ticketNumber}

Service:
${ticket.service.toUpperCase()}

Message from LANZAR:
${adminMessage}

--------------------------------------------------

Please reply directly to this email with the requested information.

Your reply will be attached to ticket ${ticket.ticketNumber}.
`

  const mailOptions = {
    from: `"LANZAR Support" <${fromEmail}>`,
    to: ticket.customerEmail,
    replyTo: replyTo,
    subject: subject,
    text: textBody,
    // Add threading headers
    headers: {
      'Message-ID': `<moreinfo-${ticket.ticketNumber}@${inboundDomain}>`,
      'References': `<ticket-${ticket.ticketNumber}@${inboundDomain}>`
    }
  }

  try {
    const mailTransporter = await getTransporter()
    const info = await mailTransporter.sendMail(mailOptions)
    console.log(`[EMAIL] More Info request sent to ${ticket.customerEmail} for ${ticket.ticketNumber}. Message ID: ${info.messageId}`)
    logPreviewUrl(info)
    return info
  } catch (error) {
    console.error(`[EMAIL ERROR] Failed to send More Info request to ${ticket.customerEmail} for ${ticket.ticketNumber}:`, error.message)
  }
}

/**
 * Send an email to Jon when a customer replies to a More Info request.
 */
export async function sendCustomerResponseNotification(ticket, responseText) {
  const subject = `Re: LANZAR Ticket ${ticket.ticketNumber} — Customer Response`
  const adminLink = `https://tickets.lanzar.me/?ticketId=${ticket.ticketNumber}`

  const textBody = `LANZAR SUPPORT TICKETS

CUSTOMER RESPONDED TO TICKET

Ticket:
${ticket.ticketNumber}

Customer:
${ticket.customerName}

Email:
${ticket.customerEmail}

Customer Response:
${responseText}

--------------------------------------------------

VIEW TICKET
${adminLink}
`

  const mailOptions = {
    from: `"LANZAR Terminal" <${fromEmail}>`,
    to: notificationEmail,
    subject: subject,
    text: textBody,
    // Threading headers to link to the original More Info request
    headers: {
      'In-Reply-To': `<moreinfo-${ticket.ticketNumber}@${inboundDomain}>`,
      'References': `<moreinfo-${ticket.ticketNumber}@${inboundDomain}>`
    }
  }

  try {
    const mailTransporter = await getTransporter()
    const info = await mailTransporter.sendMail(mailOptions)
    console.log(`[EMAIL] Customer response notification sent to ${notificationEmail} for ${ticket.ticketNumber}. Message ID: ${info.messageId}`)
    logPreviewUrl(info)
    return info
  } catch (error) {
    console.error(`[EMAIL ERROR] Failed to send customer response notification for ${ticket.ticketNumber}:`, error.message)
  }
}
