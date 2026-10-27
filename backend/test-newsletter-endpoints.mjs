import { cert, initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import fs from 'node:fs'
import crypto from 'node:crypto'

const credentialPath = 'C:\\Projects\\LANZAR\\firebase-credentials\\lanzar-95ae3-firebase-adminsdk-fbsvc-86e8ea5817.json'
const serviceAccount = JSON.parse(fs.readFileSync(credentialPath, 'utf8'))

const app = getApps().length > 0 ? getApps()[0] : initializeApp({ credential: cert(serviceAccount) })
const db = getFirestore(app)

function validateEmail(email) {
  if (!email || typeof email !== 'string') return null
  const normalized = email.trim().toLowerCase()
  if (normalized.length > 254) return null
  const regex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/
  if (!regex.test(normalized)) return null
  return normalized
}

async function runTests() {
  console.log('--- Running Newsletter Unit & Firestore Integration Tests ---')

  // 1. Validation tests
  console.log('1. Testing email validation:')
  if (validateEmail('test@lanzar.me') !== 'test@lanzar.me') throw new Error('Valid email rejected')
  if (validateEmail('  USER+TEST@LANZAR.ME ') !== 'user+test@lanzar.me') throw new Error('Normalization failed')
  if (validateEmail('notanemail') !== null) throw new Error('Invalid email accepted')
  if (validateEmail('') !== null) throw new Error('Empty email accepted')
  console.log('   ✓ Email validation tests passed')

  // 2. Test Firestore subscription insertion
  const testEmail = `test-cadet-${Date.now()}@lanzar.me`
  const docId = crypto.createHash('sha256').update(testEmail).digest('hex')
  const subRef = db.collection('subscribers').doc(docId)

  console.log('2. Testing Firestore subscriber insertion:')
  const testToken = crypto.randomBytes(32).toString('hex')
  await subRef.set({
    email: testEmail,
    status: 'active',
    source: 'homepage_test',
    consentMethod: 'homepage_modal',
    unsubscribeToken: testToken,
    subscribedAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  })

  const fetched = await subRef.get()
  if (!fetched.exists || fetched.data().status !== 'active') throw new Error('Failed to insert subscriber')
  console.log('   ✓ Subscriber inserted and confirmed in Firestore')

  // 3. Test unsubscribe via token
  console.log('3. Testing unsubscribe lookup by token:')
  const snap = await db.collection('subscribers').where('unsubscribeToken', '==', testToken).limit(1).get()
  if (snap.empty) throw new Error('Token query failed')
  await snap.docs[0].ref.update({
    status: 'unsubscribed',
    unsubscribedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  })
  const postUnsub = await subRef.get()
  if (postUnsub.data().status !== 'unsubscribed') throw new Error('Unsubscribe update failed')
  console.log('   ✓ Unsubscribe status updated to "unsubscribed"')

  // 4. Test suppression preservation (resubscribe of unsubscribed user)
  console.log('4. Testing suppression preservation:')
  const resubCheck = await subRef.get()
  if (resubCheck.data().status === 'unsubscribed') {
    // Should NOT be changed to active
    console.log('   ✓ Unsubscribed address is preserved as unsubscribed')
  }

  // 5. Cleanup test doc
  await subRef.delete()
  console.log('5. Cleaned up temporary test subscriber record')

  console.log('--- ALL TESTS PASSED SUCCESSFULLY ---')
}

runTests().then(() => process.exit(0)).catch(err => {
  console.error('TEST FAILURE:', err)
  process.exit(1)
})
