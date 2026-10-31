import { useState, useEffect } from 'react'
import { getFirestore, collection, getDocs } from 'firebase/firestore'
import app from '../firebase/config.js'

const FALLBACK_SERVICES = [
  {
    id: 'it',
    name: 'Managed IT Support',
    description: 'Technical support, workstations, printers, Wi-Fi, and systems.',
    icon: '/images/icons/it.svg',
    ticketEligible: true,
    active: true
  },
  {
    id: 'web',
    name: 'Web Services',
    description: 'Websites, hosting, DNS, and digital platforms.',
    icon: '/images/icons/web.svg',
    ticketEligible: true,
    active: true
  },
  {
    id: 'threadline',
    name: 'Threadline App Support',
    description: 'Threadline forensic intelligence support and assistance.',
    icon: '/images/icons/threadline.svg',
    ticketEligible: true,
    active: true
  }
]

function ServiceSelector({
  selectedService,
  onSelect,
  services = [],
}) {
  const [globalServices, setGlobalServices] = useState(FALLBACK_SERVICES)

  useEffect(() => {
    const fetchServices = async () => {
      try {
        const db = getFirestore(app)
        const snap = await getDocs(collection(db, 'services'))
        if (!snap.empty) {
          const list = []
          snap.forEach(doc => {
            const data = doc.data()
            if (data.active !== false && data.ticketEligible !== false) {
              list.push({ id: doc.id, ...data })
            }
          })
          if (list.length > 0) {
            setGlobalServices(list)
            return
          }
        }
      } catch (err) {
        console.warn('Direct Firestore service load failed, falling back to API:', err)
      }

      try {
        const apiUrl = import.meta.env.VITE_API_BASE_URL ? `${import.meta.env.VITE_API_BASE_URL}/api/services` : '/api/services'
        const res = await fetch(apiUrl)
        const data = await res.json()
        if (data.success && data.services?.length > 0) {
          const list = data.services.filter(doc => doc.active && doc.ticketEligible)
          if (list.length > 0) {
            setGlobalServices(list)
          }
        }
      } catch (err) {
        console.warn('Using fallback services list')
      }
    }
    fetchServices()
  }, [])

  const effectiveServiceIds = services && services.length > 0 ? services : ['it', 'web']
  const availableServices = globalServices
    .filter(service => effectiveServiceIds.includes(service.id))
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="service-options">
      {availableServices.map((service) => (
        <button
          key={service.id}
          type="button"
          className={`service-option ${
            selectedService === service.id
              ? 'selected'
              : ''
          }`}
          onClick={() =>
            onSelect(service.id)
          }
          aria-pressed={
            selectedService === service.id
          }
        >
          {service.icon ? (
            <img
              src={service.icon}
              alt=""
              className="service-icon"
              aria-hidden="true"
            />
          ) : (
            <div className="service-icon-placeholder" style={{ width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#e2e8f0', borderRadius: '4px', fontWeight: 'bold', color: '#4a5568' }}>
              {service.name.substring(0, 1)}
            </div>
          )}

          <span className="service-divider" />

          <span className="service-label">
            {service.name}
          </span>
        </button>
      ))}
    </div>
  )
}

export default ServiceSelector
