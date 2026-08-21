import { useState, useEffect } from 'react'
import { getFirestore, collection, getDocs } from 'firebase/firestore'
import app from '../firebase/config.js'

/*
    ServiceSelector.jsx

    LANZAR Support Tickets service selection component.

    Responsibilities

    - Display available LANZAR services
    - Display service-specific icons
    - Track the selected service
    - Provide a reusable service selection interface
*/

// ==========================
// Component
// ==========================

function ServiceSelector({
  selectedService,
  onSelect,
  services = [], // This is the array of service string IDs the user is authorized for
}) {
  const [globalServices, setGlobalServices] = useState([])

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
          setGlobalServices(list)
          return
        }
      } catch (err) {
        console.warn('Direct Firestore service load failed, falling back to API:', err)
      }

      try {
        const apiUrl = import.meta.env.VITE_API_BASE_URL ? `${import.meta.env.VITE_API_BASE_URL}/api/services` : '/api/services'
        const res = await fetch(apiUrl)
        const data = await res.json()
        if (data.success) {
          const list = data.services.filter(doc => doc.active && doc.ticketEligible)
          setGlobalServices(list)
        }
      } catch (err) {
        console.error('Failed to load global services', err)
      }
    }
    fetchServices()
  }, [])

  const availableServices = globalServices
    .filter(service => services.includes(service.id))
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

          <span className="service-content">
            <span className="service-name">
              {service.name}
            </span>

            <span className="service-description">
              {service.description}
            </span>
          </span>
        </button>
      ))}
    </div>
  )
}

export default ServiceSelector