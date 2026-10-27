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
import crypto from 'node:crypto'
import { 
  sendNewTicketNotification, 
  sendCustomerConfirmation,
  sendWelcomeEmail,
  sendPasswordResetEmail,
  renderNewsletterHtml,
  renderNewsletterText,
  sendTestNewsletter,
  sendNewsletterBatch
} from './emailService.js'
import {
  stripe,
  SERVICE_CATALOG,
  createCheckoutSession,
  createBillingPortalSession,
  getCustomerBillingStatus,
  processStripeWebhookEvent
} from './billingService.js'

dotenv.config()

// =====================================
// Initialization
// =====================================

const app = express()

// Dynamic CORS configuration allowing LANZAR domains and development environments
const allowedOrigins = [
  'https://tickets.lanzar.me',
  'https://portal.lanzar.me',
  'https://lanzar.me',
  'https://www.lanzar.me'
]

app.use(cors({
  origin: (origin, callback) => {
    // Allow non-browser requests or server-to-server
    if (!origin) return callback(null, true)
    if (
      allowedOrigins.includes(origin) ||
      /^http:\/\/localhost(:\d+)?$/.test(origin) ||
      /^http:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)
    ) {
      return callback(null, true)
    }
    return callback(null, false)
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}))

app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf
  }
}))

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

// Send Password Reset Email for an Existing Customer
app.post('/api/customers/:uid/password-reset', authenticateAdmin, async (req, res) => {
  const { uid } = req.params

  try {
    const userDoc = await db.collection('users').doc(uid).get()
    const custDoc = await db.collection('customers').doc(uid).get()

    let email = null
    let name = null

    if (userDoc.exists) {
      const uData = userDoc.data()
      email = uData.email
      name = uData.displayName
    } else if (custDoc.exists) {
      const cData = custDoc.data()
      email = cData.customerEmail || cData.authEmail
      name = cData.customerName || cData.displayName
    } else {
      try {
        const authRecord = await auth.getUser(uid)
        email = authRecord.email
        name = authRecord.displayName
      } catch (e) {
        return res.status(404).json({ error: 'Customer user record not found.' })
      }
    }

    if (!email) {
      return res.status(404).json({ error: 'Customer email address not found.' })
    }

    let authEmailToUse = email
    try {
      const authRecord = await auth.getUser(uid)
      if (authRecord && authRecord.email) {
        authEmailToUse = authRecord.email
      }
    } catch (authErr) {
      try {
        const createdAuthUser = await auth.createUser({
          uid: uid,
          email: email,
          displayName: name || email
        })
        authEmailToUse = createdAuthUser.email
      } catch (createErr) {
        console.warn('[BACKEND WARN] Could not create auth user for reset link generation:', createErr.message)
      }
    }

    const resetLink = await auth.generatePasswordResetLink(authEmailToUse)
    await sendPasswordResetEmail(email, name, resetLink)

    return res.json({
      success: true,
      message: `Password reset email sent successfully to ${email}.`
    })
  } catch (error) {
    console.error(`[BACKEND ERROR] Failed to send password reset for UID ${uid}:`, error)
    return res.status(500).json({ error: 'Failed to send password reset: ' + error.message })
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
// LANZAR Dispatch Newsletter Endpoints
// =====================================

// In-Memory Rate Limiter for Public Subscription Endpoint
const subscribeRateLimit = new Map()
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000 // 15 minutes
const RATE_LIMIT_MAX_ATTEMPTS = 5

function isRateLimited(ip) {
  const now = Date.now()
  const record = subscribeRateLimit.get(ip)
  if (!record || now - record.startTime > RATE_LIMIT_WINDOW_MS) {
    subscribeRateLimit.set(ip, { count: 1, startTime: now })
    return false
  }
  record.count++
  return record.count > RATE_LIMIT_MAX_ATTEMPTS
}

// Cleanup stale rate limit records
setInterval(() => {
  const now = Date.now()
  for (const [ip, record] of subscribeRateLimit.entries()) {
    if (now - record.startTime > RATE_LIMIT_WINDOW_MS) {
      subscribeRateLimit.delete(ip)
    }
  }
}, 30 * 60 * 1000)

function validateEmail(email) {
  if (!email || typeof email !== 'string') return null
  const normalized = email.trim().toLowerCase()
  if (normalized.length > 254) return null
  const regex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/
  if (!regex.test(normalized)) return null
  return normalized
}

function renderUnsubscribeHtml(title, message) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} &bull; LANZAR</title>
  <style>
    body {
      margin: 0; padding: 0;
      background-color: #0F172A;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; color: #102A43;
    }
    .card {
      background: #FAF6F0;
      border: 2px solid #E2B84D;
      border-radius: 8px;
      max-width: 520px;
      margin: 20px;
      padding: 40px 32px;
      text-align: center;
      box-shadow: 0 10px 30px rgba(0,0,0,0.4);
    }
    h1 {
      font-size: 24px;
      color: #102A43;
      margin-top: 0;
      margin-bottom: 16px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    p {
      font-size: 16px;
      line-height: 1.6;
      color: #334E68;
      margin-bottom: 28px;
    }
    a.btn {
      display: inline-block;
      background-color: #F46B45;
      color: #FFFFFF;
      text-decoration: none;
      font-weight: bold;
      padding: 12px 28px;
      border-radius: 50px;
      letter-spacing: 1px;
      text-transform: uppercase;
      font-size: 14px;
    }
    a.btn:hover { background-color: #D85430; }
  </style>
</head>
<body>
  <div class="card">
    <div style="font-size: 32px; margin-bottom: 16px;">&#128640;</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <a href="https://lanzar.me" class="btn">Return to LANZAR</a>
  </div>
</body>
</html>`
}

// Public: Subscribe to newsletter
app.post('/api/newsletter/subscribe', async (req, res) => {
  // Honeypot bot protection
  if (req.body.hp || req.body.website || req.body.b_name) {
    return res.json({ success: true, message: 'Transmission confirmed! Welcome aboard the LANZAR Dispatch.' })
  }

  const clientIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown'
  if (isRateLimited(clientIp)) {
    return res.status(429).json({ error: 'Too many subscription attempts from this station. Please try again shortly.' })
  }

  const email = validateEmail(req.body.email)
  if (!email) {
    return res.status(400).json({ error: 'Please provide a valid email address.' })
  }

  if (!db) {
    return res.status(500).json({ error: 'Database service currently unavailable. Please try again later.' })
  }

  try {
    const docId = crypto.createHash('sha256').update(email).digest('hex')
    const subRef = db.collection('subscribers').doc(docId)
    const existing = await subRef.get()

    if (existing.exists) {
      const data = existing.data()
      if (data.status === 'unsubscribed') {
        // Preserve unsubscription status without leaking state
        return res.json({
          success: true,
          message: 'Transmission received. If eligible, your subscription has been recorded.'
        })
      }
      // If already active, touch timestamp
      await subRef.update({
        updatedAt: FieldValue.serverTimestamp()
      })
      return res.json({
        success: true,
        message: 'You are subscribed to the LANZAR Dispatch.'
      })
    }

    // New active subscriber
    const unsubscribeToken = crypto.randomBytes(32).toString('hex')
    await subRef.set({
      email,
      status: 'active',
      source: req.body.source || 'homepage',
      consentMethod: 'homepage_modal',
      unsubscribeToken,
      subscribedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    })

    return res.json({
      success: true,
      message: 'Transmission confirmed! Welcome aboard the LANZAR Dispatch.'
    })
  } catch (error) {
    console.error('[NEWSLETTER ERROR] Subscription failed:', error)
    return res.status(500).json({ error: 'Failed to process subscription: ' + error.message })
  }
})

// Public: Unsubscribe Handler
async function handleUnsubscribe(token, res) {
  if (!token || typeof token !== 'string') {
    return res.status(400).send(renderUnsubscribeHtml('Invalid Token', 'The unsubscribe token provided is invalid.'))
  }

  if (!db) {
    return res.status(500).send(renderUnsubscribeHtml('System Error', 'Database service currently unavailable.'))
  }

  try {
    const snap = await db.collection('subscribers').where('unsubscribeToken', '==', token).limit(1).get()
    if (snap.empty) {
      return res.status(404).send(renderUnsubscribeHtml('Link Expired or Not Found', 'This subscription link is not recognized or has already been removed.'))
    }

    const docRef = snap.docs[0].ref
    await docRef.update({
      status: 'unsubscribed',
      unsubscribedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    })

    return res.send(renderUnsubscribeHtml('Unsubscribed Successfully', 'Your email address has been unsubscribed from the LANZAR Dispatch. You will receive no further transmissions.'))
  } catch (error) {
    console.error('[NEWSLETTER ERROR] Unsubscribe failed:', error)
    return res.status(500).send(renderUnsubscribeHtml('Error', 'Unable to process unsubscribe request: ' + error.message))
  }
}

app.get('/api/newsletter/unsubscribe', async (req, res) => {
  const token = req.query.token
  return handleUnsubscribe(token, res)
})

app.post('/api/newsletter/unsubscribe', async (req, res) => {
  const token = req.query.token || req.body?.token
  return handleUnsubscribe(token, res)
})

// =====================================
// Admin Newsletter Management Endpoints
// =====================================

// Admin: Get subscriber stats and list
app.get('/api/admin/newsletter/subscribers', authenticateAdmin, async (req, res) => {
  try {
    const snap = await db.collection('subscribers').get()
    const subscribers = []
    let active = 0
    let unsubscribed = 0

    snap.forEach(doc => {
      const d = doc.data()
      if (d.status === 'active') active++
      if (d.status === 'unsubscribed') unsubscribed++
      subscribers.push({
        id: doc.id,
        email: d.email,
        status: d.status || 'active',
        source: d.source || 'homepage',
        subscribedAt: d.subscribedAt ? d.subscribedAt.toDate() : null,
        unsubscribedAt: d.unsubscribedAt ? d.unsubscribedAt.toDate() : null
      })
    })

    subscribers.sort((a, b) => {
      const timeA = a.subscribedAt ? new Date(a.subscribedAt).getTime() : 0
      const timeB = b.subscribedAt ? new Date(b.subscribedAt).getTime() : 0
      return timeB - timeA
    })

    return res.json({
      success: true,
      total: subscribers.length,
      active,
      unsubscribed,
      subscribers
    })
  } catch (error) {
    console.error('[ADMIN ERROR] Failed to fetch subscribers:', error)
    return res.status(500).json({ error: 'Failed to fetch subscribers: ' + error.message })
  }
})

// Admin: Update subscriber status
app.post('/api/admin/newsletter/subscriber/status', authenticateAdmin, async (req, res) => {
  const { id, status } = req.body
  if (!id || !['active', 'unsubscribed'].includes(status)) {
    return res.status(400).json({ error: 'Valid subscriber ID and status (active/unsubscribed) are required.' })
  }

  try {
    const docRef = db.collection('subscribers').doc(id)
    const existing = await docRef.get()
    if (!existing.exists) {
      return res.status(404).json({ error: 'Subscriber record not found.' })
    }

    const updates = {
      status,
      updatedAt: FieldValue.serverTimestamp()
    }
    if (status === 'unsubscribed') {
      updates.unsubscribedAt = FieldValue.serverTimestamp()
    }

    await docRef.update(updates)
    return res.json({ success: true, message: `Subscriber status updated to ${status}.` })
  } catch (error) {
    console.error('[ADMIN ERROR] Failed to update subscriber status:', error)
    return res.status(500).json({ error: 'Failed to update subscriber status: ' + error.message })
  }
})

// Admin: Send test dispatch to admin
app.post('/api/admin/newsletter/send-test', authenticateAdmin, async (req, res) => {
  const { subject, content, testEmail } = req.body
  if (!subject || !content) {
    return res.status(400).json({ error: 'Subject and content are required.' })
  }

  const recipient = testEmail || req.admin.email || 'jon@lanzar.me'

  try {
    const result = await sendTestNewsletter({ toEmail: recipient, subject, content })
    return res.json({ success: true, recipient, messageId: result.messageId })
  } catch (error) {
    console.error('[ADMIN ERROR] Test dispatch failed:', error)
    return res.status(500).json({ error: 'Test dispatch failed: ' + error.message })
  }
})

// Admin: Send broadcast to active subscribers
let isBroadcastRunning = false

app.post('/api/admin/newsletter/send', authenticateAdmin, async (req, res) => {
  const { subject, content } = req.body
  if (!subject || !content) {
    return res.status(400).json({ error: 'Subject and content are required.' })
  }

  if (isBroadcastRunning) {
    return res.status(409).json({ error: 'A broadcast is currently in flight. Please wait for it to complete.' })
  }

  try {
    isBroadcastRunning = true

    const activeSnap = await db.collection('subscribers').where('status', '==', 'active').get()
    if (activeSnap.empty) {
      isBroadcastRunning = false
      return res.status(400).json({ error: 'No active subscribers found to broadcast to.' })
    }

    const subscribers = []
    activeSnap.forEach(doc => {
      const d = doc.data()
      if (d.email) {
        subscribers.push({
          id: doc.id,
          email: d.email,
          unsubscribeToken: d.unsubscribeToken
        })
      }
    })

    const dispatchRef = await db.collection('newsletter_dispatches').add({
      subject,
      contentSnippet: content.slice(0, 300),
      status: 'sending',
      recipientCount: subscribers.length,
      acceptedCount: 0,
      failedCount: 0,
      sentBy: req.admin.uid,
      sentByEmail: req.admin.email || 'Admin',
      createdAt: FieldValue.serverTimestamp(),
      sentAt: FieldValue.serverTimestamp()
    })

    const results = await sendNewsletterBatch(subscribers, subject, content)

    await dispatchRef.update({
      status: results.failures === 0 ? 'completed' : (results.success > 0 ? 'completed_with_errors' : 'failed'),
      acceptedCount: results.success,
      failedCount: results.failures,
      errorSummary: results.failedEmails.length > 0 ? JSON.stringify(results.failedEmails.slice(0, 10)) : null,
      completedAt: FieldValue.serverTimestamp()
    })

    isBroadcastRunning = false

    return res.json({
      success: true,
      dispatchId: dispatchRef.id,
      recipientCount: subscribers.length,
      accepted: results.success,
      failed: results.failures
    })
  } catch (error) {
    isBroadcastRunning = false
    console.error('[ADMIN ERROR] Newsletter broadcast failed:', error)
    return res.status(500).json({ error: 'Newsletter broadcast failed: ' + error.message })
  }
})

// Admin: Get broadcast history
app.get('/api/admin/newsletter/dispatches', authenticateAdmin, async (req, res) => {
  try {
    const snap = await db.collection('newsletter_dispatches')
      .orderBy('sentAt', 'desc')
      .limit(30)
      .get()

    const dispatches = []
    snap.forEach(doc => {
      const d = doc.data()
      dispatches.push({
        id: doc.id,
        subject: d.subject,
        status: d.status,
        recipientCount: d.recipientCount || 0,
        acceptedCount: d.acceptedCount || 0,
        failedCount: d.failedCount || 0,
        sentByEmail: d.sentByEmail || 'Admin',
        sentAt: d.sentAt ? d.sentAt.toDate() : null
      })
    })

    return res.json({ success: true, dispatches })
  } catch (error) {
    console.error('[ADMIN ERROR] Failed to fetch dispatches:', error)
    return res.status(500).json({ error: 'Failed to fetch dispatches: ' + error.message })
  }
})

// =====================================
// LANZAR Billing & Stripe Endpoints
// =====================================

// Public/Authenticated: Get Service Catalog
app.get('/api/billing/catalog', (req, res) => {
  return res.json({
    success: true,
    services: Object.values(SERVICE_CATALOG)
  })
})

// Authenticated Customer: Get Current Billing & Entitlement Status
app.get('/api/billing/customer-status', authenticateUser, async (req, res) => {
  if (!db) {
    return res.status(500).json({ error: 'Database service is currently unavailable.' })
  }

  try {
    const status = await getCustomerBillingStatus(req.user.uid, db)
    return res.json({ success: true, ...status })
  } catch (error) {
    console.error('[BILLING ERROR] Failed to fetch customer status:', error)
    return res.status(500).json({ error: 'Failed to fetch billing status: ' + error.message })
  }
})

// Authenticated Customer: Create Stripe Checkout Session
app.post('/api/billing/create-checkout-session', authenticateUser, async (req, res) => {
  if (!db) {
    return res.status(500).json({ error: 'Database service is currently unavailable.' })
  }

  const { serviceId, returnUrl } = req.body
  if (!serviceId) {
    return res.status(400).json({ error: 'Service ID is required.' })
  }

  try {
    const session = await createCheckoutSession({
      uid: req.user.uid,
      email: req.user.email,
      customerName: req.user.name || req.user.email,
      serviceId,
      returnUrl
    }, db)

    return res.json({
      success: true,
      sessionId: session.sessionId,
      url: session.url
    })
  } catch (error) {
    console.error('[BILLING ERROR] Checkout session creation failed:', error)
    return res.status(500).json({ error: 'Checkout session creation failed: ' + error.message })
  }
})

// Authenticated Customer: Create Stripe Customer Portal Session
app.post('/api/billing/create-portal-session', authenticateUser, async (req, res) => {
  if (!db) {
    return res.status(500).json({ error: 'Database service is currently unavailable.' })
  }

  const { returnUrl } = req.body

  try {
    const session = await createBillingPortalSession({
      uid: req.user.uid,
      email: req.user.email,
      customerName: req.user.name || req.user.email,
      returnUrl
    }, db)

    return res.json({
      success: true,
      url: session.url
    })
  } catch (error) {
    console.error('[BILLING ERROR] Portal session creation failed:', error)
    return res.status(500).json({ error: 'Portal session creation failed: ' + error.message })
  }
})

// Public Webhook: Verified Stripe Event Processor
app.post('/api/billing/webhook', async (req, res) => {
  if (!db) {
    return res.status(500).send('Database service unavailable.')
  }

  const sig = req.headers['stripe-signature']
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  let event

  if (stripe && webhookSecret) {
    try {
      if (!req.rawBody) {
        throw new Error('Raw body buffer not found for signature verification.')
      }
      event = stripe.webhooks.constructEvent(req.rawBody, sig, webhookSecret)
    } catch (err) {
      console.error('[STRIPE WEBHOOK ERROR] Signature verification failed:', err.message)
      return res.status(400).send(`Webhook Signature Verification Error: ${err.message}`)
    }
  } else {
    // Development or test mode without live signature secret
    event = req.body
  }

  try {
    const result = await processStripeWebhookEvent(event, db)
    return res.json({ received: true, ...result })
  } catch (error) {
    console.error('[STRIPE WEBHOOK ERROR] Event processing failed:', error)
    return res.status(500).json({ error: 'Webhook processing failed: ' + error.message })
  }
})



// =====================================
// Start Server
// =====================================

const PORT = process.env.PORT || 3001

app.listen(PORT, () => {
  console.log(`[BACKEND] Server running on http://localhost:${PORT}`)
})
