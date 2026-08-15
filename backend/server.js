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
  sendCustomerConfirmation 
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

let serviceAccount = null
let serviceAccountProjectId = null

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    serviceAccountProjectId = serviceAccount.project_id
    console.log('[BACKEND] Initializing Firebase Admin via FIREBASE_SERVICE_ACCOUNT environment variable')
  } catch (parseErr) {
    console.error('[BACKEND ERROR] Failed to parse FIREBASE_SERVICE_ACCOUNT env variable:', parseErr.message)
  }
} else {
  const credentialPath = 'C:\\Projects\\LANZAR\\firebase-credentials\\lanzar-95ae3-firebase-adminsdk-fbsvc-86e8ea5817.json'
  if (fs.existsSync(credentialPath)) {
    try {
      serviceAccount = JSON.parse(fs.readFileSync(credentialPath, 'utf8'))
      serviceAccountProjectId = serviceAccount.project_id
      console.log('[BACKEND] Initializing Firebase Admin via local credentials file')
    } catch (readErr) {
      console.error('[BACKEND ERROR] Failed to read/parse local credentials file:', readErr.message)
    }
  } else {
    console.warn(`[BACKEND WARN] Firebase service credentials not found. Set FIREBASE_SERVICE_ACCOUNT env var or place file at: ${credentialPath}`)
  }
}

let adminApp = null
let auth = null
let db = null

if (serviceAccount) {
  try {
    adminApp = getApps().length > 0
      ? getApps()[0]
      : initializeApp({
          credential: cert(serviceAccount)
        })

    auth = getAuth(adminApp)
    db = getFirestore(adminApp)

    console.log('[BACKEND] Connected to Firebase Project:', serviceAccountProjectId)
  } catch (initErr) {
    console.error('[BACKEND ERROR] Failed to initialize Firebase Admin SDK:', initErr.message)
  }
} else {
  console.warn('[BACKEND WARN] Firebase Admin SDK is NOT initialized. Services requiring Firestore or Auth will fail.')
}

// =====================================
// Middleware: Admin Authorization
// =====================================

async function authenticateAdmin(req, res, next) {
  if (!auth || !db) {
    console.error('[BACKEND ERROR] Admin authorization attempted but Firebase Admin SDK is not initialized.')
    return res.status(500).json({ error: 'Database service is currently unavailable.' })
  }
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
  if (!auth) {
    console.error('[BACKEND ERROR] User authorization attempted but Firebase Admin SDK is not initialized.')
    return res.status(500).json({ error: 'Authentication service is currently unavailable.' })
  }
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

app.get('/api/health', (req, res) => {
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
  if (!db) {
    console.error('[BACKEND ERROR] Ticket notification requested but Database (Firestore) is not initialized.')
    return res.status(500).json({ error: 'Database service is currently unavailable.' })
  }

  const { ticketId } = req.body

  if (!ticketId) {
    return res.status(400).json({ error: 'Ticket ID is required' })
  }

  console.log(`[EMAIL] New ticket notification requested for ticket: ${ticketId} by user: ${req.user.email} (UID: ${req.user.uid})`)

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
      console.log(`[EMAIL] Notification email already sent for ${ticketId}. Skipping.`)
      return res.json({ success: true, alreadySent: true })
    }

    // Resolve customer email address from customers collection in Firestore
    let customerEmail = ticketData.customerEmail
    let customerName = ticketData.customerName

    if (ticketData.customerId) {
      try {
        const customerDoc = await db.collection('customers').doc(ticketData.customerId).get()
        if (customerDoc.exists) {
          const customerData = customerDoc.data()
          if (customerData.customerEmail) {
            customerEmail = customerData.customerEmail
          }
          if (customerData.displayName) {
            customerName = customerData.displayName
          }
        }
      } catch (custErr) {
        console.warn(`[BACKEND WARN] Failed to resolve customer document for customerId ${ticketData.customerId}:`, custErr.message)
      }
    }

    const resolvedTicketData = {
      ...ticketData,
      customerEmail,
      customerName
    }

    console.log(`[EMAIL] Attempting provider email requests for ticket: ${ticketId}`)
    const [adminResult, customerResult] = await Promise.allSettled([
      sendNewTicketNotification(resolvedTicketData),
      sendCustomerConfirmation(resolvedTicketData)
    ])

    if (adminResult.status === 'fulfilled' && adminResult.value) {
      console.log(`[EMAIL] Provider accepted admin notification for ${ticketId}. Message ID: ${adminResult.value.messageId}`)
    } else {
      const errorMsg = adminResult.status === 'rejected' ? adminResult.reason.message : 'No data returned'
      console.warn(`[EMAIL WARN] Admin notification request failed for ${ticketId}: ${errorMsg}`)
    }

    if (customerResult.status === 'fulfilled' && customerResult.value) {
      console.log(`[EMAIL] Provider accepted customer confirmation for ${ticketId}. Message ID: ${customerResult.value.messageId}`)
    } else {
      const errorMsg = customerResult.status === 'rejected' ? customerResult.reason.message : 'No data returned'
      console.warn(`[EMAIL WARN] Customer confirmation request failed for ${ticketId}: ${errorMsg}`)
    }

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



// =====================================
// Start Server
// =====================================

const PORT = process.env.PORT || 3001

app.listen(PORT, () => {
  console.log(`[BACKEND] Server running on http://localhost:${PORT}`)
})
