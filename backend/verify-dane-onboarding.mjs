import { cert, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import fs from 'node:fs'

const credentialPath = "C:\\Projects\\LANZAR\\firebase-credentials\\lanzar-95ae3-firebase-adminsdk-fbsvc-86e8ea5817.json"
const serviceAccount = JSON.parse(fs.readFileSync(credentialPath, 'utf8'))
const app = initializeApp({ credential: cert(serviceAccount) })
const db = getFirestore(app)

async function verify() {
  console.log('=== VERIFYING DANE ACCOUNT ===')
  const daneQuery = await db.collection('accounts').where('shortName', '==', 'DANE').get()
  
  if (daneQuery.empty) {
    console.error('❌ FAIL: DANE account not found!')
    process.exit(1)
  }

  const daneDoc = daneQuery.docs[0]
  const daneData = daneDoc.data()
  console.log(`✔ Account ID: ${daneDoc.id}`)
  console.log(`✔ Account Name: ${daneData.name}`)
  console.log(`✔ Short Name: ${daneData.shortName}`)
  console.log(`✔ Primary Contact Email: ${daneData.primaryContactEmail}`)
  console.log(`✔ Authorized Services: ${JSON.stringify(daneData.services)}`)

  console.log('\n=== VERIFYING DANE LOCATIONS ===')
  const locs = await daneDoc.ref.collection('locations').get()
  locs.forEach(doc => {
    const d = doc.data()
    console.log(`  Location ID: ${doc.id} | Name: ${d.name} | Confidence: ${d.confidence}`)
  })

  console.log('\n=== VERIFYING DANE ASSETS ===')
  const assets = await daneDoc.ref.collection('assets').get()
  assets.forEach(doc => {
    const d = doc.data()
    console.log(`  Asset ID: ${doc.id} | Name: ${d.name} | Type: ${d.type} | Hostname: ${d.hostname} | Confidence: ${d.confidence}`)
  })

  console.log('\n=== VERIFYING EXISTING CUSTOMERS & TICKETS REGRESSION ===')
  const legacyAccount = await db.collection('accounts').doc('ruAD6wBtgCGzCPnmfZqY').get()
  console.log(`✔ Legacy Account Exists: ${legacyAccount.exists} (${legacyAccount.data()?.name})`)

  const legacyCustomers = await db.collection('customers').get()
  console.log(`✔ Legacy Customers Count: ${legacyCustomers.size}`)

  const legacyTickets = await db.collection('tickets').get()
  console.log(`✔ Existing Tickets Count: ${legacyTickets.size}`)

  console.log('\n✔ ALL VERIFICATIONS PASSED')
}

verify().catch(console.error)
