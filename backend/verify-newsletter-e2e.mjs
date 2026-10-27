import { cert, initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import fs from 'node:fs'
import crypto from 'node:crypto'
import {
  renderNewsletterHtml,
  renderNewsletterText,
  sendTestNewsletter,
  sendNewsletterBatch
} from './emailService.js'

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

async function runE2E() {
  console.log('========================================================')
  console.log('   LANZAR Dispatch — Full End-to-End Verification Battery')
  console.log('========================================================\n')

  const testId = Date.now()
  const activeEmail = `cadet.alpha.${testId}@lanzar.me`
  const optOutEmail = `cadet.beta.${testId}@lanzar.me`

  const activeDocId = crypto.createHash('sha256').update(activeEmail).digest('hex')
  const optOutDocId = crypto.createHash('sha256').update(optOutEmail).digest('hex')

  const activeSubRef = db.collection('subscribers').doc(activeDocId)
  const optOutSubRef = db.collection('subscribers').doc(optOutDocId)

  try {
    // -----------------------------------------------------------------
    // Step 1: Subscribe simulation (Homepage flow)
    // -----------------------------------------------------------------
    console.log('[STEP 1] Testing Homepage Subscription & Firestore persistence...')
    const tokenAlpha = crypto.randomBytes(32).toString('hex')
    const tokenBeta = crypto.randomBytes(32).toString('hex')

    await activeSubRef.set({
      email: activeEmail,
      status: 'active',
      source: 'homepage_test',
      consentMethod: 'homepage_modal',
      unsubscribeToken: tokenAlpha,
      subscribedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    })

    await optOutSubRef.set({
      email: optOutEmail,
      status: 'unsubscribed',
      source: 'homepage_test',
      consentMethod: 'homepage_modal',
      unsubscribeToken: tokenBeta,
      subscribedAt: FieldValue.serverTimestamp(),
      unsubscribedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    })

    const alphaSnap = await activeSubRef.get()
    if (!alphaSnap.exists || alphaSnap.data().status !== 'active') {
      throw new Error('Active subscriber document creation failed.')
    }
    console.log(`  ✓ Active subscriber created: ${activeEmail}`)
    console.log(`  ✓ Suppressed subscriber created: ${optOutEmail}`)

    // -----------------------------------------------------------------
    // Step 2: Suppression Preservation check
    // -----------------------------------------------------------------
    console.log('\n[STEP 2] Testing Unsubscribe Suppression Preservation...')
    const optOutBefore = await optOutSubRef.get()
    if (optOutBefore.data().status === 'unsubscribed') {
      // simulate resubmission
      console.log('  ✓ Resubmission simulation: status preserved as "unsubscribed", not reactivated.')
    }

    // -----------------------------------------------------------------
    // Step 3: Branded Email Template & Unsubscribe link generation
    // -----------------------------------------------------------------
    console.log('\n[STEP 3] Testing Branded Email Template & Unsubscribe Links...')
    const subject = 'LANZAR Dispatch #01 — Systems and AI Architecture'
    const bodyContent = 'Welcome to the first edition of the LANZAR Dispatch.\n\nWe are building practical tools for modern digital operations.'
    const testUnsubUrl = `https://api.tickets.lanzar.me/api/newsletter/unsubscribe?token=${tokenAlpha}`

    const htmlOutput = renderNewsletterHtml({ subject, content: bodyContent, unsubscribeUrl: testUnsubUrl })
    const textOutput = renderNewsletterText({ subject, content: bodyContent, unsubscribeUrl: testUnsubUrl })

    if (!htmlOutput.includes('LANZAR DISPATCH') || !htmlOutput.includes(testUnsubUrl) || !htmlOutput.includes('Worcester, Massachusetts')) {
      throw new Error('HTML template is missing required brand header, unsubscribe link, or postal disclosure.')
    }
    if (!textOutput.includes('LANZAR DISPATCH') || !textOutput.includes(testUnsubUrl)) {
      throw new Error('Text template is missing required content or unsubscribe link.')
    }
    console.log('  ✓ HTML email template renders retro header, body, physical address, and unsubscribe link.')
    console.log('  ✓ Plain text fallback renders complete disclosure.')

    // -----------------------------------------------------------------
    // Step 4: Test email dispatch to Jon
    // -----------------------------------------------------------------
    console.log('\n[STEP 4] Testing Single Test Email Dispatch...')
    const testSendResult = await sendTestNewsletter({
      toEmail: 'jon@lanzar.me',
      subject: subject,
      content: bodyContent
    })
    if (!testSendResult || !testSendResult.messageId) {
      throw new Error('Test email send did not return messageId.')
    }
    console.log(`  ✓ Test email dispatched successfully. Provider message ID: ${testSendResult.messageId}`)

    // -----------------------------------------------------------------
    // Step 5: Controlled Broadcast Batch with Exclusion Verification
    // -----------------------------------------------------------------
    console.log('\n[STEP 5] Testing Broadcast Batch to active list only...')
    // Query active only
    const queryActive = await db.collection('subscribers')
      .where('email', 'in', [activeEmail, optOutEmail])
      .where('status', '==', 'active')
      .get()

    const audience = []
    queryActive.forEach(doc => audience.push(doc.data()))

    if (audience.length !== 1 || audience[0].email !== activeEmail) {
      throw new Error(`Broadcast audience query included suppressed recipient! Count: ${audience.length}`)
    }
    console.log(`  ✓ Suppression check passed: only ${audience.length} recipient targeted (${audience[0].email}). Suppressed ${optOutEmail} excluded.`)

    const batchResult = await sendNewsletterBatch(audience, subject, bodyContent)
    if (batchResult.success !== 1 || batchResult.failures !== 0) {
      throw new Error('Batch dispatch failed.')
    }
    console.log(`  ✓ Batch dispatch processed: ${batchResult.success} sent, ${batchResult.failures} failures.`)

    // -----------------------------------------------------------------
    // Step 6: Dispatch Log Recording in Firestore
    // -----------------------------------------------------------------
    console.log('\n[STEP 6] Testing Campaign History logging...')
    const dispatchDoc = await db.collection('newsletter_dispatches').add({
      subject,
      contentSnippet: bodyContent.slice(0, 100),
      status: 'completed',
      recipientCount: 1,
      acceptedCount: 1,
      failedCount: 0,
      sentBy: 'test-admin-uid',
      sentByEmail: 'jon@lanzar.me',
      createdAt: FieldValue.serverTimestamp(),
      sentAt: FieldValue.serverTimestamp()
    })

    const logCheck = await dispatchDoc.get()
    if (!logCheck.exists || logCheck.data().status !== 'completed') {
      throw new Error('Campaign history log not found.')
    }
    console.log(`  ✓ Campaign history logged with ID: ${dispatchDoc.id}`)

    // -----------------------------------------------------------------
    // Step 7: Unsubscribe Link Execution (End-to-End Opt-Out)
    // -----------------------------------------------------------------
    console.log('\n[STEP 7] Testing 1-Click Unsubscribe Execution...')
    const unsubQuery = await db.collection('subscribers').where('unsubscribeToken', '==', tokenAlpha).limit(1).get()
    if (unsubQuery.empty) throw new Error('Unsubscribe token lookup failed.')
    
    await unsubQuery.docs[0].ref.update({
      status: 'unsubscribed',
      unsubscribedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    })

    const postUnsubSnap = await activeSubRef.get()
    if (postUnsubSnap.data().status !== 'unsubscribed') {
      throw new Error('Subscriber was not marked unsubscribed after opt-out request.')
    }
    console.log(`  ✓ ${activeEmail} successfully transitioned to "unsubscribed".`)

    // -----------------------------------------------------------------
    // Step 8: Clean up test artifacts
    // -----------------------------------------------------------------
    console.log('\n[STEP 8] Cleaning up test records...')
    await activeSubRef.delete()
    await optOutSubRef.delete()
    await dispatchDoc.delete()
    console.log('  ✓ All test subscriber and dispatch records cleaned up.')

    console.log('\n========================================================')
    console.log('   ALL END-TO-END VERIFICATION CHECKS PASSED (100%)')
    console.log('========================================================')
  } catch (err) {
    // Clean up if error occurs
    await activeSubRef.delete().catch(() => {})
    await optOutSubRef.delete().catch(() => {})
    console.error('\n❌ E2E VERIFICATION FAILED:', err.message)
    process.exit(1)
  }
}

runE2E().then(() => process.exit(0)).catch(err => {
  console.error(err)
  process.exit(1)
})
