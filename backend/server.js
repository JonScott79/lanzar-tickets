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
  sendCustomerConfirmation,
  sendWelcomeEmail
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

// Create New Organization / Account
app.post('/api/accounts', authenticateAdmin, async (req, res) => {
  const { name, shortName, primaryContactName, primaryContactEmail, services } = req.body

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Organization Name is required.' })
  }

  const normalizedName = name.trim()

  try {
    // Check if account with same name already exists
    const existingAcc = await db.collection('accounts')
      .where('name', '==', normalizedName)
      .limit(1)
      .get()

    if (!existingAcc.empty) {
      return res.status(400).json({ error: 'An organization with this name already exists.' })
    }

    const accountRef = db.collection('accounts').doc()
    const accountData = {
      name: normalizedName,
      shortName: shortName ? shortName.trim() : '',
      primaryContactName: primaryContactName ? primaryContactName.trim() : '',
      primaryContactEmail: primaryContactEmail ? primaryContactEmail.trim().toLowerCase() : '',
      services: Array.isArray(services) && services.length > 0 ? services : ['it'],
      active: true,
      createdAt: FieldValue.serverTimestamp()
    }

    await accountRef.set(accountData)
    console.log(`[BACKEND] Created new organization "${normalizedName}" (ID: ${accountRef.id})`)

    return res.json({
      success: true,
      accountId: accountRef.id,
      name: normalizedName,
      shortName: accountData.shortName,
      services: accountData.services
    })
  } catch (error) {
    console.error('[BACKEND ERROR] Organization creation failed:', error)
    return res.status(500).json({ error: 'Failed to create organization: ' + error.message })
  }
})

// Create Customer Account (Firebase Auth + Firestore Profile + Welcome Email)
app.post('/api/customers', authenticateAdmin, async (req, res) => {
  const { name, email, services, accountId, sendWelcomeEmail: sendEmailFlag } = req.body

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Customer Name is required.' })
  }
  if (!email || !email.trim()) {
    return res.status(400).json({ error: 'Customer Email is required.' })
  }
  if (!Array.isArray(services) || services.length === 0) {
    return res.status(400).json({ error: 'At least one authorized service must be selected.' })
  }
  if (!accountId || !accountId.trim()) {
    return res.status(400).json({ error: 'Customer Account selection is required.' })
  }

  const normalizedEmail = email.trim().toLowerCase()
  const targetAccountId = accountId.trim()

  try {
    // 0. Verify selected account exists and is active
    const accountDoc = await db.collection('accounts').doc(targetAccountId).get()
    if (!accountDoc.exists || accountDoc.data().active !== true) {
      return res.status(400).json({ error: 'Selected account does not exist or is inactive.' })
    }
    const accountName = accountDoc.data().name || 'LANZAR Tickets'

    // 1. Check if user already exists in Firebase Auth
    let authUser = null
    try {
      authUser = await auth.getUserByEmail(normalizedEmail)
    } catch (authErr) {
      if (authErr.code !== 'auth/user-not-found') {
        throw authErr
      }
    }

    if (authUser) {
      // User exists in Firebase Auth — check which account they belong to
      const userDoc = await db.collection('users').doc(authUser.uid).get()
      if (userDoc.exists) {
        const existingAccountId = userDoc.data().accountId
        if (existingAccountId === targetAccountId) {
          // User already belongs to this account. Resend welcome email if requested.
          if (sendEmailFlag !== false) {
            try {
              const resetLink = await auth.generatePasswordResetLink(normalizedEmail)
              await sendWelcomeEmail(normalizedEmail, name.trim(), accountName, resetLink)
              return res.json({
                success: true,
                uid: authUser.uid,
                email: normalizedEmail,
                name: name.trim(),
                services,
                emailSent: true,
                message: `User already exists for ${accountName}. Welcome email sent.`
              })
            } catch (resendErr) {
              return res.json({
                success: true,
                uid: authUser.uid,
                email: normalizedEmail,
                name: name.trim(),
                services,
                emailSent: false,
                warning: `User already exists for ${accountName}, but welcome email could not be delivered: ${resendErr.message}`
              })
            }
          }
          return res.json({
            success: true,
            uid: authUser.uid,
            email: normalizedEmail,
            name: name.trim(),
            services,
            message: `User already exists for ${accountName}.`
          })
        } else {
          // User belongs to ANOTHER account — REJECT with clear security error
          return res.status(400).json({
            error: 'This email address is already registered under another customer account.'
          })
        }
      }
    }

    // 2. Create Firebase Auth user without password
    try {
      authUser = await auth.createUser({
        email: normalizedEmail,
        displayName: name.trim(),
      })
      console.log(`[BACKEND] Auth user created successfully with UID: ${authUser.uid} (No password created)`)
    } catch (createAuthError) {
      console.error('[BACKEND ERROR] Firebase Auth user creation failed:', createAuthError)
      return res.status(400).json({ error: 'Failed to create customer account: ' + createAuthError.message })
    }

    // 3. Write customer profile to Firestore (both legacy and new collections)
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

      await db.collection('users').doc(authUser.uid).set({
        accountId: targetAccountId,
        displayName: name.trim(),
        email: normalizedEmail,
        role: 'USER',
        active: true,
        createdAt: FieldValue.serverTimestamp()
      })
      console.log(`[BACKEND] Firestore records created for: ${normalizedEmail} (accountId: ${targetAccountId})`)
    } catch (firestoreError) {
      console.error('[BACKEND ERROR] Firestore write failed, rolling back Firebase Auth user...', firestoreError)
      try {
        await auth.deleteUser(authUser.uid)
      } catch (rollbackError) {
        console.error('[BACKEND ERROR] Rollback failed:', rollbackError.message)
      }
      return res.status(500).json({ error: 'Failed to complete database registration. Auth account rolled back.' })
    }

    // 4. Send Welcome Email if requested
    let emailSent = false
    let warning = null

    if (sendEmailFlag !== false) {
      try {
        const resetLink = await auth.generatePasswordResetLink(normalizedEmail)
        await sendWelcomeEmail(normalizedEmail, name.trim(), accountName, resetLink)
        emailSent = true
      } catch (emailErr) {
        console.error('[BACKEND ERROR] Welcome email failed to send:', emailErr.message)
        warning = 'Customer registered successfully, but welcome email could not be sent.'
      }
    }

    return res.json({
      success: true,
      uid: authUser.uid,
      email: normalizedEmail,
      name: name.trim(),
      services: services,
      emailSent: emailSent,
      ...(warning ? { warning } : {})
    })
  } catch (error) {
    console.error('[BACKEND ERROR] Customer creation failed:', error)
    return res.status(500).json({ error: 'Failed to create customer: ' + error.message })
  }
})

// Send or Resend Welcome Email for an Existing Customer
app.post('/api/customers/:uid/welcome-email', authenticateAdmin, async (req, res) => {
  const { uid } = req.params

  try {
    const userDoc = await db.collection('users').doc(uid).get()
    const custDoc = await db.collection('customers').doc(uid).get()

    let email = null
    let name = null
    let accountId = null

    if (userDoc.exists) {
      const uData = userDoc.data()
      email = uData.email
      name = uData.displayName
      accountId = uData.accountId
    } else if (custDoc.exists) {
      const cData = custDoc.data()
      email = cData.customerEmail || cData.authEmail
      name = cData.customerName || cData.displayName
      accountId = cData.accountId
    } else {
      try {
        const authRecord = await auth.getUser(uid)
        email = authRecord.email
        name = authRecord.displayName
      } catch (e) {
        return res.status(404).json({ error: 'Customer user record not found.' })
      }
    }

    let authEmailToUse = email
    try {
      const authRecord = await auth.getUser(uid)
      if (authRecord && authRecord.email) {
        authEmailToUse = authRecord.email
      }
    } catch (authErr) {
      // If user is not yet in Firebase Auth, create them so we can generate their setup link
      try {
        const createdAuthUser = await auth.createUser({
          uid: uid,
          email: email,
          displayName: name || email
        })
        authEmailToUse = createdAuthUser.email
      } catch (createErr) {
        console.warn('[BACKEND WARN] Could not create auth user for link generation:', createErr.message)
      }
    }

    let accountName = 'LANZAR Tickets'
    if (accountId) {
      const accDoc = await db.collection('accounts').doc(accountId).get()
      if (accDoc.exists) {
        accountName = accDoc.data().name || accountName
      }
    }

    const resetLink = await auth.generatePasswordResetLink(authEmailToUse)
    await sendWelcomeEmail(email, name, accountName, resetLink)

    return res.json({
      success: true,
      message: `Welcome email sent successfully to ${email}.`
    })
  } catch (error) {
    console.error(`[BACKEND ERROR] Failed to send welcome email for UID ${uid}:`, error)
    return res.status(500).json({ error: 'Failed to send welcome email: ' + error.message })
  }
})

// Update Customer Active / Revoked Status (Revoke or Re-enable access)
app.post('/api/customers/:uid/status', authenticateAdmin, async (req, res) => {
  const { uid } = req.params
  const { active } = req.body

  if (typeof active !== 'boolean') {
    return res.status(400).json({ error: 'Field "active" (boolean) is required.' })
  }

  try {
    // 1. Update users/{uid} document in Firestore
    const userRef = db.collection('users').doc(uid)
    const userDoc = await userRef.get()

    let userName = 'User'
    if (userDoc.exists) {
      userName = userDoc.data().displayName || userDoc.data().email || userName
      await userRef.update({
        active: active,
        updatedAt: FieldValue.serverTimestamp()
      })
    }

    // 2. Update legacy customers/{uid} document if present
    const custRef = db.collection('customers').doc(uid)
    const custDoc = await custRef.get()
    if (custDoc.exists) {
      userName = custDoc.data().customerName || custDoc.data().displayName || userName
      await custRef.update({
        active: active,
        updatedAt: FieldValue.serverTimestamp()
      })
    }

    // 3. Update Firebase Auth user (disabled = !active)
    try {
      await auth.updateUser(uid, { disabled: !active })
      console.log(`[BACKEND] Firebase Auth status updated for ${uid}: disabled = ${!active}`)
    } catch (authErr) {
      console.warn(`[BACKEND WARN] Firebase Auth status update failed for ${uid}:`, authErr.message)
    }

    console.log(`[BACKEND] User ${uid} ("${userName}") active status set to: ${active}`)
    return res.json({
      success: true,
      active: active,
      message: active
        ? `Access restored for user "${userName}".`
        : `Access revoked for user "${userName}". Account disabled.`
    })
  } catch (error) {
    console.error(`[BACKEND ERROR] Status update failed for user ${uid}:`, error)
    return res.status(500).json({ error: 'Failed to update user status: ' + error.message })
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

    // Resolve customer email address — try users/ first, fall back to customers/
    let customerEmail = ticketData.customerEmail
    let customerName = ticketData.customerName

    if (ticketData.customerId) {
      try {
        // Try the new users collection first
        let resolved = false
        const userDoc = await db.collection('users').doc(ticketData.customerId).get()
        if (userDoc.exists) {
          const userData = userDoc.data()
          if (userData.email) {
            customerEmail = userData.email
          }
          if (userData.displayName) {
            customerName = userData.displayName
          }
          resolved = true
        }

        // Fall back to legacy customers collection
        if (!resolved) {
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

// Global Service Catalog API
app.get('/api/services', async (req, res) => {
  try {
    const snap = await db.collection('services').get()
    const list = []
    snap.forEach(doc => {
      list.push({ id: doc.id, ...doc.data() })
    })
    return res.json({ success: true, services: list })
  } catch (error) {
    console.error('[BACKEND ERROR] Failed to fetch services:', error)
    return res.status(500).json({ error: 'Failed to fetch services: ' + error.message })
  }
})

app.post('/api/services', authenticateAdmin, async (req, res) => {
  const { id, data } = req.body
  if (!id || !data) {
    return res.status(400).json({ error: 'Service ID and data are required.' })
  }
  try {
    await db.collection('services').doc(id).set(data, { merge: true })
    return res.json({ success: true, message: 'Service updated successfully.' })
  } catch (error) {
    console.error('[BACKEND ERROR] Failed to update service:', error)
    return res.status(500).json({ error: 'Failed to update service: ' + error.message })
  }
})

// Send Customer Announcement
app.post('/api/admin/announcements', authenticateAdmin, async (req, res) => {
  const { subject, message, accountId } = req.body

  if (!subject || !message) {
    return res.status(400).json({ error: 'Subject and message are required.' })
  }

  try {
    let usersQuery = db.collection('users').where('active', '==', true)
    
    if (accountId && accountId !== 'ALL') {
      usersQuery = usersQuery.where('accountId', '==', accountId)
    }

    const snapshot = await usersQuery.get()
    
    if (snapshot.empty) {
      return res.status(400).json({ error: 'No active users found to send the announcement to.' })
    }

    const recipients = []
    snapshot.forEach(doc => {
      const data = doc.data()
      if (data.email) {
        recipients.push({ email: data.email, name: data.displayName || 'Customer' })
      }
    })

    if (recipients.length === 0) {
      return res.status(400).json({ error: 'No valid email addresses found among the targeted users.' })
    }

    const { sendAnnouncementEmail } = await import('./emailService.js')
    const results = await sendAnnouncementEmail(recipients, subject, message)

    // Log the announcement in Firestore for auditability
    await db.collection('announcements').add({
      subject,
      message,
      targetAccountId: accountId || 'ALL',
      recipientCount: recipients.length,
      successCount: results.success,
      failureCount: results.failures,
      sentBy: req.admin.uid,
      sentAt: FieldValue.serverTimestamp()
    })

    return res.json({ 
      success: true, 
      recipientCount: recipients.length,
      delivered: results.success,
      failed: results.failures
    })
  } catch (error) {
    console.error('[BACKEND ERROR] Announcement dispatch failed:', error)
    return res.status(500).json({ error: 'Failed to dispatch announcement: ' + error.message })
  }
})



// =====================================
// Start Server
// =====================================

const PORT = process.env.PORT || 3001

app.listen(PORT, () => {
  console.log(`[BACKEND] Server running on http://localhost:${PORT}`)
})
