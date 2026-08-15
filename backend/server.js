/*
    server.js

    LANZAR Support Tickets backend application.

    Responsibilities

    - Provide administrative API endpoints
    - Handle secure customer account creation via Firebase Admin SDK (with optional initial password)
    - Verify client tokens and enforce server-side administrator authorization
    - Modify and validate customer service authorizations
    - Route new ticket email triggers and More Info email notifications
    - Process inbound customer reply webhooks securely with duplicate message prevention
*/

// =====================================
// Dependencies
// =====================================

import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { cert, initializeApp, getApps } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import fs from 'node:fs'
import { 
  sendNewTicketNotification, 
  sendMoreInfoRequest, 
  sendCustomerResponseNotification 
} from './emailService.js'

dotenv.config()

// =====================================
// Initialization
// =====================================

const app = express()

// Allow CORS from production domain and local Vite dev servers
app.use(cors({
  origin: [
    'https://tickets.lanzar.me',
    'http://localhost:5173',
    'http://localhost:5174'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}))

app.use(express.json())

// =====================================
// Firebase Admin SDK Config
// =====================================

const credentialPath = 'C:\\Projects\\LANZAR\\firebase-credentials\\lanzar-95ae3-firebase-adminsdk-fbsvc-86e8ea5817.json'

if (!fs.existsSync(credentialPath)) {
  console.error(`[BACKEND ERROR] Firebase service account file not found at: ${credentialPath}`)
  process.exit(1)
}

const serviceAccount = JSON.parse(fs.readFileSync(credentialPath, 'utf8'))

const adminApp = getApps().length > 0
  ? getApps()[0]
  : initializeApp({
      credential: cert(serviceAccount)
    })

const auth = getAuth(adminApp)
const db = getFirestore(adminApp)

console.log('[BACKEND] Connected to Firebase Project:', serviceAccount.project_id)

// =====================================
// Middleware: Admin Authorization
// =====================================

async function authenticateAdmin(req, res, next) {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' })
  }

  const token = authHeader.split('Bearer ')[1]
  try {
    const decodedToken = await auth.verifyIdToken(token)
    
    // Check if the user is in the admins collection
    const adminDoc = await db.collection('admins').doc(decodedToken.uid).get()
    if (!adminDoc.exists || adminDoc.data().active !== true) {
      console.warn(`[BACKEND AUTH WARN] Forbidden admin action attempted by: ${decodedToken.email}`)
      return res.status(403).json({ error: 'Forbidden: Access denied' })
    }

    req.admin = decodedToken
    next()
  } catch (error) {
    console.error('[BACKEND AUTH ERROR] ID Token verification failed:', error.message)
    return res.status(401).json({ error: 'Unauthorized: Verification failed' })
  }
}

// =====================================
// Middleware: Client User Authorization
// =====================================

async function authenticateUser(req, res, next) {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' })
  }

  const token = authHeader.split('Bearer ')[1]
  try {
    const decodedToken = await auth.verifyIdToken(token)
    req.user = decodedToken
    next()
  } catch (error) {
    console.error('[BACKEND AUTH ERROR] User ID token verification failed:', error.message)
    return res.status(401).json({ error: 'Unauthorized: Verification failed' })
  }
}

// =====================================
// Routes
// =====================================

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'LANZAR Tickets Backend' })
})

// Create Customer Account (Firebase Auth + Firestore Profile)
app.post('/api/customers', authenticateAdmin, async (req, res) => {
  const { name, email, password, services } = req.body

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Customer Name is required.' })
  }
  if (!email || !email.trim()) {
    return res.status(400).json({ error: 'Customer Email is required.' })
  }
  if (password && password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' })
  }
  if (!Array.isArray(services) || services.length === 0) {
    return res.status(400).json({ error: 'At least one authorized service must be selected.' })
  }

  const normalizedEmail = email.trim().toLowerCase()

  try {
    // 1. Check if customer document already exists in Firestore
    const existingDocQuery = await db.collection('customers')
      .where('customerEmail', '==', normalizedEmail)
      .limit(1)
      .get()

    if (!existingDocQuery.empty) {
      return res.status(400).json({ error: 'An account already exists for this email address.' })
    }

    // 2. Check if user already exists in Firebase Auth
    try {
      await auth.getUserByEmail(normalizedEmail)
      return res.status(400).json({ error: 'An account already exists for this email address.' })
    } catch (authError) {
      if (authError.code !== 'auth/user-not-found') {
        throw authError
      }
    }

    // 3. Create Firebase Auth user
    let authUser
    try {
      authUser = await auth.createUser({
        email: normalizedEmail,
        displayName: name.trim(),
        ...(password ? { password } : {})
      })
      console.log(`[BACKEND] Auth user created successfully with UID: ${authUser.uid}`)
    } catch (createAuthError) {
      console.error('[BACKEND ERROR] Firebase Auth user creation failed:', createAuthError)
      return res.status(400).json({ error: 'Failed to create authentication credentials: ' + createAuthError.message })
    }

    // 4. Write customer profile to Firestore
    try {
      await db.collection('customers').doc(authUser.uid).set({
        customerId: authUser.uid,
        customerName: name.trim(),
        displayName: name.trim(),
        customerEmail: normalizedEmail,
        authEmail: normalizedEmail,
        services: services,
        active: true,
        createdAt: FieldValue.serverTimestamp()
      })
      console.log(`[BACKEND] Firestore customer record created for: ${normalizedEmail}`)
    } catch (firestoreError) {
      console.error('[BACKEND ERROR] Firestore write failed, rolling back Firebase Auth user...', firestoreError)
      try {
        await auth.deleteUser(authUser.uid)
        console.log('[BACKEND] Rollback complete: Deleted Auth user UID:', authUser.uid)
      } catch (rollbackError) {
        console.error('[BACKEND ERROR] Rollback failed to delete Auth user:', rollbackError.message)
      }
      return res.status(500).json({ error: 'Failed to complete customer database registration. Auth account rolled back.' })
    }

    return res.json({
      success: true,
      uid: authUser.uid,
      email: normalizedEmail,
      name: name.trim(),
      services: services
    })
  } catch (error) {
    console.error('[BACKEND ERROR] Customer creation failed:', error)
    return res.status(500).json({ error: 'Failed to create customer: ' + error.message })
  }
})

// Update Customer Services (Admin authorized update)
app.post('/api/customers/:uid/services', authenticateAdmin, async (req, res) => {
  const { uid } = req.params
  const { services } = req.body

  if (!Array.isArray(services)) {
    return res.status(400).json({ error: 'Services must be an array' })
  }

  try {
    const customerRef = db.collection('customers').doc(uid)
    const customerDoc = await customerRef.get()

    if (!customerDoc.exists) {
      return res.status(404).json({ error: 'Customer not found' })
    }

    await customerRef.update({
      services: services
    })

    console.log(`[BACKEND] Services updated for customer ${uid} to:`, services)
    return res.json({ success: true, services })
  } catch (error) {
    console.error('[BACKEND ERROR] Services update failed:', error)
    return res.status(500).json({ error: 'Failed to update services: ' + error.message })
  }
})

// Send Email Notification for New Ticket (Customer Triggered after Firestore save)
app.post('/api/tickets/notify', authenticateUser, async (req, res) => {
  const { ticketId } = req.body

  if (!ticketId) {
    return res.status(400).json({ error: 'Ticket ID is required' })
  }

  try {
    const ticketRef = db.collection('tickets').doc(ticketId)
    const ticketDoc = await ticketRef.get()

    if (!ticketDoc.exists) {
      return res.status(404).json({ error: 'Ticket not found' })
    }

    const ticketData = ticketDoc.data()

    // Enforce ownership check (only owner or admin can trigger notification)
    const isCallerAdmin = await db.collection('admins').doc(req.user.uid).get().then(doc => doc.exists && doc.data().active === true).catch(() => false)
    if (ticketData.authUid !== req.user.uid && !isCallerAdmin) {
      return res.status(403).json({ error: 'Forbidden: Access denied' })
    }

    // Check if notification email has already been sent to prevent duplicates
    if (ticketData.notificationSent === true) {
      console.log(`[BACKEND] Notification email already sent for ${ticketId}. Skipping.`)
      return res.json({ success: true, alreadySent: true })
    }

    // Send email (does not throw on failure, keeping ticket persisted)
    await sendNewTicketNotification(ticketData)

    // Mark as sent
    await ticketRef.update({
      notificationSent: true
    })

    return res.json({ success: true })
  } catch (error) {
    console.error('[BACKEND ERROR] Ticket notification failed:', error)
    return res.status(500).json({ error: 'Failed to send notification: ' + error.message })
  }
})

// Trigger More Info email (Admin Triggered after Firestore save)
app.post('/api/tickets/:ticketId/more-info-email', authenticateAdmin, async (req, res) => {
  const { ticketId } = req.params
  const { adminMessage } = req.body

  if (!adminMessage || !adminMessage.trim()) {
    return res.status(400).json({ error: 'Admin message is required' })
  }

  try {
    const ticketRef = db.collection('tickets').doc(ticketId)
    const ticketDoc = await ticketRef.get()

    if (!ticketDoc.exists) {
      return res.status(404).json({ error: 'Ticket not found' })
    }

    const ticketData = ticketDoc.data()

    // Send More Info Email
    await sendMoreInfoRequest(ticketData, adminMessage.trim())

    return res.json({ success: true })
  } catch (error) {
    console.error('[BACKEND ERROR] More Info email failed:', error)
    return res.status(500).json({ error: 'Failed to send email: ' + error.message })
  }
})

// =====================================
// Inbound Email Webhook Parsing
// =====================================

// Clean email quote helper
function cleanEmailBody(text) {
  if (!text) return ''
  const patterns = [
    /\r?\n\s*On .* wrote:/i,
    /\r?\n\s*On .* at .* wrote:/i,
    /\r?\n\s*---* ?Original Message ?---*/i,
    /\r?\n\s*From: .*/i,
    /\r?\n\s*Sent: .*/i,
    /\r?\n\s*To: .*/i,
    /\r?\n\s*__+/ // Line separators
  ]
  
  let cleaned = text
  for (const pattern of patterns) {
    const parts = cleaned.split(pattern)
    cleaned = parts[0]
  }
  return cleaned.trim()
}

// Extract ticket number helper
function extractTicketNumber(toAddress) {
  if (!toAddress) return null
  const match = toAddress.match(/reply\+tkt-(LZ-[A-Z]+-\d+)(?:@|\+)/i)
  if (match) {
    return match[1].toUpperCase()
  }
  const genericMatch = toAddress.match(/(LZ-[A-Z]+-\d+)/i)
  if (genericMatch) {
    return genericMatch[1].toUpperCase()
  }
  return null
}

// Inbound Email Webhook (POST)
app.post('/api/inbound-email', async (req, res) => {
  console.log('[INBOUND] Webhook received:', req.body)

  // Verify Webhook Secret if configured
  const webhookSecret = process.env.INBOUND_WEBHOOK_SECRET
  if (webhookSecret) {
    const incomingSecret = req.query.secret || req.headers['x-webhook-secret']
    if (incomingSecret !== webhookSecret) {
      console.warn('[INBOUND WARN] Unauthorized webhook access attempt.')
      return res.status(401).json({ error: 'Unauthorized' })
    }
  }

  const { From, To, TextBody, MessageID } = req.body

  if (!From || !To || !MessageID) {
    return res.status(400).json({ error: 'Missing required webhook fields (From, To, MessageID)' })
  }

  try {
    // 1. Extract Ticket Number
    const ticketNumber = extractTicketNumber(To)
    if (!ticketNumber) {
      console.warn(`[INBOUND WARN] Could not extract ticket number from recipient: ${To}`)
      return res.status(400).json({ error: 'Invalid recipient: No ticket ID found' })
    }

    // 2. Load Ticket
    const ticketRef = db.collection('tickets').doc(ticketNumber)
    const ticketDoc = await ticketRef.get()
    if (!ticketDoc.exists) {
      console.warn(`[INBOUND WARN] Ticket not found: ${ticketNumber}`)
      return res.status(404).json({ error: 'Ticket not found' })
    }

    const ticket = ticketDoc.data()

    // 3. Idempotency Check (Duplicate message protection)
    const processedRef = db.collection('processed_emails').doc(MessageID)
    const processedDoc = await processedRef.get()
    if (processedDoc.exists) {
      console.log(`[INBOUND] Duplicate webhook message detected: ${MessageID}. Skipping.`)
      return res.json({ success: true, duplicate: true })
    }

    // 4. Validate Sender
    const senderEmail = From.trim().toLowerCase()
    const customerEmail = ticket.customerEmail.trim().toLowerCase()
    const authEmail = ticket.authEmail ? ticket.authEmail.trim().toLowerCase() : ''

    const isSenderValid = (senderEmail === customerEmail || senderEmail === authEmail)

    if (!isSenderValid) {
      console.warn(`[INBOUND WARN] Sender mismatch for ticket ${ticketNumber}. Sender: ${senderEmail}, Ticket Owner: ${customerEmail}`)
      
      // Treat as unverified message. Append to history but do NOT change status or send notification to Jon.
      const historyEntry = {
        status: 'UNVERIFIED_EMAIL',
        timestamp: new Date().toISOString(),
        message: TextBody,
        unverifiedSender: From
      }

      await ticketRef.update({
        history: FieldValue.arrayUnion(historyEntry)
      })

      await processedRef.set({
        processedAt: FieldValue.serverTimestamp(),
        ticketNumber: ticketNumber,
        verified: false
      })

      return res.json({ success: true, verified: false, message: 'Unverified sender attached' })
    }

    // 5. Clean text body and append history entry
    const cleanedBody = cleanEmailBody(TextBody)
    const historyEntry = {
      status: 'CUSTOMER_RESPONDED',
      timestamp: new Date().toISOString(),
      message: cleanedBody,
      customerEmail: From
    }

    // 6. Update Ticket Status
    await ticketRef.update({
      status: 'CUSTOMER_RESPONDED',
      updatedAt: new Date(),
      history: FieldValue.arrayUnion(historyEntry)
    })

    // 7. Mark Message ID as processed
    await processedRef.set({
      processedAt: FieldValue.serverTimestamp(),
      ticketNumber: ticketNumber,
      verified: true
    })

    console.log(`[INBOUND] Successfully processed customer reply for ticket: ${ticketNumber}`)

    // 8. Notify Jon of customer reply
    await sendCustomerResponseNotification(ticket, cleanedBody)

    return res.json({ success: true, verified: true })
  } catch (error) {
    console.error('[INBOUND ERROR] Failed to process email:', error)
    return res.status(500).json({ error: 'Internal Server Error' })
  }
})

// =====================================
// Start Server
// =====================================

const PORT = process.env.PORT || 3001

app.listen(PORT, () => {
  console.log(`[BACKEND] Server running on http://localhost:${PORT}`)
})
