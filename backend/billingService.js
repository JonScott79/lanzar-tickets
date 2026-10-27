import Stripe from 'stripe'
import dotenv from 'dotenv'
import { FieldValue } from 'firebase-admin/firestore'

dotenv.config()

const stripeSecretKey = process.env.STRIPE_SECRET_KEY
export const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null

if (!stripe) {
  console.log('[STRIPE] STRIPE_SECRET_KEY is not configured. Billing running in simulation/test mode.')
}

/**
 * Server-Authoritative Commercial Service Catalog
 * Strict mapping between serviceId, commercial model, pricing, and entitlement keys.
 */
export const SERVICE_CATALOG = {
  'it_managed_monthly': {
    id: 'it_managed_monthly',
    serviceKey: 'it',
    category: 'Managed IT',
    name: 'Managed IT Support Plan',
    description: 'Proactive systems maintenance, helpdesk ticketing, and workstation security management.',
    amount: 15000, // $150.00
    currency: 'usd',
    interval: 'month',
    mode: 'subscription',
    icon: '/images/icons/it.svg'
  },
  'web_project_deposit': {
    id: 'web_project_deposit',
    serviceKey: 'web',
    category: 'Web Development',
    name: 'Web Project Retainer & Deposit',
    description: 'Initial deposit and architectural retainer for custom web development & digital systems.',
    amount: 50000, // $500.00
    currency: 'usd',
    interval: null,
    mode: 'payment',
    icon: '/images/icons/web.svg'
  },
  'threadline_sub_monthly': {
    id: 'threadline_sub_monthly',
    serviceKey: 'threadline',
    category: 'LANZAR Software',
    name: 'Threadline App License',
    description: 'Active case intelligence seat, multi-device cloud synchronization, and support updates.',
    amount: 2900, // $29.00
    currency: 'usd',
    interval: 'month',
    mode: 'subscription',
    icon: '/images/icons/threadline.svg'
  }
}

/**
 * Resolves or creates a Stripe Customer record linked to the LANZAR customer UID.
 */
export async function getOrCreateStripeCustomer({ uid, email, customerName }, db) {
  const customerRef = db.collection('customers').doc(uid)
  const customerDoc = await customerRef.get()
  const customerData = customerDoc.exists ? customerDoc.data() : {}

  if (customerData.stripeCustomerId) {
    return customerData.stripeCustomerId
  }

  let stripeCustomerId = `cus_mock_${uid.slice(0, 12)}`

  if (stripe) {
    const customer = await stripe.customers.create({
      email: email,
      name: customerName || email,
      metadata: {
        lanzarUid: uid
      }
    })
    stripeCustomerId = customer.id
  }

  await customerRef.set({
    email,
    customerName: customerName || email,
    stripeCustomerId,
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true })

  console.log(`[STRIPE] Associated customer ${uid} with Stripe Customer: ${stripeCustomerId}`)
  return stripeCustomerId
}

/**
 * Initiates an authorized Stripe Checkout Session for a defined catalog service.
 */
export async function createCheckoutSession({ uid, email, customerName, serviceId, returnUrl }, db) {
  const service = SERVICE_CATALOG[serviceId]
  if (!service) {
    throw new Error(`Invalid service offering: ${serviceId}`)
  }

  const stripeCustomerId = await getOrCreateStripeCustomer({ uid, email, customerName }, db)
  const baseUrl = returnUrl || process.env.STRIPE_BILLING_RETURN_URL || 'https://portal.lanzar.me/billing'

  if (!stripe) {
    // Simulated checkout session for environments without active Stripe secret keys
    console.log(`[STRIPE MOCK] Created simulated checkout session for ${service.name} ($${(service.amount / 100).toFixed(2)})`)
    return {
      sessionId: `cs_mock_${Date.now()}`,
      url: `${baseUrl}?session_id=cs_mock_${Date.now()}&serviceId=${serviceId}&mock_success=true`
    }
  }

  const lineItems = [
    {
      price_data: {
        currency: service.currency,
        product_data: {
          name: service.name,
          description: service.description
        },
        unit_amount: service.amount,
        ...(service.mode === 'subscription' ? { recurring: { interval: service.interval } } : {})
      },
      quantity: 1
    }
  ]

  const session = await stripe.checkout.sessions.create({
    customer: stripeCustomerId,
    mode: service.mode,
    payment_method_types: ['card'],
    line_items: lineItems,
    success_url: `${baseUrl}?session_id={CHECKOUT_SESSION_ID}&serviceId=${serviceId}&success=true`,
    cancel_url: `${baseUrl}?canceled=true`,
    metadata: {
      customerUid: uid,
      serviceId: service.id,
      serviceKey: service.serviceKey
    }
  })

  return {
    sessionId: session.id,
    url: session.url
  }
}

/**
 * Creates a Stripe Customer Portal session allowing customers to manage cards and subscriptions.
 */
export async function createBillingPortalSession({ uid, email, customerName, returnUrl }, db) {
  const stripeCustomerId = await getOrCreateStripeCustomer({ uid, email, customerName }, db)
  const baseUrl = returnUrl || process.env.STRIPE_BILLING_RETURN_URL || 'https://portal.lanzar.me/billing'

  if (!stripe || stripeCustomerId.startsWith('cus_mock_')) {
    console.log(`[STRIPE MOCK] Billing portal session requested for ${stripeCustomerId}`)
    return {
      url: `${baseUrl}?portal_mock=true`
    }
  }

  const portalSession = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: baseUrl
  })

  return {
    url: portalSession.url
  }
}

/**
 * Retrieves the customer's current billing state, active entitlements, and order history.
 */
export async function getCustomerBillingStatus(customerUid, db) {
  const customerDoc = await db.collection('customers').doc(customerUid).get()
  const customerData = customerDoc.exists ? customerDoc.data() : {}
  const activeServices = customerData.services || []

  // Fetch active subscriptions
  const subsSnap = await db.collection('subscriptions')
    .where('customerUid', '==', customerUid)
    .get()

  const subscriptions = []
  subsSnap.forEach(doc => {
    subscriptions.push({ id: doc.id, ...doc.data() })
  })

  // Fetch order history
  const ordersSnap = await db.collection('orders')
    .where('customerUid', '==', customerUid)
    .orderBy('paidAt', 'desc')
    .limit(20)
    .get()
    .catch(() => ({ forEach: () => {} })) // fallback if composite index not yet built

  const orders = []
  ordersSnap.forEach(doc => {
    orders.push({ id: doc.id, ...doc.data() })
  })

  return {
    customerUid,
    stripeCustomerId: customerData.stripeCustomerId || null,
    activeServices,
    subscriptions,
    orders,
    catalog: Object.values(SERVICE_CATALOG)
  }
}

/**
 * Grants an entitlement serviceKey to the customer record in Firestore.
 */
export async function grantCustomerEntitlement(customerUid, serviceKey, db) {
  if (!customerUid || !serviceKey) return
  const customerRef = db.collection('customers').doc(customerUid)
  await customerRef.set({
    services: FieldValue.arrayUnion(serviceKey),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true })
  console.log(`[ENTITLEMENT] Granted service "${serviceKey}" to customer ${customerUid}`)
}

/**
 * Revokes an entitlement serviceKey from the customer record in Firestore.
 */
export async function revokeCustomerEntitlement(customerUid, serviceKey, db) {
  if (!customerUid || !serviceKey) return
  const customerRef = db.collection('customers').doc(customerUid)
  await customerRef.set({
    services: FieldValue.arrayRemove(serviceKey),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true })
  console.log(`[ENTITLEMENT] Revoked service "${serviceKey}" from customer ${customerUid}`)
}

/**
 * Handles incoming verified Stripe webhook events idempotently.
 */
export async function processStripeWebhookEvent(event, db) {
  const eventId = event.id
  const eventType = event.type
  console.log(`[STRIPE WEBHOOK] Received event: ${eventType} (ID: ${eventId})`)

  // Idempotency check: verify if event was already handled
  const eventRef = db.collection('stripe_processed_events').doc(eventId)
  const eventDoc = await eventRef.get()
  if (eventDoc.exists) {
    console.log(`[STRIPE WEBHOOK] Event ${eventId} was already processed. Skipping.`)
    return { duplicate: true }
  }

  const obj = event.data?.object || {}

  switch (eventType) {
    case 'checkout.session.completed': {
      const customerUid = obj.metadata?.customerUid
      const serviceId = obj.metadata?.serviceId
      const serviceKey = obj.metadata?.serviceKey
      const stripeCustomerId = obj.customer

      if (customerUid && serviceKey) {
        await grantCustomerEntitlement(customerUid, serviceKey, db)
      }

      // Record completed order
      await db.collection('orders').doc(obj.id).set({
        id: obj.id,
        customerUid: customerUid || null,
        stripeCustomerId: stripeCustomerId || null,
        serviceId: serviceId || null,
        serviceKey: serviceKey || null,
        amountTotal: obj.amount_total,
        currency: obj.currency,
        status: 'paid',
        paymentIntentId: obj.payment_intent || null,
        subscriptionId: obj.subscription || null,
        paidAt: FieldValue.serverTimestamp()
      }, { merge: true })

      break
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const subId = obj.id
      const status = obj.status
      const stripeCustomerId = obj.customer
      const cancelAtPeriodEnd = obj.cancel_at_period_end || false

      // Find customer by stripeCustomerId
      const custQuery = await db.collection('customers').where('stripeCustomerId', '==', stripeCustomerId).limit(1).get()
      const customerUid = !custQuery.empty ? custQuery.docs[0].id : null

      // Resolve service
      const priceId = obj.items?.data?.[0]?.price?.id
      const serviceEntry = Object.values(SERVICE_CATALOG).find(s => s.id === obj.metadata?.serviceId)
      const serviceKey = serviceEntry ? serviceEntry.serviceKey : obj.metadata?.serviceKey

      if (customerUid && serviceKey) {
        if (status === 'active' || status === 'trialing') {
          await grantCustomerEntitlement(customerUid, serviceKey, db)
        } else if (['canceled', 'unpaid', 'incomplete_expired'].includes(status)) {
          await revokeCustomerEntitlement(customerUid, serviceKey, db)
        }
      }

      await db.collection('subscriptions').doc(subId).set({
        id: subId,
        stripeCustomerId,
        customerUid,
        serviceId: serviceEntry?.id || obj.metadata?.serviceId || null,
        serviceKey: serviceKey || null,
        status,
        currentPeriodStart: obj.current_period_start ? new Date(obj.current_period_start * 1000) : null,
        currentPeriodEnd: obj.current_period_end ? new Date(obj.current_period_end * 1000) : null,
        cancelAtPeriodEnd,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true })

      break
    }

    case 'customer.subscription.deleted': {
      const subId = obj.id
      const stripeCustomerId = obj.customer

      const custQuery = await db.collection('customers').where('stripeCustomerId', '==', stripeCustomerId).limit(1).get()
      const customerUid = !custQuery.empty ? custQuery.docs[0].id : null
      const serviceKey = obj.metadata?.serviceKey

      if (customerUid && serviceKey) {
        await revokeCustomerEntitlement(customerUid, serviceKey, db)
      }

      await db.collection('subscriptions').doc(subId).set({
        status: 'canceled',
        canceledAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true })

      break
    }

    default:
      console.log(`[STRIPE WEBHOOK] Unhandled event type: ${eventType}`)
  }

  // Mark event as processed
  await eventRef.set({
    eventId,
    eventType,
    processedAt: FieldValue.serverTimestamp()
  })

  return { success: true }
}
