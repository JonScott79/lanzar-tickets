import dotenv from 'dotenv'
import nodemailer from 'nodemailer'

dotenv.config()

const fromEmail = process.env.EMAIL_FROM || 'no-reply@lanzar.me'
const notificationEmail = process.env.TICKET_NOTIFICATION_EMAIL || 'jon@lanzar.me'

let smtpTransporter = null

function getSmtpTransporter() {
  if (smtpTransporter) return smtpTransporter
  const host = process.env.SMTP_HOST
  const port = parseInt(process.env.SMTP_PORT || '587', 10)
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASSWORD

  if (host && user && pass) {
    smtpTransporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
      connectionTimeout: 8000, // 8s fail-fast connection timeout
      greetingTimeout: 5000,   // 5s greeting timeout
      socketTimeout: 15000     // 15s socket timeout
    })
  }
  return smtpTransporter
}

if (!process.env.BREVO_API_KEY && !process.env.SMTP_HOST) {
  console.log('[EMAIL] Neither BREVO_API_KEY nor SMTP_HOST is configured.')
  console.log('[EMAIL] Outbound email delivery unavailable until production credentials are provided.')
}

/**
 * Fallback to direct SMTP delivery using nodemailer.
 */
async function sendViaSmtp(toEmail, toName, subject, textContent, options = {}) {
  const transporter = getSmtpTransporter()
  if (!transporter) {
    throw new Error('SMTP transport is not configured.')
  }
  const senderName = options.senderName || 'LANZAR Terminal'
  const senderEmail = options.senderEmail || fromEmail

  const mailOptions = {
    from: `"${senderName}" <${senderEmail}>`,
    to: toName ? `"${toName}" <${toEmail}>` : toEmail,
    subject,
    text: textContent,
    html: options.htmlContent || undefined,
    headers: options.headers || undefined
  }

  const info = await transporter.sendMail(mailOptions)
  const messageId = info.messageId || 'smtp-success-' + Date.now()
  console.log(`[EMAIL] SMTP fallback delivered email to ${toEmail}. Message ID: ${messageId}`)
  return { messageId, deliveryMethod: 'smtp' }
}

/**
 * Dispatches an email using the Brevo HTTP API with automatic SMTP fallback.
 * Falls back to mock logging if neither is configured.
 */
async function sendViaBrevo(toEmail, toName, subject, textContent, options = {}) {
  const apiKey = process.env.BREVO_API_KEY
  const senderName = options.senderName || 'LANZAR Terminal'
  const senderEmail = options.senderEmail || fromEmail

  if (!apiKey) {
    // If no Brevo API key, attempt SMTP directly before falling back to mock
    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD) {
      try {
        return await sendViaSmtp(toEmail, toName, subject, textContent, options)
      } catch (smtpErr) {
        console.error(`[EMAIL ERROR] Direct SMTP delivery failed for ${toEmail}:`, smtpErr.message)
      }
    }
    console.log(`[EMAIL MOCK] Outbound email mock dispatch (no credentials configured):`)
    console.log(`  To: ${toEmail}`)
    console.log(`  Subject: ${subject}`)
    if (options.htmlContent) {
      console.log(`  [HTML body provided, length: ${options.htmlContent.length} chars]`)
    }
    return { messageId: 'mock-id-' + Date.now(), deliveryMethod: 'mock' }
  }

  const payload = {
    sender: {
      name: senderName,
      email: senderEmail
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

  if (options.htmlContent) {
    payload.htmlContent = options.htmlContent
  }

  if (options.headers && typeof options.headers === 'object') {
    payload.headers = options.headers
  }

  let brevoAccepted = false
  let brevoError = null

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

    if (response.ok) {
      brevoAccepted = true
      let data = {}
      try {
        data = await response.json()
      } catch (jsonErr) {
        console.warn(`[EMAIL WARN] Could not parse Brevo JSON response for ${toEmail}:`, jsonErr.message)
      }
      const messageId = data.messageId || 'api-success-' + Date.now()
      console.log(`[EMAIL] Brevo REST accepted email for ${toEmail}. Message ID: ${messageId}`)
      return { messageId, deliveryMethod: 'brevo_rest' }
    } else {
      const responseText = await response.text()
      brevoError = new Error(`Brevo REST API returned status ${response.status}: ${responseText}`)
      console.error(`[EMAIL ERROR] Brevo REST API failed for recipient: ${toEmail}. Status: ${response.status}. Response: ${responseText}`)
    }
  } catch (netErr) {
    brevoError = netErr
    console.error(`[EMAIL ERROR] Brevo REST connection error for ${toEmail}:`, netErr.message)
  }

  // If Brevo already accepted the message (e.g. 200/201), NEVER fallback to SMTP (prevents duplicate delivery)
  if (brevoAccepted) {
    return { messageId: 'api-success-' + Date.now(), deliveryMethod: 'brevo_rest' }
  }

  // Attempt SMTP fallback exactly once
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD) {
    console.log(`[EMAIL FALLBACK] Attempting SMTP fallback for recipient: ${toEmail}...`)
    try {
      const smtpResult = await sendViaSmtp(toEmail, toName, subject, textContent, options)
      console.log(`[EMAIL FALLBACK SUCCESS] Delivered to ${toEmail} via SMTP. Message ID: ${smtpResult.messageId}`)
      return smtpResult
    } catch (smtpErr) {
      console.error(`[EMAIL FALLBACK ERROR] SMTP fallback also failed for ${toEmail}:`, smtpErr.message)
    }
  }

  throw brevoError || new Error(`Email dispatch failed for recipient: ${toEmail}`)
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

/**
 * Send a branded password reset email with a secure link to a customer user.
 */
export async function sendPasswordResetEmail(userEmail, userName, resetLink) {
  console.log(`[EMAIL] sendPasswordResetEmail invoked for recipient: ${userEmail}`)

  if (!userEmail) {
    console.warn('[EMAIL WARN] Cannot send password reset email: missing recipient email address.')
    return
  }

  const name = userName || 'Customer'
  const subject = 'LANZAR Tickets — Password Reset Request'

  const textBody = `Hello ${name},

A password reset request was submitted for your LANZAR Tickets account (${userEmail}).

Please click the link below to set a new password:

${resetLink}

If you did not request this password reset, please contact LANZAR Support at jon@lanzar.me.

Thank you,
LANZAR Support Terminal`

  console.log(`[EMAIL] Dispatching Password Reset Email to ${userEmail}...`)

  try {
    const info = await sendViaBrevo(userEmail, name, subject, textBody)
    return info
  } catch (error) {
    console.error(`[EMAIL ERROR] Password reset dispatch failed for ${userEmail}:`, error.message)
    throw error
  }
}

/**
 * Send a broadcast announcement to a list of customers.
 */
export async function sendAnnouncementEmail(recipients, subject, textContent) {
  console.log(`[EMAIL] sendAnnouncementEmail invoked for ${recipients.length} recipients`)
  
  if (!recipients || recipients.length === 0) {
    console.warn('[EMAIL WARN] No recipients provided for announcement.')
    return { success: 0, failures: 0 }
  }

  const results = {
    success: 0,
    failures: 0,
    failedEmails: []
  }

  // We should send individual emails rather than Bccing everyone, 
  // to avoid exposing customer list or hitting limits.
  for (const rcpt of recipients) {
    try {
      await sendViaBrevo(rcpt.email, rcpt.name, subject, textContent)
      results.success++
    } catch (err) {
      console.error(`[EMAIL ERROR] Failed to send announcement to ${rcpt.email}:`, err.message)
      results.failures++
      results.failedEmails.push(rcpt.email)
    }
  }

  return results
}

// =====================================
// LANZAR Dispatch Newsletter Functions
// =====================================

const newsletterFromName = process.env.NEWSLETTER_FROM_NAME || 'LANZAR Dispatch'
const newsletterFromEmail = process.env.NEWSLETTER_FROM_EMAIL || process.env.EMAIL_FROM || 'dispatch@lanzar.me'
const apiBaseUrl = process.env.PUBLIC_API_BASE_URL || (process.env.NODE_ENV === 'production' ? 'https://api.tickets.lanzar.me' : 'http://localhost:3001')

/**
 * Renders a branded Atomic-Age HTML email template for LANZAR Dispatch.
 */
export function renderNewsletterHtml({ subject, content, unsubscribeUrl }) {
  // Convert plain line breaks to <p> if content does not contain HTML tags
  let formattedBody = content
  if (!/<[a-z][\s\S]*>/i.test(content)) {
    formattedBody = content
      .split(/\n{2,}/)
      .map(p => `<p style="margin: 0 0 16px 0; line-height: 1.6; font-size: 16px; color: #102A43;">${p.replace(/\n/g, '<br/>')}</p>`)
      .join('')
  }

  // Replace {{unsubscribe_link}} if user manually used the token
  if (unsubscribeUrl) {
    formattedBody = formattedBody.replaceAll('{{unsubscribe_link}}', unsubscribeUrl)
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0F172A; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #102A43;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #0F172A; padding: 32px 16px;">
    <tr>
      <td align="center">
        <!-- Main Container Card -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 620px; background-color: #FAF6F0; border-radius: 8px; border: 2px solid #E2B84D; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.4);">
          
          <!-- Header Banner -->
          <tr>
            <td style="background-color: #102A43; padding: 28px 32px; text-align: center; border-bottom: 3px solid #F46B45;">
              <div style="font-size: 26px; font-weight: 900; letter-spacing: 2px; color: #F5EBDD; text-transform: uppercase;">
                &#9650; LANZAR DISPATCH
              </div>
              <div style="font-size: 12px; font-weight: 700; letter-spacing: 1.5px; color: #E2B84D; text-transform: uppercase; margin-top: 6px;">
                Field Notes &bull; Systems &bull; Artificial Intelligence
              </div>
            </td>
          </tr>

          <!-- Subject Heading -->
          <tr>
            <td style="padding: 28px 32px 12px 32px;">
              <h1 style="margin: 0; font-size: 24px; font-weight: 800; color: #102A43; line-height: 1.3;">
                ${escapeHtml(subject)}
              </h1>
            </td>
          </tr>

          <!-- Email Body Content -->
          <tr>
            <td style="padding: 12px 32px 28px 32px; font-size: 16px; line-height: 1.65; color: #102A43;">
              ${formattedBody}
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding: 0 32px;">
              <div style="border-top: 1px solid rgba(16, 42, 67, 0.15);"></div>
            </td>
          </tr>

          <!-- Footer & Unsubscribe -->
          <tr>
            <td style="padding: 24px 32px 32px 32px; background-color: #F1ECE1; font-size: 12px; line-height: 1.5; color: #556B82; text-align: center;">
              <p style="margin: 0 0 10px 0; font-weight: bold; color: #102A43; text-transform: uppercase; letter-spacing: 1px;">
                LANZAR &bull; Build Tomorrow. Starting Today.
              </p>
              <p style="margin: 0 0 12px 0;">
                LANZAR &bull; Worcester, Massachusetts &bull; United States<br/>
                You are receiving this transmission because you subscribed on <a href="https://lanzar.me" style="color: #F46B45; text-decoration: none; font-weight: bold;">lanzar.me</a>.
              </p>
              ${unsubscribeUrl ? `
              <p style="margin: 14px 0 0 0;">
                <a href="${unsubscribeUrl}" style="color: #2A728F; text-decoration: underline; font-weight: bold; font-size: 12px;">Unsubscribe from LANZAR Dispatch</a>
              </p>` : ''}
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

/**
 * Renders plain-text fallback for LANZAR Dispatch.
 */
export function renderNewsletterText({ subject, content, unsubscribeUrl }) {
  // Strip HTML tags for plain text version
  const strippedContent = content
    .replace(/<br\s*[\/]?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .trim()

  const unsubText = unsubscribeUrl 
    ? `\n\nUnsubscribe from this transmission:\n${unsubscribeUrl}\n`
    : ''

  return `========================================
LANZAR DISPATCH
Field Notes • Systems • Artificial Intelligence
========================================

SUBJECT: ${subject}

----------------------------------------

${strippedContent}

----------------------------------------
LANZAR • Build Tomorrow. Starting Today.
Worcester, Massachusetts • United States
You subscribed on https://lanzar.me
${unsubText}`
}

function escapeHtml(str) {
  if (!str) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Send a single test dispatch to Jon / admin.
 */
export async function sendTestNewsletter({ toEmail, subject, content }) {
  const unsubscribeUrl = `${apiBaseUrl}/api/newsletter/unsubscribe?token=TEST_TOKEN_PREVIEW`
  const html = renderNewsletterHtml({ subject: `[TEST] ${subject}`, content, unsubscribeUrl })
  const text = renderNewsletterText({ subject: `[TEST] ${subject}`, content, unsubscribeUrl })

  return sendViaBrevo(toEmail, 'Admin Test', `[TEST] ${subject}`, text, {
    htmlContent: html,
    senderName: newsletterFromName,
    senderEmail: newsletterFromEmail
  })
}

/**
 * Throttled batch dispatch for LANZAR Dispatch subscribers.
 * Sends individually with personalized unsubscribe headers and links.
 */
export async function sendNewsletterBatch(subscribers, subject, content) {
  console.log(`[NEWSLETTER] Starting batch dispatch for ${subscribers.length} recipients.`)

  const results = {
    total: subscribers.length,
    success: 0,
    failures: 0,
    failedEmails: []
  }

  for (let i = 0; i < subscribers.length; i++) {
    const sub = subscribers[i]
    const unsubscribeUrl = `${apiBaseUrl}/api/newsletter/unsubscribe?token=${encodeURIComponent(sub.unsubscribeToken || '')}`
    
    const html = renderNewsletterHtml({ subject, content, unsubscribeUrl })
    const text = renderNewsletterText({ subject, content, unsubscribeUrl })

    const headers = {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
    }

    try {
      await sendViaBrevo(sub.email, sub.email.split('@')[0], subject, text, {
        htmlContent: html,
        headers,
        senderName: newsletterFromName,
        senderEmail: newsletterFromEmail
      })
      results.success++
    } catch (err) {
      console.error(`[NEWSLETTER ERROR] Dispatch failed for ${sub.email}:`, err.message)
      results.failures++
      results.failedEmails.push({ email: sub.email, error: err.message })
    }

    // Rate-limit throttling between sends (80ms delay between individual emails)
    if (i < subscribers.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 80))
    }
  }

  console.log(`[NEWSLETTER] Batch dispatch completed: ${results.success} accepted, ${results.failures} failed.`)
  return results
}


/**
 * Dispatches an out-of-band support verification challenge OTP to a customer.
 */
export async function sendSupportVerificationEmail({ toEmail, toName, otpCode }) {
  const subject = `Your LANZAR Support Verification Code: ${otpCode}`
  const textContent = `Your LANZAR Support verification code is: ${otpCode}\n\nThis single-use code expires in 10 minutes.\nIf you did not request support assistance, please contact security@lanzar.me immediately.`

  const htmlContent = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; border: 2px solid #002244; border-radius: 8px; background-color: #ffffff;">
      <div style="border-bottom: 3px solid #ff5500; padding-bottom: 12px; margin-bottom: 20px;">
        <h2 style="color: #002244; margin: 0; font-size: 20px; text-transform: uppercase; letter-spacing: 1px;">LANZAR Support Verification</h2>
      </div>
      <p style="color: #333333; font-size: 15px; line-height: 1.5; margin-bottom: 16px;">
        Hello ${toName || 'there'},
      </p>
      <p style="color: #333333; font-size: 15px; line-height: 1.5; margin-bottom: 24px;">
        A LANZAR support specialist has initiated an identity verification challenge for your account during an active support session. Please provide this 6-digit code to your support specialist:
      </p>
      <div style="background-color: #f0f4f8; border: 2px dashed #2a728f; border-radius: 6px; padding: 20px; text-align: center; margin-bottom: 24px;">
        <span style="font-family: monospace; font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #ff5500;">${otpCode}</span>
      </div>
      <p style="color: #666666; font-size: 13px; line-height: 1.4; margin-bottom: 0;">
        <strong>Security Notice:</strong> This single-use code is valid for 10 minutes. LANZAR will never ask for your password or billing credentials over the phone. If you did not initiate this call, please email security@lanzar.me immediately.
      </p>
    </div>
  `

  return sendViaBrevo(toEmail, toName, subject, textContent, {
    htmlContent,
    senderName: 'LANZAR Support Security'
  })
}

/**
 * Sends a confirmation email to a guest or prospective customer submitting a public inquiry.
 */
export async function sendInquiryConfirmationEmail({ toEmail, toName, ticketId, subject, claimUrl }) {
  const emailSubject = `Inquiry Received: [${ticketId}] ${subject}`
  const textContent = `Thank you for contacting LANZAR.\n\nYour inquiry [${ticketId}] has been received and routed to our engineering and support specialists.\n\nSubject: ${subject}\n\nIf you have a LANZAR ID or wish to claim this ticket, visit:\n${claimUrl || 'https://portal.lanzar.me'}\n\nLANZAR Team`

  const htmlContent = `
    <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; border: 2px solid #002244; border-radius: 8px;">
      <h2 style="color: #002244; margin-top: 0;">Inquiry Received [${ticketId}]</h2>
      <p style="color: #333; font-size: 15px;">Hello ${toName || 'there'},</p>
      <p style="color: #333; font-size: 15px;">Thank you for reaching out to LANZAR. Your inquiry regarding <strong>${subject}</strong> has been received by our technical operations desk.</p>
      ${claimUrl ? `<p style="margin: 20px 0;"><a href="${claimUrl}" style="background-color: #ff5500; color: #ffffff; text-decoration: none; padding: 10px 18px; border-radius: 4px; font-weight: bold; display: inline-block;">View & Track Ticket</a></p>` : ''}
      <p style="color: #777; font-size: 13px;">Our team will respond to this email address shortly.</p>
    </div>
  `

  return sendViaBrevo(toEmail, toName, emailSubject, textContent, {
    htmlContent,
    senderName: 'LANZAR Operations'
  })
}
