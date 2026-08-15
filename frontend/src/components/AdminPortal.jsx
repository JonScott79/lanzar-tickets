/*
    AdminPortal.jsx

    LANZAR Support Tickets administrator portal.

    Responsibilities

    - Synchronize ticket queue from Firestore in real-time
    - Filter and group tickets by status (PENDING, APPROVED, MORE_INFO)
    - Render ticket detail panel with customer info and histories
    - Process ticket approval updates
    - Process customer clarification requests with required explanation
    - Coordinate Stella's status feedback to the parent application shell
*/

// ==========================
// React
// ==========================

import { useState, useEffect } from 'react'

// ==========================
// Firestore
// ==========================

import {
  getFirestore,
  collection,
  query,
  orderBy,
  onSnapshot,
  doc,
  updateDoc,
  arrayUnion,
  setDoc,
  deleteDoc,
} from 'firebase/firestore'

import app from '../firebase/config.js'
import { auth, sendPasswordReset } from '../firebase/auth.js'

// ==========================
// Component
// ==========================

const db = getFirestore(app)
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || ''

function AdminPortal({
  onTicketSelect,
  selectedTicket,
}) {
  const [tickets, setTickets] = useState([])
  const [activeTab, setActiveTab] = useState('PENDING')
  const [moreInfoText, setMoreInfoText] = useState('')
  const [isRequestingMoreInfo, setIsRequestingMoreInfo] = useState(false)
  const [isConfirmingResolve, setIsConfirmingResolve] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  // ========================================================
  // Real-Time Ticket Sync
  // ========================================================

  useEffect(() => {
    const q = query(
      collection(db, 'tickets'),
      orderBy('createdAt', 'desc')
    )

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list = []
        snapshot.forEach((docSnap) => {
          list.push({
            id: docSnap.id,
            ...docSnap.data(),
          })
        })
        setTickets(list)

        // Keep the selected ticket data in sync if it gets updated
        if (selectedTicket) {
          const updatedSelected = list.find(
            (t) => t.id === selectedTicket.id
          )
          if (updatedSelected) {
            onTicketSelect(updatedSelected)
          }
        }
      },
      (err) => {
        console.error('Error fetching tickets:', err)
        setError('Could not connect to the ticket database.')
      }
    )

    return () => unsubscribe()
  }, [selectedTicket, onTicketSelect])

  // ========================================================
  // Customer Management State
  // ========================================================

  const [customers, setCustomers] = useState([])
  const [custName, setCustName] = useState('')
  const [custEmail, setCustEmail] = useState('')
  const [custPassword, setCustPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [custServices, setCustServices] = useState({
    it: false,
    web: false,
    threadline: false,
  })
  const [customerError, setCustomerError] = useState('')
  const [customerSuccess, setCustomerSuccess] = useState('')

  // ========================================================
  // Real-Time Customer Sync
  // ========================================================

  useEffect(() => {
    if (activeTab !== 'customers') return

    const q = query(
      collection(db, 'customers'),
      orderBy('customerName', 'asc')
    )

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list = []
        snapshot.forEach((docSnap) => {
          list.push({
            id: docSnap.id,
            ...docSnap.data(),
          })
        })
        setCustomers(list)
      },
      (err) => {
        console.error('Error fetching customers:', err)
        setCustomerError('Could not load customer list.')
      }
    )

    return () => unsubscribe()
  }, [activeTab])

  // ========================================================
  // Customer Actions
  // ========================================================

  const handleCustomerSubmit = async (e) => {
    e.preventDefault()
    setCustomerError('')
    setCustomerSuccess('')

    if (!custName.trim()) {
      setCustomerError('Customer Name is required.')
      return
    }
    if (!custEmail.trim()) {
      setCustomerError('Customer Email is required.')
      return
    }
    if (!custPassword || custPassword.length < 6) {
      setCustomerError('Password must be at least 6 characters.')
      return
    }

    const servicesArray = Object.keys(custServices).filter(
      (key) => custServices[key]
    )

    if (servicesArray.length === 0) {
      setCustomerError('At least one authorized service must be selected.')
      return
    }

    setIsLoading(true)
    try {
      const idToken = await auth.currentUser.getIdToken()
      const response = await fetch(`${API_BASE_URL}/api/customers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({
          name: custName.trim(),
          email: custEmail.trim(),
          password: custPassword,
          services: servicesArray,
        })
      })

      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to register customer.')
      }

      setCustomerSuccess(`Customer "${custName.trim()}" registered successfully with credentials.`)
      setCustName('')
      setCustEmail('')
      setCustPassword('')
      setCustServices({
        it: false,
        web: false,
        threadline: false,
      })
    } catch (err) {
      console.error('Error registering customer:', err)
      setCustomerError(err.message)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSendPasswordReset = async (email, name) => {
    if (!email) return
    setCustomerError('')
    setCustomerSuccess('')
    setIsLoading(true)
    try {
      await sendPasswordReset(email)
      setCustomerSuccess(`Password reset email sent to customer "${name}" successfully.`)
    } catch (err) {
      console.error('Error sending password reset:', err)
      setCustomerError('Failed to send password reset: ' + err.message)
    } finally {
      setIsLoading(false)
    }
  }

  const handleCustomerDelete = async (uid, name) => {
    if (
      !window.confirm(
        `Are you sure you want to revoke access for customer "${name}"?`
      )
    ) {
      return
    }
    setCustomerError('')
    setCustomerSuccess('')
    setIsLoading(true)
    try {
      await deleteDoc(doc(db, 'customers', uid))
      setCustomerSuccess(`Access revoked for customer "${name}".`)
    } catch (err) {
      console.error('Error deleting customer:', err)
      setCustomerError('Failed to revoke access: ' + err.message)
    } finally {
      setIsLoading(false)
    }
  }

  // ========================================================
  // Helpers
  // ========================================================

  const formatDate = (timestamp) => {
    if (!timestamp) return ''
    const date = timestamp.toDate
      ? timestamp.toDate()
      : new Date(timestamp)
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
  }

  const getServiceLabel = (serviceId) => {
    switch (serviceId) {
      case 'it':
        return 'IT SUPPORT'
      case 'web':
        return 'WEB SUPPORT'
      case 'threadline':
        return 'THREADLINE SUPPORT'
      default:
        return serviceId?.toUpperCase() || ''
    }
  }

  // ========================================================
  // Actions
  // ========================================================

  const handleApprove = async (ticket) => {
    setIsLoading(true)
    setError('')

    try {
      const ticketRef = doc(
        db,
        'tickets',
        ticket.id
      )

      const currentUser = auth.currentUser

      const historyEntry = {
        status: 'APPROVED',
        timestamp: new Date().toISOString(),
        adminId: currentUser?.uid || 'system',
        adminEmail:
          currentUser?.email || 'admin@lanzar.me',
      }

      await updateDoc(ticketRef, {
        status: 'APPROVED',
        updatedAt: new Date(),
        adminId: currentUser?.uid || 'system',
        adminEmail:
          currentUser?.email || 'admin@lanzar.me',
        history: arrayUnion(historyEntry),
      })
    } catch (err) {
      console.error('Approval failed:', err)
      setError('Failed to approve the ticket. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleSetStatus = async (ticket, newStatus) => {
    setIsLoading(true)
    setError('')

    try {
      const ticketRef = doc(db, 'tickets', ticket.id)
      const currentUser = auth.currentUser

      const historyEntry = {
        status: newStatus,
        timestamp: new Date().toISOString(),
        adminId: currentUser?.uid || 'system',
        adminUid: currentUser?.uid || 'system',
        adminEmail: currentUser?.email || 'admin@lanzar.me',
        message: `Status manually updated to ${newStatus}.`,
        type: 'ADMIN',
        action: newStatus,
      }

      const updates = {
        status: newStatus,
        updatedAt: new Date(),
        history: arrayUnion(historyEntry),
      }

      if (newStatus === 'RESOLVED') {
        updates.resolvedAt = new Date()
        updates.resolvedBy = currentUser?.uid || 'system'
      }

      await updateDoc(ticketRef, updates)
    } catch (err) {
      console.error(`Failed to update status to ${newStatus}:`, err)
      setError(`Failed to update ticket status to ${newStatus}.`)
    } finally {
      setIsLoading(false)
    }
  }

  const handleRequestMoreInfo = async (ticket) => {
    setIsLoading(true)
    setError('')
    try {
      const ticketRef = doc(db, 'tickets', ticket.id)
      const currentUser = auth.currentUser

      const historyEntry = {
        status: 'MORE_INFO',
        timestamp: new Date().toISOString(),
        adminId: currentUser?.uid || 'system',
        adminUid: currentUser?.uid || 'system',
        adminEmail: currentUser?.email || 'admin@lanzar.me',
        message: 'Requested more information from customer.',
        type: 'ADMIN',
        action: 'MORE_INFO',
      }

      await updateDoc(ticketRef, {
        status: 'MORE_INFO',
        updatedAt: new Date(),
        history: arrayUnion(historyEntry),
      })

      // Open local mail client
      window.location.href = `mailto:${ticket.customerEmail}?subject=LANZAR%20Support%20Ticket%20%23${ticket.ticketNumber || ticket.id}`
    } catch (err) {
      console.error('Failed to request more info:', err)
      setError('Failed to update status.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleResolve = async (ticket) => {
    setIsLoading(true)
    setError('')

    try {
      const ticketRef = doc(
        db,
        'tickets',
        ticket.id
      )

      const currentUser = auth.currentUser

      const historyEntry = {
        status: 'RESOLVED',
        timestamp: new Date().toISOString(),
        adminId: currentUser?.uid || 'system',
        adminUid: currentUser?.uid || 'system',
        adminEmail: currentUser?.email || 'admin@lanzar.me',
        message: 'Ticket resolved.',
        type: 'ADMIN',
        action: 'RESOLVED',
      }

      await updateDoc(ticketRef, {
        status: 'RESOLVED',
        updatedAt: new Date(),
        resolvedAt: new Date(),
        resolvedBy: currentUser?.uid || 'system',
        history: arrayUnion(historyEntry),
      })

      setIsConfirmingResolve(false)
    } catch (err) {
      console.error('Resolution failed:', err)
      setError('Failed to resolve the ticket. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  // ========================================================
  // Filtering
  // ========================================================

  const pendingCount = tickets.filter(
    (t) => t.status === 'PENDING' || t.status === 'CUSTOMER_RESPONDED'
  ).length

  const approvedCount = tickets.filter(
    (t) => t.status === 'APPROVED'
  ).length

  const moreInfoCount = tickets.filter(
    (t) => t.status === 'MORE_INFO'
  ).length

  const resolvedCount = tickets.filter(
    (t) => t.status === 'RESOLVED'
  ).length

  const filteredTickets = tickets.filter((t) => {
    if (activeTab === 'PENDING') {
      return t.status === 'PENDING' || t.status === 'CUSTOMER_RESPONDED'
    }
    return t.status === activeTab
  })

  // ========================================================
  // Detail View Render
  // ========================================================

  if (selectedTicket) {
    return (
      <div className="admin-detail-view" id="admin-detail-view">
        <div className="admin-detail-header">
          <button
            type="button"
            className="admin-back-button"
            onClick={() => onTicketSelect(null)}
          >
            ← BACK TO QUEUE
          </button>

          <span
            className={`admin-status-badge status-${selectedTicket.status.toLowerCase()}`}
          >
            {selectedTicket.status.replace('_', ' ')}
          </span>
        </div>

        <div className="admin-detail-body">
          <h2 className="admin-ticket-title">
            Ticket: #{selectedTicket.ticketNumber}
          </h2>

          <div className="admin-meta-grid">
            <div className="admin-meta-item">
              <span className="admin-meta-label">
                CUSTOMER
              </span>

              <strong>
                {selectedTicket.customerName}
              </strong>
            </div>

            <div className="admin-meta-item">
              <span className="admin-meta-label">
                CUSTOMER EMAIL
              </span>

              <strong>
                {selectedTicket.customerEmail}
              </strong>
            </div>

            <div className="admin-meta-item">
              <span className="admin-meta-label">
                AUTHENTICATED AS
              </span>

              <span className="admin-meta-value">
                {selectedTicket.authEmail}
              </span>
            </div>

            <div className="admin-meta-item">
              <span className="admin-meta-label">
                SERVICE / DEPT
              </span>

              <strong>
                {getServiceLabel(
                  selectedTicket.service
                )}
              </strong>
            </div>

            <div className="admin-meta-item">
              <span className="admin-meta-label">
                PROBLEM CATEGORY
              </span>

              <strong>
                {selectedTicket.category}
              </strong>
            </div>

            <div className="admin-meta-item">
              <span className="admin-meta-label">
                SUBMITTED AT
              </span>

              <span className="admin-meta-value">
                {formatDate(
                  selectedTicket.createdAt
                )}
              </span>
            </div>
          </div>

          <div className="admin-detail-section">
            <span className="admin-meta-label">
              PROBLEM DESCRIPTION
            </span>

            <p className="admin-full-description">
              {selectedTicket.description}
            </p>
          </div>

          {selectedTicket.status === 'MORE_INFO' &&
            selectedTicket.adminMessage && (
              <div className="admin-detail-section message-block">
                <span className="admin-meta-label info-label">
                  CLARIFICATION REQUESTED
                </span>

                <p className="admin-message-text">
                  "{selectedTicket.adminMessage}"
                </p>
              </div>
            )}

          {/* History log display */}
          {selectedTicket.history &&
            selectedTicket.history.length > 0 && (
              <div className="admin-detail-section history-section">
                <span className="admin-meta-label">
                  TICKET HISTORY
                </span>

                <ul className="admin-history-list">
                  {selectedTicket.history.map(
                    (entry, idx) => (
                      <li
                        key={idx}
                        className="admin-history-item"
                      >
                        <span className="history-bullet" />

                        <div className="history-details">
                          <strong>
                            {entry.status}
                          </strong>{' '}
                          by {entry.adminEmail || entry.customerEmail || entry.unverifiedSender || 'System'}
                          <span className="history-time">
                            {formatDate(
                              entry.timestamp
                            )}
                          </span>
                          {entry.message && (
                            <p className="history-entry-msg">
                              "{entry.message}"
                            </p>
                          )}
                        </div>
                      </li>
                    )
                  )}
                </ul>
              </div>
            )}

          {error && (
            <p className="admin-error-text">
              {error}
            </p>
          )}

          {selectedTicket.status !== 'RESOLVED' && (
            <div className="admin-actions">
              {!isConfirmingResolve ? (
                <>
                  <a
                    href={`mailto:${selectedTicket.customerEmail}?subject=LANZAR%20Support%20Ticket%20%23${selectedTicket.ticketNumber || selectedTicket.id}`}
                    className="admin-btn-more-info"
                    style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    EMAIL CUSTOMER
                  </a>

                  {(selectedTicket.status === 'PENDING' || selectedTicket.status === 'CUSTOMER_RESPONDED') && (
                    <button
                      type="button"
                      className="admin-btn-approve"
                      onClick={() => handleApprove(selectedTicket)}
                      disabled={isLoading}
                    >
                      {isLoading ? 'PROCESSING...' : 'APPROVE'}
                    </button>
                  )}

                  {(selectedTicket.status === 'PENDING' || selectedTicket.status === 'CUSTOMER_RESPONDED' || selectedTicket.status === 'APPROVED') && (
                    <button
                      type="button"
                      className="admin-btn-more-info"
                      onClick={() => handleRequestMoreInfo(selectedTicket)}
                      disabled={isLoading}
                    >
                      REQUEST MORE INFO
                    </button>
                  )}

                  {selectedTicket.status === 'MORE_INFO' && (
                    <>
                      <button
                        type="button"
                        className="admin-btn-approve"
                        onClick={() => handleSetStatus(selectedTicket, 'CUSTOMER_RESPONDED')}
                        disabled={isLoading}
                      >
                        MARK RESPONDED
                      </button>
                      <button
                        type="button"
                        className="admin-btn-cancel"
                        style={{ borderColor: 'var(--border-medium)', background: 'transparent', color: 'var(--text-light)', minHeight: '44px', padding: '10px 24px', borderRadius: 'var(--radius-pill)', fontWeight: '700', fontSize: '0.85rem', cursor: 'pointer' }}
                        onClick={() => handleSetStatus(selectedTicket, 'PENDING')}
                        disabled={isLoading}
                      >
                        SET TO PENDING
                      </button>
                    </>
                  )}

                  <button
                    type="button"
                    className="admin-btn-resolve"
                    onClick={() => setIsConfirmingResolve(true)}
                    disabled={isLoading}
                  >
                    RESOLVE TICKET
                  </button>
                </>
              ) : (
                <div className="admin-more-info-form" style={{ borderColor: 'var(--soft-gray)' }}>
                  <label className="admin-meta-label">
                    RESOLVE THIS TICKET?
                  </label>
                  <div className="admin-form-actions">
                    <button
                      type="button"
                      className="admin-btn-cancel"
                      onClick={() => setIsConfirmingResolve(false)}
                      disabled={isLoading}
                    >
                      CANCEL
                    </button>
                    <button
                      type="button"
                      className="admin-btn-submit-info"
                      style={{ backgroundColor: 'var(--soft-gray)', borderColor: 'var(--soft-gray)', color: 'var(--text-light)' }}
                      onClick={() => handleResolve(selectedTicket)}
                      disabled={isLoading}
                    >
                      {isLoading ? 'RESOLVING...' : 'RESOLVE TICKET'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ========================================================
  // Queue List Render
  // ========================================================

  return (
    <div className="admin-queue-view">
      <div className="admin-queue-header">
        <h2 className="admin-panel-title">
          SUPPORT REQUEST QUEUE
        </h2>

        {error && (
          <p className="admin-error-text">
            {error}
          </p>
        )}
      </div>

      {/* Tabs */}
      <nav
        className="admin-tabs"
        aria-label="Ticket status filters"
      >
        <button
          type="button"
          className={`admin-tab ${
            activeTab === 'PENDING'
              ? 'active'
              : ''
          }`}
          onClick={() => {
            setActiveTab('PENDING')
            setError('')
          }}
          aria-current={
            activeTab === 'PENDING'
              ? 'page'
              : undefined
          }
        >
          PENDING
          <span className="tab-badge badge-pending">
            {pendingCount}
          </span>
        </button>

        <button
          type="button"
          className={`admin-tab ${
            activeTab === 'APPROVED'
              ? 'active'
              : ''
          }`}
          onClick={() => {
            setActiveTab('APPROVED')
            setError('')
          }}
          aria-current={
            activeTab === 'APPROVED'
              ? 'page'
              : undefined
          }
        >
          APPROVED
          <span className="tab-badge badge-approved">
            {approvedCount}
          </span>
        </button>

        <button
          type="button"
          className={`admin-tab ${
            activeTab === 'MORE_INFO'
              ? 'active'
              : ''
          }`}
          onClick={() => {
            setActiveTab('MORE_INFO')
            setError('')
          }}
          aria-current={
            activeTab === 'MORE_INFO'
              ? 'page'
              : undefined
          }
        >
          MORE INFO
          <span className="tab-badge badge-more-info">
            {moreInfoCount}
          </span>
        </button>

        <button
          type="button"
          className={`admin-tab ${
            activeTab === 'RESOLVED'
              ? 'active'
              : ''
          }`}
          onClick={() => {
            setActiveTab('RESOLVED')
            setError('')
          }}
          aria-current={
            activeTab === 'RESOLVED'
              ? 'page'
              : undefined
          }
        >
          RESOLVED
          <span className="tab-badge badge-resolved">
            {resolvedCount}
          </span>
        </button>

        <button
          type="button"
          className={`admin-tab ${
            activeTab === 'customers'
              ? 'active'
              : ''
          }`}
          onClick={() => {
            setActiveTab('customers')
            setError('')
          }}
          aria-current={
            activeTab === 'customers'
              ? 'page'
              : undefined
          }
        >
          CUSTOMERS
        </button>
      </nav>

      {activeTab === 'customers' ? (
        <div className="admin-customers-panel">
          <form className="admin-customer-form" onSubmit={handleCustomerSubmit}>
            <h3 className="admin-form-section-title">✦ REGISTER NEW CUSTOMER ✦</h3>
            
            {customerError && (
              <p className="admin-error-text" style={{ marginBottom: '14px' }}>
                {customerError}
              </p>
            )}
            {customerSuccess && (
              <p className="admin-success-text" style={{ marginBottom: '14px', color: 'var(--retro-teal)', fontFamily: 'var(--font-code)', fontSize: '0.78rem', fontWeight: 700 }}>
                {customerSuccess}
              </p>
            )}

            <div className="admin-form-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '16px' }}>
              <div className="admin-input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label className="admin-meta-label">FULL NAME</label>
                <input
                  type="text"
                  className="admin-more-info-textarea"
                  style={{ resize: 'none', height: '42px', padding: '10px' }}
                  value={custName}
                  onChange={(e) => setCustName(e.target.value)}
                  placeholder="e.g. Jon Scott"
                  disabled={isLoading}
                  required
                />
              </div>

              <div className="admin-input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label className="admin-meta-label">EMAIL ADDRESS</label>
                <input
                  type="email"
                  className="admin-more-info-textarea"
                  style={{ resize: 'none', height: '42px', padding: '10px' }}
                  value={custEmail}
                  onChange={(e) => setCustEmail(e.target.value)}
                  placeholder="e.g. jon@lanzar.me"
                  disabled={isLoading}
                  required
                />
              </div>

              <div className="admin-input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label className="admin-meta-label">INITIAL PASSWORD</label>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <input
                    type={showPassword ? "text" : "password"}
                    className="admin-more-info-textarea"
                    style={{ resize: 'none', height: '42px', padding: '10px', width: '100%', paddingRight: '50px' }}
                    value={custPassword}
                    onChange={(e) => setCustPassword(e.target.value)}
                    placeholder="At least 6 chars"
                    disabled={isLoading}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    style={{
                      position: 'absolute',
                      right: '10px',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      fontFamily: 'var(--font-code)',
                      fontSize: '0.7rem',
                      fontWeight: 'bold',
                      color: 'var(--retro-teal)',
                      padding: 0
                    }}
                  >
                    {showPassword ? 'HIDE' : 'SHOW'}
                  </button>
                </div>
              </div>
            </div>

            <div className="admin-services-checkboxes" style={{ marginBottom: '20px' }}>
              <label className="admin-meta-label" style={{ display: 'block', marginBottom: '8px' }}>AUTHORIZED SERVICES</label>
              <div className="admin-checkbox-row" style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                <label className="admin-card-customer" style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={custServices.it}
                    onChange={(e) => setCustServices({ ...custServices, it: e.target.checked })}
                    disabled={isLoading}
                    style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                  />
                  IT Support (it)
                </label>
                <label className="admin-card-customer" style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={custServices.web}
                    onChange={(e) => setCustServices({ ...custServices, web: e.target.checked })}
                    disabled={isLoading}
                    style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                  />
                  Web Services (web)
                </label>
                <label className="admin-card-customer" style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={custServices.threadline}
                    onChange={(e) => setCustServices({ ...custServices, threadline: e.target.checked })}
                    disabled={isLoading}
                    style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                  />
                  Threadline Ops (threadline)
                </label>
              </div>
            </div>

            <button type="submit" className="admin-btn-approve" disabled={isLoading}>
              {isLoading ? 'REGISTERING...' : 'REGISTER CUSTOMER ✦'}
            </button>
          </form>

          <div className="admin-customers-list-section" style={{ marginTop: '24px' }}>
            <h3 className="admin-form-section-title" style={{ marginBottom: '14px' }}>✦ REGISTERED CUSTOMERS ✦</h3>
            <div className="admin-ticket-list" style={{ maxHeight: '380px' }}>
              {customers.length === 0 ? (
                <p className="admin-no-tickets">No customers registered.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {customers.map((c) => (
                    <article key={c.id} className="admin-ticket-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', padding: '14px 18px' }}>
                      <div style={{ flex: '1 1 auto', minWidth: '200px' }}>
                        <h4 style={{ margin: '0 0 4px 0', fontFamily: 'var(--font-heading)', fontSize: '1.05rem', color: 'var(--deep-navy)' }}>
                          {c.customerName}
                        </h4>
                        <p style={{ margin: '0 0 6px 0', fontSize: '0.8rem', color: 'var(--soft-gray)' }}>
                          {c.customerEmail}
                        </p>
                        <p style={{ margin: '0', fontSize: '0.72rem', fontFamily: 'var(--font-code)', color: 'var(--retro-teal)' }}>
                          UID: {c.customerId}
                        </p>
                      </div>
                      
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          {c.services && c.services.map(s => (
                            <span key={s} className="admin-card-service" style={{ fontSize: '0.62rem' }}>
                              {s.toUpperCase()}
                            </span>
                          ))}
                        </div>
                        <button
                          type="button"
                          className="admin-card-view-btn"
                          style={{ borderColor: 'var(--retro-teal)', color: 'var(--retro-teal)', padding: '5px 12px' }}
                          onClick={() => handleSendPasswordReset(c.customerEmail, c.customerName)}
                          disabled={isLoading}
                        >
                          SEND RESET
                        </button>

                        <button
                          type="button"
                          className="admin-card-view-btn"
                          style={{ borderColor: 'var(--rocket-orange)', color: 'var(--rocket-orange)', padding: '5px 12px' }}
                          onClick={() => handleCustomerDelete(c.customerId, c.customerName)}
                          disabled={isLoading}
                        >
                          REVOKE
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* Ticket List */
        <div className="admin-ticket-list">
          {filteredTickets.length === 0 ? (
            <p className="admin-no-tickets">
              No tickets found in this category.
            </p>
          ) : (
            filteredTickets.map((ticket) => (
              <article
                key={ticket.id}
                className="admin-ticket-card"
              >
                <div className="admin-card-header">
                  <span className="admin-card-number">
                    #{ticket.ticketNumber}
                  </span>

                  <span className="admin-card-service">
                    {getServiceLabel(
                      ticket.service
                    )}
                  </span>
                </div>

                <div className="admin-card-body">
                  <p className="admin-card-customer">
                    <strong>
                      {ticket.customerName}
                    </strong>{' '}
                    ({ticket.customerEmail})
                  </p>

                  <p className="admin-card-summary">
                    <span className="summary-label">
                      Category:
                    </span>{' '}
                    {ticket.category}
                  </p>

                  <p className="admin-card-excerpt">
                    "{ticket.description}"
                  </p>
                </div>

                <div className="admin-card-footer">
                  <span className="admin-card-time">
                    {formatDate(ticket.createdAt)}
                  </span>

                  <button
                    type="button"
                    className="admin-card-view-btn"
                    onClick={() =>
                      onTicketSelect(ticket)
                    }
                  >
                    VIEW TICKET
                  </button>
                </div>
              </article>
            ))
          )}
        </div>
      )}
    </div>
  )
}

export default AdminPortal
