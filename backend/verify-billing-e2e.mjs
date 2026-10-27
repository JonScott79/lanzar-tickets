import { cert, initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import fs from 'node:fs'
import {
  SERVICE_CATALOG,
  getOrCreateStripeCustomer,
  createCheckoutSession,
  createBillingPortalSession,
  getCustomerBillingStatus,
  processStripeWebhookEvent
} from './billingService.js'

const credentialPath = 'C:\\Projects\\LANZAR\\firebase-credentials\\lanzar-95ae3-firebase-adminsdk-fbsvc-86e8ea5817.json'
const serviceAccount = JSON.parse(fs.readFileSync(credentialPath, 'utf8'))

const app = getApps().length > 0 ? getApps()[0] : initializeApp({ credential: cert(serviceAccount) })
const db = getFirestore(app)

async function runBillingTests() {
  console.log('========================================================')
  console.log('   LANZAR Billing & Stripe Integration Test Battery')
  console.log('========================================================\n')

  const testUid = `test_customer_${Date.now()}`
  const testEmail = `${testUid}@lanzar.me`
  const testName = 'Test Enterprise Cadet'

  try {
    // -----------------------------------------------------------------
    // 1. Service Catalog Integrity
    // -----------------------------------------------------------------
    console.log('[STEP 1] Validating Service Catalog & Commercial Pricing Models...')
    const catalogEntries = Object.values(SERVICE_CATALOG)
    if (catalogEntries.length < 3) throw new Error('Catalog has fewer than 3 services.')
    
    for (const item of catalogEntries) {
      if (!item.id || !item.serviceKey || !item.amount || !item.mode) {
        throw new Error(`Incomplete catalog entry: ${item.id}`)
      }
      console.log(`  ✓ ${item.name} ($${(item.amount / 100).toFixed(2)}) — Mode: ${item.mode}`)
    }

    // -----------------------------------------------------------------
    // 2. Stripe Customer Mapping
    // -----------------------------------------------------------------
    console.log('\n[STEP 2] Testing Customer & Stripe Reference Mapping in Firestore...')
    const stripeCustId = await getOrCreateStripeCustomer({
      uid: testUid,
      email: testEmail,
      customerName: testName
    }, db)

    if (!stripeCustId) throw new Error('Failed to resolve or create Stripe customer ID.')
    console.log(`  ✓ Customer mapped with ID: ${stripeCustId}`)

    const custDoc = await db.collection('customers').doc(testUid).get()
    if (!custDoc.exists || custDoc.data().stripeCustomerId !== stripeCustId) {
      throw new Error('Customer document was not properly initialized in Firestore.')
    }
    console.log('  ✓ Firestore customer document verified.')

    // -----------------------------------------------------------------
    // 3. Checkout Session Creation (Subscription & One-Time)
    // -----------------------------------------------------------------
    console.log('\n[STEP 3] Testing Checkout Session Creation...')
    const subSession = await createCheckoutSession({
      uid: testUid,
      email: testEmail,
      customerName: testName,
      serviceId: 'it_managed_monthly'
    }, db)
    if (!subSession.url) throw new Error('Subscription checkout session returned no URL.')
    console.log('  ✓ Managed IT subscription checkout session generated.')

    const oneTimeSession = await createCheckoutSession({
      uid: testUid,
      email: testEmail,
      customerName: testName,
      serviceId: 'web_project_deposit'
    }, db)
    if (!oneTimeSession.url) throw new Error('One-time checkout session returned no URL.')
    console.log('  ✓ Web Development retainer checkout session generated.')

    // -----------------------------------------------------------------
    // 4. Webhook Processing: checkout.session.completed (Entitlement Grant)
    // -----------------------------------------------------------------
    console.log('\n[STEP 4] Testing Webhook: checkout.session.completed...')
    const mockCompletedEvent = {
      id: `evt_test_${Date.now()}`,
      type: 'checkout.session.completed',
      data: {
        object: {
          id: `cs_test_${Date.now()}`,
          customer: stripeCustId,
          amount_total: 15000,
          currency: 'usd',
          metadata: {
            customerUid: testUid,
            serviceId: 'it_managed_monthly',
            serviceKey: 'it'
          }
        }
      }
    }

    await processStripeWebhookEvent(mockCompletedEvent, db)

    const updatedCust = await db.collection('customers').doc(testUid).get()
    const services = updatedCust.data().services || []
    if (!services.includes('it')) {
      throw new Error('Entitlement "it" was not granted to customer after checkout completion.')
    }
    console.log(`  ✓ Entitlement granted: services = [${services.join(', ')}]`)

    // -----------------------------------------------------------------
    // 5. Idempotent Event Deduplication
    // -----------------------------------------------------------------
    console.log('\n[STEP 5] Testing Webhook Deduplication / Idempotency...')
    const dupResult = await processStripeWebhookEvent(mockCompletedEvent, db)
    if (!dupResult.duplicate) {
      throw new Error('Duplicate webhook event was processed again instead of being skipped!')
    }
    console.log('  ✓ Duplicate event detected and safely bypassed.')

    // -----------------------------------------------------------------
    // 6. Webhook Processing: customer.subscription.deleted (Entitlement Revocation)
    // -----------------------------------------------------------------
    console.log('\n[STEP 6] Testing Webhook: customer.subscription.deleted (Revocation)...')
    const mockCanceledEvent = {
      id: `evt_cancel_${Date.now()}`,
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: `sub_test_${Date.now()}`,
          customer: stripeCustId,
          metadata: {
            serviceKey: 'it'
          }
        }
      }
    }

    await processStripeWebhookEvent(mockCanceledEvent, db)
    const postCancelCust = await db.collection('customers').doc(testUid).get()
    const postServices = postCancelCust.data().services || []
    if (postServices.includes('it')) {
      throw new Error('Entitlement "it" was not revoked after subscription cancellation.')
    }
    console.log(`  ✓ Entitlement revoked upon cancellation: services = [${postServices.join(', ')}]`)

    // -----------------------------------------------------------------
    // 7. Customer Billing Status Retrieval
    // -----------------------------------------------------------------
    console.log('\n[STEP 7] Testing Customer Billing Status View query...')
    const statusResult = await getCustomerBillingStatus(testUid, db)
    if (!statusResult.catalog || statusResult.catalog.length < 3) {
      throw new Error('Customer status query failed to return catalog.')
    }
    console.log('  ✓ Customer billing status view verified.')

    // -----------------------------------------------------------------
    // 8. Clean up test records
    // -----------------------------------------------------------------
    console.log('\n[STEP 8] Cleaning up test records from Firestore...')
    await db.collection('customers').doc(testUid).delete()
    await db.collection('orders').doc(mockCompletedEvent.data.object.id).delete()
    await db.collection('stripe_processed_events').doc(mockCompletedEvent.id).delete()
    await db.collection('stripe_processed_events').doc(mockCanceledEvent.id).delete()
    console.log('  ✓ Test customer and event audit records cleaned up.')

    console.log('\n========================================================')
    console.log('   ALL BILLING & STRIPE INTEGRATION TESTS PASSED (100%)')
    console.log('========================================================')
  } catch (err) {
    console.error('\n❌ BILLING TEST FAILED:', err.message)
    // Clean up on failure
    await db.collection('customers').doc(testUid).delete().catch(() => {})
    process.exit(1)
  }
}

runBillingTests().then(() => process.exit(0)).catch(err => {
  console.error(err)
  process.exit(1)
})
