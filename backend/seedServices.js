import dotenv from 'dotenv'
import { cert, initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import fs from 'node:fs'

dotenv.config()

let serviceAccount = null
const credentialPath = 'C:\\Projects\\LANZAR\\firebase-credentials\\lanzar-95ae3-firebase-adminsdk-fbsvc-86e8ea5817.json'
if (fs.existsSync(credentialPath)) {
  serviceAccount = JSON.parse(fs.readFileSync(credentialPath, 'utf8'))
}

const adminApp = getApps().length > 0 ? getApps()[0] : initializeApp({ credential: cert(serviceAccount) })
const db = getFirestore(adminApp)

const INITIAL_SERVICES = [
  {
    id: 'it',
    name: 'Managed IT Support',
    description: 'Technical support and systems.',
    icon: '/images/icons/it.svg',
    ticketEligible: true,
    active: true
  },
  {
    id: 'network',
    name: 'Network Administration',
    description: 'Network management and support.',
    icon: null,
    ticketEligible: false,
    active: true
  },
  {
    id: 'server',
    name: 'Server Monitoring',
    description: 'Server uptime and maintenance.',
    icon: null,
    ticketEligible: false,
    active: true
  },
  {
    id: 'web',
    name: 'Web Services',
    description: 'Websites and digital services.',
    icon: '/images/icons/web.svg',
    ticketEligible: true,
    active: true
  },
  {
    id: 'threadline',
    name: 'Threadline App Support',
    description: 'Threadline support and assistance.',
    icon: '/images/icons/threadline.svg',
    ticketEligible: true,
    active: true
  }
]

async function seed() {
  const batch = db.batch()
  for (const svc of INITIAL_SERVICES) {
    const ref = db.collection('services').doc(svc.id)
    batch.set(ref, svc, { merge: true })
  }
  await batch.commit()
  console.log('Services seeded successfully.')
  process.exit(0)
}

seed().catch(err => {
  console.error(err)
  process.exit(1)
})
