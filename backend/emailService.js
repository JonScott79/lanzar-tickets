/*
    emailService.js

    LANZAR Support Tickets email communication service.

    Responsibilities

    - Send outbound transactional email notifications (new ticket, admin more info, customer response)
    - Communicate directly with the Brevo Transactional Email HTTPS API
    - Support environment variable configurations safely
*/

import dotenv from 'dotenv'

dotenv.config()

const fromEmail = process.env.EMAIL_FROM || 'no-reply@lanzar.me'
const notificationEmail = process.env.TICKET_NOTIFICATION_EMAIL || 'jon@lanzar.me'

if (!process.env.BREVO_API_KEY) {
  console.log('[EMAIL] BREVO_API_KEY environment variable is missing')
  console.log('[EMAIL] Email delivery unavailable until production BREVO_API_KEY variable is configured')
}

/**
 * Dispatches a transactional email using the Brevo HTTP API.
 * Falls back to mock logging if BREVO_API_KEY is not defined.
 */
async function sendViaBrevo(toEmail, toName, subject, textContent) {
  const apiKey = process.env.BREVO_API_KEY

  if (!apiKey) {
    console.log(`[EMAIL MOCK] Outbound email mock dispatch (no BREVO_API_KEY configured):`)
    console.log(`  To: ${toEmail}`)
    console.log(`  Subject: ${subject}`)
    return { messageId: 'mock-id-' + Date.now() }
  }

  const payload = {
    sender: {
      name: 'LANZAR Terminal',
      email: fromEmail
    },
    to: [
      {
        email: toEmail,
        name: toName || toEmail
      }
    ],
    subject: subject,
    textContent: textContent
  }

  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'api-key': apiKey
      },
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      const responseText = await response.text()
      console.error(`[EMAIL ERROR] Brevo API request failed for recipient: ${toEmail}. Status: ${response.status}. Response: ${responseText}`)
      throw new Error(`Brevo API returned status ${response.status}: ${responseText}`)
    }

    const data = await response.json()
    const messageId = data.messageId || 'api-success-' + Date.now()
    
    // Log accepted after Brevo returns a successful HTTP response
    console.log(`[EMAIL] Provider request accepted for recipient: ${toEmail}. Message ID: ${messageId}`)
    
    return { messageId }
  } catch (error) {
    console.error(`[EMAIL ERROR] Brevo API connection failed for recipient: ${toEmail}:`, error.message)
    throw error
  }
}

/**
 * Send a notification email when a new support ticket is submitted.
 */
export async function sendNewTicketNotification(ticket) {
  console.log('[EMAIL] sendNewTicketNotification invoked with data:', JSON.stringify(ticket))

  const customerName = ticket?.customerName || 'Unknown Customer'
  const ticketNumber = ticket?.ticketNumber || ticket?.id || 'N/A'
  const category = ticket?.category || ticket?.service || 'N/A'
  const issueType = ticket?.issueType ? ` -> ${ticket.issueType}` : ''
  const assetName = ticket?.assetName ? `\nAsset: ${ticket.assetName}` : ''
  const locationName = ticket?.locationName ? `\nLocation: ${ticket.locationName}` : ''
  
  let answersSummary = ''
  if (ticket?.answers && Object.keys(ticket.answers).length > 0) {
    answersSummary = '\nDiagnostic Answers:\n' + Object.entries(ticket.answers)
      .map(([k, v]) => `  - ${k}: ${v}`)
      .join('\n')
  }

  const adminLink = `https://tickets.lanzar.me/?ticketId=${ticketNumber}`
  const subject = `New LANZAR Support Ticket #${ticketNumber}`

  const textBody = `You got a new support ticket from ${customerName}.

Ticket: #${ticketNumber}
Service: ${(ticket?.service || 'IT').toUpperCase()}
Category: ${category}${issueType}${assetName}${locationName}${answersSummary}

Description:
${ticket?.description || 'N/A'}

Open in LANZAR Tickets admin portal:
${adminLink}`

  console.log(`[EMAIL] Generated Admin Notification text body:\n${textBody}`)

  try {
    const info = await sendViaBrevo(notificationEmail, 'Jon Scott', subject, textBody)
    return info
  } catch (error) {
    console.error(`[EMAIL ERROR] Provider request failed for ${ticketNumber}:`, error.message)
  }
}

/**
 * Send a confirmation email to the customer when a new ticket is submitted.
 */
export async function sendCustomerConfirmation(ticket) {
  console.log('[EMAIL] sendCustomerConfirmation invoked with data:', JSON.stringify(ticket))

  const customerName = ticket?.customerName || 'Customer'
  const ticketNumber = ticket?.ticketNumber || ticket?.id || 'N/A'
  const service = ticket?.service || 'N/A'
  const category = ticket?.category || 'N/A'
  const issueType = ticket?.issueType ? ` (${ticket.issueType})` : ''
  const assetName = ticket?.assetName ? `\n- Asset: ${ticket.assetName}` : ''
  const description = ticket?.description || 'No description provided.'
  const customerEmail = ticket?.customerEmail

  if (!customerEmail) {
    console.warn(`[EMAIL WARN] Cannot send customer confirmation for ${ticketNumber}: No customerEmail resolved.`)
    return
  }

  const subject = `LANZAR Support Ticket #${ticketNumber} Received`

  const textBody = `Hello ${customerName},

We have received your support ticket #${ticketNumber}.

Ticket Information:
- Service: ${service.toUpperCase()}
- Category: ${category}${issueType}${assetName}
- Description: ${description}

If you need to provide additional details or follow up, please email our support representative directly at jon@lanzar.me by clicking the link below:

mailto:jon@lanzar.me?subject=Follow-up%20on%20Support%20Ticket%20%23${ticketNumber}

Thank you,
LANZAR Support Terminal`

  console.log(`[EMAIL] Generated Customer Confirmation text body:\n${textBody}`)

  try {
    const info = await sendViaBrevo(customerEmail, customerName, subject, textBody)
    return info
  } catch (error) {
    console.error(`[EMAIL ERROR] Confirmation request failed for ${ticketNumber}:`, error.message)
  }
}

/**
 * Send a welcome email with a secure password-setup link to a newly registered customer user.
 */
export async function sendWelcomeEmail(userEmail, userName, accountName, resetLink) {
  console.log(`[EMAIL] sendWelcomeEmail invoked for recipient: ${userEmail} (Account: ${accountName})`)

  if (!userEmail) {
    console.warn('[EMAIL WARN] Cannot send welcome email: missing recipient email address.')
    return
  }

  const name = userName || 'Customer'
  const account = accountName || 'LANZAR Tickets'
  const subject = 'Welcome to LANZAR Tickets — Account Invitation'

  const textBody = `Hello ${name},

Welcome to LANZAR Tickets.

Your support account for ${account} has been created.

Username: ${userEmail}

Please click the link below to set your password and activate your account:

${resetLink}

After setting your password, visit https://tickets.lanzar.me to sign in.

If you did not expect this invitation, please contact LANZAR Support at jon@lanzar.me.

Thank you,
LANZAR Support Terminal`

  console.log(`[EMAIL] Dispatching Welcome Email to ${userEmail}...`)

  try {
    const info = await sendViaBrevo(userEmail, name, subject, textBody)
    return info
  } catch (error) {
    console.error(`[EMAIL ERROR] Welcome email dispatch failed for ${userEmail}:`, error.message)
    throw error
  }
}
