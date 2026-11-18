// testTicketsSecurity.js
// Regression verification for LANZAR Tickets security & identity fixes (nova-staging)

import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '../..')

const serverSrc = fs.readFileSync(path.join(rootDir, 'backend/server.js'), 'utf8')
const rulesSrc = fs.readFileSync(path.join(rootDir, 'firestore.rules'), 'utf8')
const customersSrc = fs.readFileSync(path.join(rootDir, 'frontend/src/firebase/customers.js'), 'utf8')

console.log('=== LANZAR Tickets Security Regression Suite ===')

// 1. No req.user inside /api/admin/support/* handlers
const supportStart = serverSrc.indexOf("app.post('/api/admin/support/challenge'")
const supportEnd = serverSrc.indexOf('// =====================================', supportStart + 50)
const supportBlock = serverSrc.slice(supportStart, supportEnd)
assert(!supportBlock.includes('req.user.'), 'req.user must not be referenced inside authenticateAdmin support handlers')
assert(supportBlock.includes('req.admin.uid') && supportBlock.includes('req.admin.email'), 'req.admin must be used in support handlers')
console.log('  ✓ Admin support handlers use req.admin instead of req.user')

// 2. SUPPORT_OTP_SECRET fails closed in prod/staging
assert(!serverSrc.includes("'lanzar_support_caller_otp_secret_key_2026'"), 'Hardcoded production OTP secret fallback must be removed')
console.log('  ✓ SUPPORT_OTP_SECRET hardcoded prod fallback removed')

// 3. Stripe webhook fails closed if STRIPE_WEBHOOK_SECRET is unset in prod/staging
assert(serverSrc.includes('Stripe webhook signing secret is not configured.'), 'Stripe webhook must fail closed when secret is missing in prod/staging')
console.log('  ✓ Stripe webhook rejects unsigned payloads in prod/staging')

// 4. Claimed & inquiry tickets set authUid & customerId
assert(serverSrc.includes('authUid: req.user.uid') && serverSrc.includes('customerId: req.user.uid'), 'Claimed tickets must populate authUid and customerId')
console.log('  ✓ Claimed tickets populate authUid & customerId for firestore.rules')

// 5. firestore.rules validates active user and accountId on ticket create
assert(rulesSrc.includes('belongsToAccount(request.resource.data.accountId)'), 'firestore.rules must validate accountId on ticket create')
assert(rulesSrc.includes("get(/databases/$(database)/documents/users/$(request.auth.uid)).data.active == true"), 'firestore.rules must require active user')
console.log('  ✓ firestore.rules validates active user and accountId')

// 6. Frontend customers.js does not auto-provision in-memory { active: true }
assert(!customersSrc.includes('Auto-provision initial customer profile'), 'Frontend must not auto-provision active customer profiles')
console.log('  ✓ Frontend customers.js auto-provisioning bypass removed')

console.log('ALL 6 TICKETS SECURITY REGRESSION CHECKS PASSED.')
