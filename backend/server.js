/*
    server.js

    LANZAR Support Tickets backend application.

    Responsibilities

    - Provide administrative API endpoints
    - Handle secure customer account creation via Firebase Admin SDK
    - Verify client tokens and enforce server-side administrator authorization
    - Modify and validate customer service authorizations
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

dotenv.config()

// =====================================
// Initialization
// =====================================

const app = express()

// Allow CORS from Vite dev servers (defaults to 5173/5174)
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:5174'],
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
// Routes
// =====================================

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'LANZAR Tickets Backend' })
})

// Create Customer Account (Firebase Auth + Firestore Profile)
app.post('/api/customers', authenticateAdmin, async (req, res) => {
  const { name, email, services } = req.body

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Customer name is required' })
  }
  if (!email || !email.trim()) {
    return res.status(400).json({ error: 'Customer email is required' })
  }
  if (!Array.isArray(services) || services.length === 0) {
    return res.status(400).json({ error: 'At least one service must be selected' })
  }

  const normalizedEmail = email.trim().toLowerCase()

  try {
    // 1. Check if customer document already exists in Firestore
    const existingDocQuery = await db.collection('customers')
      .where('customerEmail', '==', normalizedEmail)
      .limit(1)
      .get()

    if (!existingDocQuery.empty) {
      return res.status(400).json({ error: 'A customer with this email is already registered' })
    }

    // 2. Look up or create user in Firebase Auth
    let authUser
    try {
      authUser = await auth.getUserByEmail(normalizedEmail)
      console.log(`[BACKEND] Auth user already exists in Firebase with UID: ${authUser.uid}`)
    } catch (authError) {
      if (authError.code === 'auth/user-not-found') {
        // User doesn't exist, create it without password
        authUser = await auth.createUser({
          email: normalizedEmail,
          displayName: name.trim()
        })
        console.log(`[BACKEND] New Auth user created in Firebase with UID: ${authUser.uid}`)
      } else {
        throw authError;
      }
    }

    // 3. Write profile to Firestore
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

// =====================================
// Start Server
// =====================================

const PORT = process.env.PORT || 3001

app.listen(PORT, () => {
  console.log(`[BACKEND] Server running on http://localhost:${PORT}`)
})
