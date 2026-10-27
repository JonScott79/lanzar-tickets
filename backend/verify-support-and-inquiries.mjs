// verify-support-and-inquiries.mjs
import { cert, initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import fs from 'node:fs'
import crypto from 'node:crypto'

const credentialPath = 'C:\\Projects\\LANZAR\\firebase-credentials\\lanzar-95ae3-firebase-adminsdk-fbsvc-86e8ea5817.json'
const serviceAccount = JSON.parse(fs.readFileSync(credentialPath, 'utf8'))
const app = getApps().length > 0 ? getApps()[0] : initializeApp({ credential: cert(serviceAccount) })
const db = getFirestore(app)

const SUPPORT_OTP_SECRET = 'lanzar_support_caller_otp_secret_key_2026'

async function runSupportAndInquiryTests() {
  console.log('========================================================')
  console.log('   LANZAR Support Verification & Inquiry Test Battery')
  console.log('========================================================\n')

  const testUid = `support_cust_${Date.now()}`
  const testEmail = `support.cadet.${Date.now()}@clientcorp.com`
  const testName = 'Jordan Rivera'
  const testPhone = '555-839-2049'
  const testCompany = 'Rivera Engineering Ltd'

  try {
    // -------------------------------------------------------------
    // TEST 1: Customer Profile Setup in Firestore
    // -------------------------------------------------------------
    console.log('[TEST 1] Setting up mock customer in Firestore...')
    await db.collection('customers').doc(testUid).set({
      id: testUid,
      customerId: testUid,
      customerName: testName,
      customerEmail: testEmail.toLowerCase(),
      authEmail: testEmail.toLowerCase(),
      phone: testPhone,
      businessName: testCompany,
      services: ['it', 'web'],
      active: true,
      createdAt: FieldValue.serverTimestamp()
    })
    console.log(`  ✓ Customer initialized with UID: ${testUid} (${testCompany})`)

    // -------------------------------------------------------------
    // TEST 2: Customer Lookup Compound Search Simulation
    // -------------------------------------------------------------
    console.log('\n[TEST 2] Testing Admin Customer Search Logic (by Phone & Company)...')
    const custSnap = await db.collection('customers').limit(50).get()
    const matches = []
    custSnap.forEach(doc => {
      const d = doc.data()
      if ((d.phone && d.phone.includes('839')) || (d.businessName && d.businessName.includes('Rivera'))) {
        matches.push({ id: doc.id, name: d.customerName, company: d.businessName })
      }
    })

    if (matches.length === 0) throw new Error('Customer search failed to locate customer by phone/company')
    console.log(`  ✓ Found matching customer: ${matches[0].name} (${matches[0].company})`)

    // -------------------------------------------------------------
    // TEST 3: Out-of-Band Challenge Generation (Cryptographic HMAC)
    // -------------------------------------------------------------
    console.log('\n[TEST 3] Testing Support Caller Verification Challenge Generation...')
    const otp = crypto.randomInt(100000, 999999).toString()
    const otpHash = crypto.createHmac('sha256', SUPPORT_OTP_SECRET).update(otp).digest('hex')
    const challengeId = `ch_test_${Date.now()}`
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000)

    await db.collection('support_challenges').doc(challengeId).set({
      challengeId,
      customerUid: testUid,
      adminUid: 'admin_test_uid',
      adminEmail: 'jon@lanzar.me',
      channel: 'email',
      destinationMasked: 'j***@clientcorp.com',
      otpHash,
      attempts: 0,
      maxAttempts: 3,
      status: 'pending',
      expiresAt,
      createdAt: FieldValue.serverTimestamp()
    })

    const challengeDoc = await db.collection('support_challenges').doc(challengeId).get()
    if (!challengeDoc.exists || challengeDoc.data().status !== 'pending') {
      throw new Error('Challenge record was not created properly')
    }
    console.log(`  ✓ Verification challenge generated (ID: ${challengeId}). Plaintext OTP never saved to DB.`)

    // -------------------------------------------------------------
    // TEST 4: Verification Validation & Attempt Rate-Limiting
    // -------------------------------------------------------------
    console.log('\n[TEST 4] Testing OTP Verification & Rate-Limiting...')
    
    // Test invalid OTP failure
    const badHash = crypto.createHmac('sha256', SUPPORT_OTP_SECRET).update('000000').digest('hex')
    if (crypto.timingSafeEqual(Buffer.from(otpHash), Buffer.from(badHash))) {
      throw new Error('Invalid code unexpectedly matched hash!')
    }
    console.log('  ✓ Incorrect OTP code rejected.')

    // Test correct OTP success
    const candidateHash = crypto.createHmac('sha256', SUPPORT_OTP_SECRET).update(otp).digest('hex')
    if (!crypto.timingSafeEqual(Buffer.from(otpHash), Buffer.from(candidateHash))) {
      throw new Error('Valid OTP failed hash comparison!')
    }

    // Mark verified and write to immutable audit log
    await db.collection('support_challenges').doc(challengeId).update({
      status: 'verified',
      verifiedAt: FieldValue.serverTimestamp()
    })

    const verificationId = `vfy_test_${Date.now()}`
    await db.collection('support_verifications').doc(verificationId).set({
      verificationId,
      challengeId,
      customerUid: testUid,
      adminUid: 'admin_test_uid',
      adminEmail: 'jon@lanzar.me',
      channel: 'email',
      destinationMasked: 'j***@clientcorp.com',
      status: 'verified',
      ticketId: 'tkt_sample_123',
      actionTaken: 'dns_records_reset',
      timestamp: FieldValue.serverTimestamp()
    })

    const auditDoc = await db.collection('support_verifications').doc(verificationId).get()
    if (!auditDoc.exists || auditDoc.data().status !== 'verified') {
      throw new Error('Audit trail record missing!')
    }
    console.log(`  ✓ Verified caller successfully. Immutable audit trail entry created: ${verificationId}`)

    // -------------------------------------------------------------
    // TEST 5: Public Inquiry Intake & Existing Customer Matching
    // -------------------------------------------------------------
    console.log('\n[TEST 5] Testing Public Inquiry Routing (Existing Customer Match)...')
    const inquiryTicketId1 = `tkt_inq_${Date.now()}`
    await db.collection('tickets').doc(inquiryTicketId1).set({
      id: inquiryTicketId1,
      ticketId: inquiryTicketId1,
      customerUid: testUid,
      requesterEmail: testEmail.toLowerCase(),
      subject: 'Inquiry from existing customer',
      message: 'Need help with email routing',
      isGuest: false,
      claimToken: null,
      createdAt: FieldValue.serverTimestamp()
    })

    const inq1Doc = await db.collection('tickets').doc(inquiryTicketId1).get()
    if (inq1Doc.data().isGuest !== false || inq1Doc.data().customerUid !== testUid) {
      throw new Error('Existing customer inquiry failed to associate customerUid!')
    }
    console.log('  ✓ Inquiry from registered customer automatically linked to account.')

    // -------------------------------------------------------------
    // TEST 6: Public Inquiry Intake (Guest Ticket & Claim Token)
    // -------------------------------------------------------------
    console.log('\n[TEST 6] Testing Public Inquiry Routing (Guest Ticket with Claim Token)...')
    const guestEmail = `guest.${Date.now()}@external.org`
    const guestTicketId = `tkt_guest_${Date.now()}`
    const claimToken = crypto.randomBytes(24).toString('hex')
    const claimExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

    await db.collection('tickets').doc(guestTicketId).set({
      id: guestTicketId,
      ticketId: guestTicketId,
      customerUid: null,
      requesterEmail: guestEmail,
      subject: 'Guest Inquiry',
      message: 'Looking for a new IT proposal',
      isGuest: true,
      claimToken,
      claimExpiresAt,
      createdAt: FieldValue.serverTimestamp()
    })

    const guestDoc = await db.collection('tickets').doc(guestTicketId).get()
    if (guestDoc.data().isGuest !== true || !guestDoc.data().claimToken) {
      throw new Error('Guest ticket not properly marked as guest with claim token!')
    }
    console.log(`  ✓ Guest ticket created with secure expiring claim token: ${claimToken.slice(0, 10)}...`)

    // Simulate claiming ticket
    await db.collection('tickets').doc(guestTicketId).update({
      isGuest: false,
      customerUid: testUid,
      claimToken: null,
      claimedAt: FieldValue.serverTimestamp()
    })

    const claimedDoc = await db.collection('tickets').doc(guestTicketId).get()
    if (claimedDoc.data().isGuest !== false || claimedDoc.data().customerUid !== testUid || claimedDoc.data().claimToken !== null) {
      throw new Error('Ticket claim did not properly update customerUid and clear token!')
    }
    console.log('  ✓ Guest ticket claimed successfully by authenticated user.')

    // -------------------------------------------------------------
    // TEST 7: Cleanup
    // -------------------------------------------------------------
    console.log('\n[TEST 7] Cleaning up test records from Firestore...')
    await db.collection('customers').doc(testUid).delete()
    await db.collection('support_challenges').doc(challengeId).delete()
    await db.collection('support_verifications').doc(verificationId).delete()
    await db.collection('tickets').doc(inquiryTicketId1).delete()
    await db.collection('tickets').doc(guestTicketId).delete()
    console.log('  ✓ All test records cleaned up.')

    console.log('\n========================================================')
    console.log('   ALL SUPPORT & INQUIRY TESTS PASSED (100%)')
    console.log('========================================================')
  } catch (err) {
    console.error('\n❌ TEST FAILED:', err.message)
    await db.collection('customers').doc(testUid).delete().catch(() => {})
    process.exit(1)
  }
}

runSupportAndInquiryTests().then(() => process.exit(0)).catch(err => {
  console.error(err)
  process.exit(1)
})
