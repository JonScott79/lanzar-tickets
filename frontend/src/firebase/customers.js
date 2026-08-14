/*
    customers.js

    LANZAR Support Tickets customer service.

    Responsibilities

    - Connect authenticated users to LANZAR customer records
    - Retrieve customer authorization data
    - Validate active customer status
*/

import {
  doc,
  getDoc,
  getFirestore,
} from 'firebase/firestore'

import app from './config.js'

// ==========================
// Firestore
// ==========================

const db = getFirestore(app)

// ==========================
// Customer Lookup
// ==========================

export async function getCustomer(uid) {
  if (!uid) {
    return null
  }

  const customerRef = doc(
    db,
    'customers',
    uid
  )

  const customerSnapshot = await getDoc(customerRef)

  if (!customerSnapshot.exists()) {
    return null
  }

  return {
    id: customerSnapshot.id,
    ...customerSnapshot.data(),
  }
}

// ==========================
// Customer Authorization
// ==========================

export async function getAuthorizedCustomer(uid) {
  const customer = await getCustomer(uid)

  if (!customer) {
    return null
  }

  if (customer.active !== true) {
    return null
  }

  return customer
} 