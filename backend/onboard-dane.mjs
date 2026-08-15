/*
    onboard-dane.mjs

    LANZAR Support Tickets — Customer Onboarding Script for DANE
    (Dental Associates of New England)

    Responsibilities:
    - Create DANE account document in 'accounts' collection
    - Create confirmed/pending locations in 'accounts/{accountId}/locations'
    - Create confirmed asset inventory in 'accounts/{accountId}/assets'
    - Tag each item with confidence metadata (CONFIRMED, HISTORICAL, NEEDS_CONFIRMATION)
    - Preserve existing accounts, users, tickets, and email configurations
*/

import { cert, initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import fs from 'node:fs'

const credentialPath = "C:\\Projects\\LANZAR\\firebase-credentials\\lanzar-95ae3-firebase-adminsdk-fbsvc-86e8ea5817.json"
const serviceAccount = JSON.parse(fs.readFileSync(credentialPath, 'utf8'))
const app = initializeApp({ credential: cert(serviceAccount) })
const db = getFirestore(app)

const DRY_RUN = process.argv.includes('--dry-run')

async function onboardDANE() {
  console.log('====================================================')
  console.log('LANZAR TICKETS — ONBOARDING: Dental Associates of New England (DANE)')
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (No Firestore writes)' : 'LIVE'}`)
  console.log('====================================================\n')

  // 1. Check if DANE account already exists
  const existingAccountQuery = await db.collection('accounts')
    .where('shortName', '==', 'DANE')
    .limit(1)
    .get()

  let accountRef
  let accountId

  if (!existingAccountQuery.empty) {
    accountRef = existingAccountQuery.docs[0].ref
    accountId = existingAccountQuery.docs[0].id
    console.log(`[ACCOUNT] DANE account already exists with ID: ${accountId}`)
  } else {
    accountRef = db.collection('accounts').doc()
    accountId = accountRef.id
    console.log(`[ACCOUNT] Generating new Account Document ID: ${accountId}`)
  }

  const accountData = {
    accountId: accountId,
    name: 'Dental Associates of New England',
    shortName: 'DANE',
    primaryContactEmail: 'boston@bostonsmile.com',
    services: ['it'], // Authorized for IT support only based on diagnostic baseline
    active: true,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: 'admin-onboarding',
    notes: 'Onboarded from diagnostic baseline. Primary contact: boston@bostonsmile.com'
  }

  console.log('\n--- Account Details ---')
  console.log(JSON.stringify(accountData, null, 2))

  if (!DRY_RUN) {
    await accountRef.set(accountData, { merge: true })
    console.log(`✔ Account written to Firestore: accounts/${accountId}`)
  }

  // 2. Create Locations
  console.log('\n--- Creating Locations ---')
  
  const locationsData = [
    {
      id: 'loc-bst',
      name: 'Boston Main Office (BST)',
      sitePrefix: 'BST',
      active: true,
      confidence: 'CONFIRMED',
      notes: 'Hosts Primary Domain Controller (BST001), Primary DNS, KDC, DentechBST GPO, and Dell PowerEdge T350 server.'
    },
    {
      id: 'loc-wal',
      name: 'Secondary Office (WAL)',
      sitePrefix: 'WAL',
      active: true,
      confidence: 'NEEDS_CONFIRMATION',
      notes: 'Hosts secondary Domain Controller and Global Catalog (WAL001). Physical address requires customer confirmation.'
    }
  ]

  for (const loc of locationsData) {
    const locRef = accountRef.collection('locations').doc(loc.id)
    const locPayload = {
      locationId: loc.id,
      accountId: accountId,
      name: loc.name,
      sitePrefix: loc.sitePrefix,
      active: loc.active,
      confidence: loc.confidence,
      notes: loc.notes,
      createdAt: FieldValue.serverTimestamp()
    }

    console.log(`Location [${loc.confidence}]: ${loc.name} (${loc.id})`)
    if (!DRY_RUN) {
      await locRef.set(locPayload, { merge: true })
      console.log(`  ✔ Written to accounts/${accountId}/locations/${loc.id}`)
    }
  }

  // 3. Create Asset Inventory
  console.log('\n--- Creating Confirmed Asset Inventory ---')

  const assetsData = [
    {
      id: 'asset-bst001',
      name: 'BST001',
      type: 'server',
      hostname: 'BST001',
      manufacturer: 'Dell',
      model: 'PowerEdge T350',
      domain: 'DA.local',
      locationId: 'loc-bst',
      locationName: 'Boston Main Office (BST)',
      status: 'degraded',
      confidence: 'CONFIRMED',
      notes: 'Primary Domain Controller (PDC Emulator), DNS Server, KDC, Global Catalog. Dual Broadcom NetXtreme NICs (Embedded NIC 1 Failed/Disconnected, Embedded NIC 2 Active 1Gbps). LAN_TEAM Degraded.'
    },
    {
      id: 'asset-wal001',
      name: 'WAL001',
      type: 'server',
      hostname: 'WAL001',
      manufacturer: null,
      model: null,
      domain: 'DA.local',
      locationId: 'loc-wal',
      locationName: 'Secondary Office (WAL)',
      status: 'active',
      confidence: 'CONFIRMED',
      notes: 'Secondary Domain Controller, Global Catalog.'
    },
    {
      id: 'asset-bstx-sta6',
      name: 'BSTX-STA6',
      type: 'workstation',
      hostname: 'BSTX-STA6',
      manufacturer: null,
      model: null,
      domain: 'DA.local',
      locationId: 'loc-bst',
      locationName: 'Boston Main Office (BST)',
      status: 'active',
      confidence: 'CONFIRMED',
      notes: 'Client Workstation in Boston office.'
    }
  ]

  for (const asset of assetsData) {
    const assetRef = accountRef.collection('assets').doc(asset.id)
    const assetPayload = {
      assetId: asset.id,
      accountId: accountId,
      name: asset.name,
      type: asset.type,
      hostname: asset.hostname,
      manufacturer: asset.manufacturer,
      model: asset.model,
      domain: asset.domain,
      locationId: asset.locationId,
      locationName: asset.locationName,
      status: asset.status,
      confidence: asset.confidence,
      notes: asset.notes,
      active: true,
      createdAt: FieldValue.serverTimestamp()
    }

    console.log(`Asset [${asset.confidence}]: ${asset.name} (${asset.type} - ${asset.hostname})`)
    if (!DRY_RUN) {
      await assetRef.set(assetPayload, { merge: true })
      console.log(`  ✔ Written to accounts/${accountId}/assets/${asset.id}`)
    }
  }

  console.log('\n====================================================')
  console.log(`ONBOARDING ${DRY_RUN ? 'DRY RUN COMPLETE' : 'COMPLETED SUCCESSFULLY'}`)
  console.log(`Account ID: ${accountId}`)
  console.log('====================================================')
}

onboardDANE().catch(err => {
  console.error('[ONBOARDING ERROR]', err)
  process.exit(1)
})
