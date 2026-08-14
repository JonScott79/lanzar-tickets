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
// Service Configuration
// ==========================

const serviceDefinitions = {
  web: {
    id: 'web',
    name: 'WEB',
    description: 'Websites and digital services.',
    icon: '/images/icons/web.svg',
  },

  it: {
    id: 'it',
    name: 'IT',
    description: 'Technical support and systems.',
    icon: '/images/icons/it.svg',
  },

  threadline: {
    id: 'threadline',
    name: 'THREADLINE',
    description: 'Threadline support and assistance.',
    icon: '/images/icons/threadline.svg',
  },
}

// ==========================
// Component
// ==========================

function ServiceSelector({
  selectedService,
  onSelect,
  services = [],
}) {
  const availableServices =
    services
      .map(
        (serviceId) =>
          serviceDefinitions[serviceId]
      )
      .filter(Boolean)

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
          <img
            src={service.icon}
            alt=""
            className="service-icon"
            aria-hidden="true"
          />

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