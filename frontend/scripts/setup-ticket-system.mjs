/*
    setup-ticket-system.mjs

    LANZAR Platform ticket infrastructure bootstrap.

    Responsibilities

    - Connect to the LANZAR Platform Firebase project
    - Verify the existing LANZAR customer registry
    - Verify Jon's customer record
    - Create service-specific ticket counters
    - Preserve existing counters if the script is run again

    IMPORTANT

    - This script uses Firebase Admin credentials.
    - Never commit a service-account JSON file.
    - The frontend Firebase configuration is NOT used by this script.
*/

// ==========================
// Firebase Admin
// ==========================

import {
  cert,
  getApps,
  initializeApp,
} from 'firebase-admin/app'

import {
  getFirestore,
} from 'firebase-admin/firestore'

// ==========================
// Node
// ==========================

import fs from 'node:fs'

// ==========================
// Configuration
// ==========================

const STARTING_NUMBER = 10203

const services = [
  {
    id: 'it',
    label: 'IT',
  },
  {
    id: 'web',
    label: 'WEB',
  },
  {
    id: 'threadline',
    label: 'THREADLINE',
  },
]

// ==========================
// Credentials
// ==========================

const credentialPath =
  process.env.GOOGLE_APPLICATION_CREDENTIALS

if (!credentialPath) {
  console.error(
    '\nERROR: GOOGLE_APPLICATION_CREDENTIALS is not set.\n'
  )

  console.error(
    'Set it to the path of your LANZAR Platform Firebase service-account JSON file before running this script.\n'
  )

  process.exit(1)
}

if (!fs.existsSync(credentialPath)) {
  console.error(
    `\nERROR: Firebase service-account file was not found:\n${credentialPath}\n`
  )

  process.exit(1)
}

// ==========================
// Firebase Initialization
// ==========================

const serviceAccount =
  JSON.parse(
    fs.readFileSync(
      credentialPath,
      'utf8'
    )
  )

const app =
  getApps().length > 0
    ? getApps()[0]
    : initializeApp({
        credential: cert(serviceAccount),
      })

const db = getFirestore(app)

// ==========================
// Helpers
// ==========================

function printStatus(message) {
  console.log(`✓ ${message}`)
}

// ==========================
// Verify Customer Registry
// ==========================

async function verifyJonCustomer() {
  const snapshot = await db
    .collection('customers')
    .where(
      'customerEmail',
      '==',
      'jon@lanzar.me'
    )
    .limit(1)
    .get()

  if (snapshot.empty) {
    throw new Error(
      'Could not find the customer record for jon@lanzar.me.'
    )
  }

  const customer =
    snapshot.docs[0].data()

  if (
    customer.authEmail !==
    'jonny.scott79@gmail.com'
  ) {
    throw new Error(
      'Jon customer record exists, but authEmail does not match jonny.scott79@gmail.com.'
    )
  }

  if (
    customer.active !== true
  ) {
    throw new Error(
      'Jon customer record exists, but active is not true.'
    )
  }

  if (
    !Array.isArray(
      customer.services
    )
  ) {
    throw new Error(
      'Jon customer record exists, but services is not an array.'
    )
  }

  printStatus(
    `Customer verified: ${
      customer.displayName ??
      'Jon Scott'
    }`
  )

  printStatus(
    `Customer email: ${
      customer.customerEmail
    }`
  )

  printStatus(
    `Authorized services: ${
      customer.services
        .join(', ')
        .toUpperCase()
    }`
  )

  return snapshot.docs[0].id
}

// ==========================
// Create Counter
// ==========================

async function ensureCounter(service) {
  const counterRef =
    db
      .collection('counters')
      .doc(service.id)

  const snapshot =
    await counterRef.get()

  // ==========================
  // Existing Counter
  // ==========================

  if (snapshot.exists) {
    const data =
      snapshot.data()

    if (
      typeof data.nextNumber !==
      'number'
    ) {
      throw new Error(
        `Counter "${service.id}" exists but nextNumber is invalid.`
      )
    }

    printStatus(
      `${service.label} counter already exists: ${data.nextNumber}`
    )

    return
  }

  // ==========================
  // New Counter
  // ==========================

  await counterRef.set({
    service: service.id,
    nextNumber:
      STARTING_NUMBER,
  })

  printStatus(
    `${service.label} counter created: ${STARTING_NUMBER}`
  )
}

// ==========================
// Main
// ==========================

async function main() {
  console.log('')
  console.log(
    '========================================'
  )
  console.log(
    ' LANZAR PLATFORM TICKET SYSTEM SETUP'
  )
  console.log(
    '========================================'
  )
  console.log('')

  // ==========================
  // Firebase Connection
  // ==========================

  console.log(
    'Checking Firebase connection...'
  )

  const projectId =
    serviceAccount.project_id

  if (
    projectId !==
    'lanzar-95ae3'
  ) {
    throw new Error(
      `Wrong Firebase project detected: ${
        projectId ??
        'unknown'
      }. Expected lanzar-95ae3.`
    )
  }

  printStatus(
    `Connected to Firebase project: ${projectId}`
  )

  // ==========================
  // Customer Registry
  // ==========================

  console.log('')

  console.log(
    'Checking existing customer registry...'
  )

  const jonCustomerId =
    await verifyJonCustomer()

  printStatus(
    `Jon customer document: ${jonCustomerId}`
  )

  // ==========================
  // Ticket Counters
  // ==========================

  console.log('')

  console.log(
    'Creating ticket counters...'
  )

  for (
    const service of services
  ) {
    await ensureCounter(
      service
    )
  }

  // ==========================
  // Complete
  // ==========================

  console.log('')

  console.log(
    '========================================'
  )

  console.log(
    ' LANZAR TICKET SYSTEM READY'
  )

  console.log(
    '========================================'
  )

  console.log('')

  console.log(
    'Counters:'
  )

  for (
    const service of services
  ) {
    console.log(
      `  LZ-${service.id.toUpperCase()} → ${STARTING_NUMBER}+`
    )
  }

  console.log('')

  console.log(
    'Ticket documents will be created automatically when the first ticket is submitted.'
  )

  console.log('')
}

// ==========================
// Run
// ==========================

main()
  .catch((error) => {
    console.error('')
    console.error(
      'SETUP FAILED'
    )
    console.error('')
    console.error(
      error.message
    )
    console.error('')

    process.exit(1)
  })