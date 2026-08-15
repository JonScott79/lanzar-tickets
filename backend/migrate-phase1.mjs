/*
    migrate-phase1.mjs

    LANZAR Tickets Phase 1 Migration Script.

    Responsibilities

    - Create the "Legacy Customers" account in the accounts collection
    - Mirror existing customer documents into the users collection
    - Backfill accountId on all existing ticket documents
    - Preserve all existing data — no deletions, no destructive changes
*/

import { cert, initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import fs from 'node:fs'

// =====================================
// Initialization
// =====================================

const credentialPath = "C:\\Projects\\LANZAR\\firebase-credentials\\lanzar-95ae3-firebase-adminsdk-fbsvc-86e8ea5817.json"
const serviceAccount = JSON.parse(fs.readFileSync(credentialPath, 'utf8'))
const app = initializeApp({ credential: cert(serviceAccount) })
const db = getFirestore(app)

// =====================================
// Configuration
// =====================================

const DRY_RUN = process.argv.includes('--dry-run')
const LEGACY_ACCOUNT_NAME = 'Legacy Customers'

// =====================================
// Migration
// =====================================

async function migrate() {
  console.log(`\n[MIGRATION] LANZAR Tickets — Phase 1 Migration`)
  console.log(`[MIGRATION] Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`)
  console.log()

  // ─── Step 1: Create the Legacy Customers account ───

  console.log('[STEP 1] Creating account document...')

  // Check if accounts collection already has documents
  const existingAccounts = await db.collection('accounts').limit(1).get()
  let accountId

  if (!existingAccounts.empty) {
    accountId = existingAccounts.docs[0].id
    console.log(`  Account already exists: ${accountId}`)
    console.log(`  Name: ${existingAccounts.docs[0].data().name}`)
    console.log(`  Skipping creation.`)
  } else {
    const accountRef = db.collection('accounts').doc()
    accountId = accountRef.id

    const accountData = {
      accountId: accountId,
      name: LEGACY_ACCOUNT_NAME,
      services: ['it', 'web', 'threadline'],
      active: true,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: 'migration-phase1',
      notes: 'Auto-created during Phase 1 migration. Rename to the actual organization name.'
    }

    if (!DRY_RUN) {
      await accountRef.set(accountData)
      console.log(`  Created account: ${accountId}`)
      console.log(`  Name: ${LEGACY_ACCOUNT_NAME}`)
    } else {
      console.log(`  [DRY RUN] Would create account: ${accountId}`)
      console.log(`  [DRY RUN] Data: ${JSON.stringify(accountData, null, 2)}`)
    }
  }

  console.log()

  // ─── Step 2: Mirror customers → users ───

  console.log('[STEP 2] Mirroring customers to users collection...')

  const customers = await db.collection('customers').get()
  let usersCreated = 0
  let usersSkipped = 0

  for (const customerDoc of customers.docs) {
    const uid = customerDoc.id
    const data = customerDoc.data()

    // Check if user document already exists
    const existingUser = await db.collection('users').doc(uid).get()
    if (existingUser.exists) {
      console.log(`  User ${uid} already exists. Skipping.`)
      usersSkipped++
      continue
    }

    const userData = {
      accountId: accountId,
      displayName: data.displayName || data.customerName || 'Unknown',
      email: data.customerEmail || data.authEmail || '',
      role: 'USER',
      active: data.active === true,
      createdAt: data.createdAt || FieldValue.serverTimestamp()
    }

    if (!DRY_RUN) {
      await db.collection('users').doc(uid).set(userData)
      console.log(`  Created user: ${uid} (${userData.email})`)
    } else {
      console.log(`  [DRY RUN] Would create user: ${uid} (${userData.email})`)
      console.log(`  [DRY RUN] Data: ${JSON.stringify(userData, null, 2)}`)
    }

    usersCreated++
  }

  console.log(`  Users created: ${usersCreated}, skipped: ${usersSkipped}`)
  console.log()

  // ─── Step 3: Backfill accountId on existing tickets ───

  console.log('[STEP 3] Backfilling accountId on existing tickets...')

  const tickets = await db.collection('tickets').get()
  let ticketsUpdated = 0
  let ticketsSkipped = 0

  for (const ticketDoc of tickets.docs) {
    const data = ticketDoc.data()

    // Skip tickets that already have accountId
    if (data.accountId) {
      console.log(`  Ticket ${ticketDoc.id} already has accountId. Skipping.`)
      ticketsSkipped++
      continue
    }

    const updateData = {
      accountId: accountId,
    }

    if (!DRY_RUN) {
      await ticketDoc.ref.update(updateData)
      console.log(`  Updated ticket: ${ticketDoc.id} — added accountId`)
    } else {
      console.log(`  [DRY RUN] Would update ticket: ${ticketDoc.id}`)
    }

    ticketsUpdated++
  }

  console.log(`  Tickets updated: ${ticketsUpdated}, skipped: ${ticketsSkipped}`)
  console.log()

  // ─── Summary ───

  console.log('[MIGRATION] Phase 1 Migration Complete')
  console.log(`  Account ID: ${accountId}`)
  console.log(`  Account Name: ${LEGACY_ACCOUNT_NAME}`)
  console.log(`  Users created: ${usersCreated}`)
  console.log(`  Tickets backfilled: ${ticketsUpdated}`)
  if (DRY_RUN) {
    console.log('\n  ⚠ DRY RUN — No changes were written to Firestore.')
    console.log('  Run without --dry-run to execute the migration.')
  }
}

migrate().catch(error => {
  console.error('[MIGRATION ERROR]', error)
  process.exit(1)
})
