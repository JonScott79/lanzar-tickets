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
  getDocs,
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

  // ========================================================
  // Customer & Organization Management State
  // ========================================================

  const [customerSubTab, setCustomerSubTab] = useState('list') // 'list' | 'new-org' | 'add-user'
  const [availableAccounts, setAvailableAccounts] = useState([])
  const [allUsers, setAllUsers] = useState([])
  const [expandedAccountId, setExpandedAccountId] = useState(null)

  // Form State: New Organization
  const [orgName, setOrgName] = useState('')
  const [orgShortName, setOrgShortName] = useState('')
  const [orgContactName, setOrgContactName] = useState('')
  const [orgContactEmail, setOrgContactEmail] = useState('')
  const [orgServices, setOrgServices] = useState({
    it: true,
    web: false,
    threadline: false,
  })

  // Form State: Add User
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [custName, setCustName] = useState('')
  const [custEmail, setCustEmail] = useState('')
  const [sendWelcomeEmail, setSendWelcomeEmail] = useState(true)
  const [custServices, setCustServices] = useState({
    it: true,
    web: false,
    threadline: false,
  })

  const [customerError, setCustomerError] = useState('')
  const [customerSuccess, setCustomerSuccess] = useState('')

  // ========================================================
  // Real-Time Customer & Accounts Sync
  // ========================================================

  useEffect(() => {
    if (activeTab !== 'customers') return

    // Fetch accounts (organizations)
    const qAcc = query(collection(db, 'accounts'), orderBy('name', 'asc'))
    const unsubAccounts = onSnapshot(
      qAcc,
      (snapshot) => {
        const listAcc = []
        snapshot.forEach((docSnap) => {
          if (docSnap.data().active === true) {
            listAcc.push({ id: docSnap.id, ...docSnap.data() })
          }
        })
        setAvailableAccounts(listAcc)
        if (listAcc.length > 0 && !selectedAccountId) {
          setSelectedAccountId(listAcc[0].id)
        }
      },
      (err) => {
        console.error('Error fetching accounts:', err)
      }
    )

    // Fetch users (both users/ and legacy customers/)
    const qUsers = query(collection(db, 'users'), orderBy('displayName', 'asc'))
    const unsubUsers = onSnapshot(
      qUsers,
      (snapshot) => {
        const listUsers = []
        snapshot.forEach((docSnap) => {
          listUsers.push({ id: docSnap.id, ...docSnap.data() })
        })
        setAllUsers(listUsers)
      },
      (err) => {
        console.error('Error fetching users:', err)
      }
    )

    return () => {
      unsubAccounts()
      unsubUsers()
    }
  }, [activeTab, selectedAccountId])

  const getAccountUsers = (accId) => {
    return allUsers.filter((u) => u.accountId === accId)
  }

  // ========================================================
  // Organization & User Actions
  // ========================================================

  const handleCreateOrganization = async (e) => {
    e.preventDefault()
    setCustomerError('')
    setCustomerSuccess('')

    if (!orgName.trim()) {
      setCustomerError('Organization Name is required.')
      return
    }

    const servicesArray = Object.keys(orgServices).filter((k) => orgServices[k])

    setIsLoading(true)
    try {
      const idToken = await auth.currentUser.getIdToken()
      const response = await fetch(`${API_BASE_URL}/api/accounts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          name: orgName.trim(),
          shortName: orgShortName.trim(),
          primaryContactName: orgContactName.trim(),
          primaryContactEmail: orgContactEmail.trim(),
          services: servicesArray.length > 0 ? servicesArray : ['it'],
        }),
      })

      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to create organization.')
      }

      setCustomerSuccess(`Organization "${orgName.trim()}" created successfully.`)
      setOrgName('')
      setOrgShortName('')
      setOrgContactName('')
      setOrgContactEmail('')
      setOrgServices({ it: true, web: false, threadline: false })
      setCustomerSubTab('list')
      if (result.accountId) {
        setExpandedAccountId(result.accountId)
      }
    } catch (err) {
      console.error('Error creating organization:', err)
      setCustomerError(err.message)
    } finally {
      setIsLoading(false)
    }
  }

  const handleCustomerSubmit = async (e) => {
    e.preventDefault()
    setCustomerError('')
    setCustomerSuccess('')

    if (!selectedAccountId) {
      setCustomerError('Organization selection is required.')
      return
    }
    if (!custName.trim()) {
      setCustomerError('User Full Name is required.')
      return
    }
    if (!custEmail.trim()) {
      setCustomerError('User Email Address is required.')
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
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          accountId: selectedAccountId,
          name: custName.trim(),
          email: custEmail.trim(),
          services: servicesArray,
          sendWelcomeEmail: sendWelcomeEmail,
        }),
      })

      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to create user.')
      }

      if (result.warning) {
        setCustomerSuccess(result.warning)
      } else if (result.message) {
        setCustomerSuccess(result.message)
      } else {
        setCustomerSuccess(`User "${custName.trim()}" created successfully. Welcome email sent.`)
      }

      setCustName('')
      setCustEmail('')
      setCustServices({
        it: true,
        web: false,
        threadline: false,
      })
      setCustomerSubTab('list')
      setExpandedAccountId(selectedAccountId)
    } catch (err) {
      console.error('Error creating user:', err)
      setCustomerError(err.message)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSendWelcomeEmail = async (customer) => {
    const email = customer.email || customer.customerEmail || customer.authEmail
    const name = customer.displayName || customer.customerName || 'Customer'
    if (!email) {
      setCustomerError('No email found for this user.')
      return
    }

    setCustomerError('')
    setCustomerSuccess('')
    setIsLoading(true)
    try {
      const idToken = await auth.currentUser.getIdToken()
      const response = await fetch(`${API_BASE_URL}/api/customers/${customer.id}/welcome-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        }
      })

      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to send welcome email.')
      }

      setCustomerSuccess(result.message || `Welcome email sent to "${name}" (${email}) successfully.`)
    } catch (err) {
      console.error('Error sending welcome email:', err)
      setCustomerError('Failed to send welcome email: ' + err.message)
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

  const handleToggleUserStatus = async (user, activeState) => {
    const name = user.displayName || user.customerName || user.email || 'User'
    const actionText = activeState ? 're-enable access for' : 'revoke access for'
    if (!window.confirm(`Are you sure you want to ${actionText} user "${name}"?`)) {
      return
    }
    setCustomerError('')
    setCustomerSuccess('')
    setIsLoading(true)
    try {
      const idToken = await auth.currentUser.getIdToken()
      const response = await fetch(`${API_BASE_URL}/api/customers/${user.id}/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ active: activeState })
      })

      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to update user status.')
      }

      setCustomerSuccess(result.message || `Status updated for "${name}".`)
    } catch (err) {
      console.error('Error toggling user status:', err)
      setCustomerError('Failed to update user status: ' + err.message)
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

            {selectedTicket.issueType && (
              <div className="admin-meta-item">
                <span className="admin-meta-label">
                  SPECIFIC ISSUE
                </span>

                <strong>
                  {selectedTicket.issueType}
                </strong>
              </div>
            )}

            {selectedTicket.locationName && (
              <div className="admin-meta-item">
                <span className="admin-meta-label">
                  LOCATION
                </span>

                <strong>
                  {selectedTicket.locationName}
                </strong>
              </div>
            )}

            {selectedTicket.assetName && (
              <div className="admin-meta-item">
                <span className="admin-meta-label">
                  AFFECTED ASSET
                </span>

                <strong>
                  {selectedTicket.assetName}
                </strong>
              </div>
            )}

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

          {/* Structured Answers Section */}
          {selectedTicket.answers && Object.keys(selectedTicket.answers).length > 0 && (
            <div className="admin-detail-section" style={{ background: 'var(--soft-card-bg)', padding: '14px', borderRadius: '4px', borderLeft: '3px solid var(--retro-teal)' }}>
              <span className="admin-meta-label" style={{ color: 'var(--retro-teal)', marginBottom: '8px' }}>
                DIAGNOSTIC ANSWERS
              </span>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
                {Object.entries(selectedTicket.answers).map(([key, val]) => (
                  <div key={key} style={{ fontSize: '0.85rem' }}>
                    <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--soft-gray)', textTransform: 'uppercase' }}>
                      {key.replace(/([A-Z])/g, ' $1')}
                    </span>
                    <strong>{String(val)}</strong>
                  </div>
                ))}
              </div>
            </div>
          )}

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
          {/* Action Bar */}
          <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
            <button
              type="button"
              className={`admin-tab ${customerSubTab === 'new-org' ? 'active' : ''}`}
              style={{ flex: '1', padding: '10px 16px', fontWeight: 'bold' }}
              onClick={() => {
                setCustomerError('')
                setCustomerSuccess('')
                setCustomerSubTab(customerSubTab === 'new-org' ? 'list' : 'new-org')
              }}
            >
              + NEW ORGANIZATION
            </button>
            <button
              type="button"
              className={`admin-tab ${customerSubTab === 'add-user' ? 'active' : ''}`}
              style={{ flex: '1', padding: '10px 16px', fontWeight: 'bold' }}
              onClick={() => {
                setCustomerError('')
                setCustomerSuccess('')
                setCustomerSubTab(customerSubTab === 'add-user' ? 'list' : 'add-user')
              }}
            >
              + ADD USER
            </button>
          </div>

          {customerError && (
            <p className="admin-error-text" role="alert" aria-live="assertive" style={{ marginBottom: '14px' }}>
              {customerError}
            </p>
          )}
          {customerSuccess && (
            <p className="admin-success-text" role="status" aria-live="polite" style={{ marginBottom: '14px', color: 'var(--retro-teal)', fontFamily: 'var(--font-code)', fontSize: '0.78rem', fontWeight: 700 }}>
              {customerSuccess}
            </p>
          )}

          {/* Form: New Organization */}
          {customerSubTab === 'new-org' && (
            <form className="admin-customer-form" onSubmit={handleCreateOrganization} style={{ marginBottom: '24px' }}>
              <h3 className="admin-form-section-title">✦ CREATE NEW ORGANIZATION ✦</h3>

              <div className="admin-form-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '16px' }}>
                <div className="admin-input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label className="admin-meta-label" htmlFor="admin-org-name">ORGANIZATION NAME *</label>
                  <input
                    id="admin-org-name"
                    type="text"
                    className="admin-more-info-textarea"
                    style={{ resize: 'none', height: '42px', padding: '10px' }}
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    placeholder="e.g. Dental Associates of New England"
                    disabled={isLoading}
                    required
                    aria-required="true"
                  />
                </div>

                <div className="admin-input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label className="admin-meta-label" htmlFor="admin-org-short-name">SHORT NAME / ABBREVIATION</label>
                  <input
                    id="admin-org-short-name"
                    type="text"
                    className="admin-more-info-textarea"
                    style={{ resize: 'none', height: '42px', padding: '10px' }}
                    value={orgShortName}
                    onChange={(e) => setOrgShortName(e.target.value)}
                    placeholder="e.g. DANE"
                    disabled={isLoading}
                  />
                </div>

                <div className="admin-input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label className="admin-meta-label" htmlFor="admin-org-contact-name">PRIMARY CONTACT NAME</label>
                  <input
                    id="admin-org-contact-name"
                    type="text"
                    className="admin-more-info-textarea"
                    style={{ resize: 'none', height: '42px', padding: '10px' }}
                    value={orgContactName}
                    onChange={(e) => setOrgContactName(e.target.value)}
                    placeholder="e.g. Erika Smith"
                    disabled={isLoading}
                  />
                </div>

                <div className="admin-input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label className="admin-meta-label" htmlFor="admin-org-contact-email">PRIMARY CONTACT EMAIL</label>
                  <input
                    id="admin-org-contact-email"
                    type="email"
                    className="admin-more-info-textarea"
                    style={{ resize: 'none', height: '42px', padding: '10px' }}
                    value={orgContactEmail}
                    onChange={(e) => setOrgContactEmail(e.target.value)}
                    placeholder="e.g. contact@bostonsmile.com"
                    disabled={isLoading}
                  />
                </div>
              </div>

              <div className="admin-services-checkboxes" style={{ marginBottom: '20px' }}>
                <label className="admin-meta-label" style={{ display: 'block', marginBottom: '8px' }}>AUTHORIZED SERVICES</label>
                <div className="admin-checkbox-row" style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                  <label className="admin-card-customer" style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={orgServices.it}
                      onChange={(e) => setOrgServices({ ...orgServices, it: e.target.checked })}
                      disabled={isLoading}
                      style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                    />
                    IT Support (it)
                  </label>
                  <label className="admin-card-customer" style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={orgServices.web}
                      onChange={(e) => setOrgServices({ ...orgServices, web: e.target.checked })}
                      disabled={isLoading}
                      style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                    />
                    Web Services (web)
                  </label>
                  <label className="admin-card-customer" style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={orgServices.threadline}
                      onChange={(e) => setOrgServices({ ...orgServices, threadline: e.target.checked })}
                      disabled={isLoading}
                      style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                    />
                    Threadline Ops (threadline)
                  </label>
                </div>
              </div>

              <button type="submit" className="admin-btn-approve" disabled={isLoading} aria-busy={isLoading}>
                {isLoading ? 'CREATING...' : 'CREATE ORGANIZATION ✦'}
              </button>
            </form>
          )}

          {/* Form: Add User to Organization */}
          {customerSubTab === 'add-user' && (
            <form className="admin-customer-form" onSubmit={handleCustomerSubmit} style={{ marginBottom: '24px' }}>
              <h3 className="admin-form-section-title">✦ ADD USER TO ORGANIZATION ✦</h3>

              <div className="admin-form-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '16px' }}>
                <div className="admin-input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label className="admin-meta-label" htmlFor="admin-user-org-select">ORGANIZATION *</label>
                  <select
                    id="admin-user-org-select"
                    className="admin-more-info-textarea"
                    style={{ resize: 'none', height: '42px', padding: '10px', backgroundColor: 'var(--card-bg)', color: 'var(--text-color)' }}
                    value={selectedAccountId}
                    onChange={(e) => setSelectedAccountId(e.target.value)}
                    disabled={isLoading}
                    required
                    aria-required="true"
                  >
                    <option value="" disabled>Select Organization</option>
                    {availableAccounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.name} ({acc.shortName || acc.id})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="admin-input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label className="admin-meta-label" htmlFor="admin-user-full-name">FULL NAME *</label>
                  <input
                    id="admin-user-full-name"
                    type="text"
                    className="admin-more-info-textarea"
                    style={{ resize: 'none', height: '42px', padding: '10px' }}
                    value={custName}
                    onChange={(e) => setCustName(e.target.value)}
                    placeholder="e.g. Sarah Jenkins"
                    disabled={isLoading}
                    required
                    aria-required="true"
                  />
                </div>

                <div className="admin-input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label className="admin-meta-label" htmlFor="admin-user-email">EMAIL ADDRESS *</label>
                  <input
                    id="admin-user-email"
                    type="email"
                    className="admin-more-info-textarea"
                    style={{ resize: 'none', height: '42px', padding: '10px' }}
                    value={custEmail}
                    onChange={(e) => setCustEmail(e.target.value)}
                    placeholder="e.g. s.jenkins@bostonsmile.com"
                    disabled={isLoading}
                    required
                    aria-required="true"
                  />
                </div>

                <div className="admin-input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px', justifyContent: 'center' }}>
                  <label className="admin-meta-label">WELCOME INVITATION</label>
                  <label className="admin-card-customer" style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', height: '42px', fontSize: '0.85rem' }}>
                    <input
                      type="checkbox"
                      checked={sendWelcomeEmail}
                      onChange={(e) => setSendWelcomeEmail(e.target.checked)}
                      disabled={isLoading}
                      style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                    />
                    Send Welcome Email
                  </label>
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
                {isLoading ? 'CREATING USER...' : 'CREATE USER ✦'}
              </button>
            </form>
          )}

          {/* Organizations List View */}
          <div className="admin-customers-list-section" style={{ marginTop: '12px' }}>
            <h3 className="admin-form-section-title" style={{ marginBottom: '14px' }}>✦ CUSTOMER ORGANIZATIONS ✦</h3>
            <div className="admin-ticket-list" style={{ maxHeight: '480px' }}>
              {availableAccounts.length === 0 ? (
                <p className="admin-no-tickets">No customer organizations found.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {availableAccounts.map((acc) => {
                    const accUsers = getAccountUsers(acc.id)
                    const isExpanded = expandedAccountId === acc.id

                    return (
                      <article key={acc.id} className="admin-ticket-card" style={{ padding: '16px 20px', borderLeft: '4px solid var(--retro-teal)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                          <div style={{ flex: '1 1 auto', minWidth: '220px' }}>
                            <h4 style={{ margin: '0 0 4px 0', fontFamily: 'var(--font-heading)', fontSize: '1.1rem', color: 'var(--deep-navy)' }}>
                              {acc.name} {acc.shortName ? `(${acc.shortName})` : ''}
                            </h4>
                            <div style={{ display: 'flex', gap: '16px', fontSize: '0.78rem', color: 'var(--soft-gray)', marginTop: '4px', flexWrap: 'wrap' }}>
                              <span>Users: {accUsers.length}</span>
                              {acc.primaryContactEmail && <span>Contact: {acc.primaryContactEmail}</span>}
                              <span style={{ fontFamily: 'var(--font-code)', color: 'var(--retro-teal)' }}>ID: {acc.id}</span>
                            </div>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                            <div style={{ display: 'flex', gap: '4px' }}>
                              {acc.services && acc.services.map((s) => (
                                <span key={s} className="admin-card-service" style={{ fontSize: '0.62rem' }}>
                                  {s.toUpperCase()}
                                </span>
                              ))}
                            </div>

                            <button
                              type="button"
                              className="admin-card-view-btn"
                              style={{ borderColor: 'var(--retro-teal)', color: 'var(--retro-teal)', padding: '5px 12px' }}
                              onClick={() => setExpandedAccountId(isExpanded ? null : acc.id)}
                            >
                              {isExpanded ? 'HIDE USERS ▲' : 'MANAGE USERS ▼'}
                            </button>

                            <button
                              type="button"
                              className="admin-card-view-btn"
                              style={{ borderColor: 'var(--retro-teal)', color: 'var(--retro-teal)', padding: '5px 12px' }}
                              onClick={() => {
                                setSelectedAccountId(acc.id)
                                setCustomerSubTab('add-user')
                              }}
                            >
                              + ADD USER
                            </button>
                          </div>
                        </div>

                        {/* Expanded Users List */}
                        {isExpanded && (
                          <div style={{ marginTop: '16px', paddingTop: '14px', borderTop: '1px dashed var(--border-color)' }}>
                            <h5 style={{ margin: '0 0 10px 0', fontFamily: 'var(--font-code)', fontSize: '0.78rem', color: 'var(--retro-teal)', textTransform: 'uppercase' }}>
                              Organization Users ({accUsers.length})
                            </h5>
                            {accUsers.length === 0 ? (
                              <p style={{ fontSize: '0.8rem', color: 'var(--soft-gray)', margin: 0 }}>No users associated with this organization.</p>
                            ) : (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {accUsers.map((user) => (
                                  <div key={user.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: user.active === false ? 'rgba(255, 100, 100, 0.08)' : 'rgba(255, 255, 255, 0.05)', padding: '10px 14px', borderRadius: '4px', border: user.active === false ? '1px solid var(--rocket-orange)' : '1px solid var(--border-color)', flexWrap: 'wrap', gap: '8px' }}>
                                    <div>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <strong style={{ fontSize: '0.88rem', color: 'var(--deep-navy)' }}>{user.displayName || user.customerName || 'User'}</strong>
                                        <span style={{ fontSize: '0.65rem', padding: '2px 6px', borderRadius: '3px', fontWeight: 'bold', backgroundColor: user.active === false ? 'rgba(255, 120, 80, 0.2)' : 'rgba(42, 114, 143, 0.2)', color: user.active === false ? 'var(--rocket-orange)' : 'var(--retro-teal)' }}>
                                          {user.active === false ? 'REVOKED' : 'ACTIVE'}
                                        </span>
                                      </div>
                                      <div style={{ fontSize: '0.78rem', color: 'var(--soft-gray)' }}>{user.email || user.customerEmail}</div>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                      <button
                                        type="button"
                                        className="admin-card-view-btn"
                                        style={{ fontSize: '0.7rem', padding: '4px 10px' }}
                                        onClick={() => handleSendWelcomeEmail(user)}
                                        disabled={isLoading || user.active === false}
                                      >
                                        SEND WELCOME
                                      </button>
                                      <button
                                        type="button"
                                        className="admin-card-view-btn"
                                        style={{ fontSize: '0.7rem', padding: '4px 10px' }}
                                        onClick={() => handleSendPasswordReset(user.email || user.customerEmail, user.displayName || user.customerName)}
                                        disabled={isLoading || user.active === false}
                                      >
                                        SEND RESET
                                      </button>
                                      {user.active === false ? (
                                        <button
                                          type="button"
                                          className="admin-card-view-btn"
                                          style={{ borderColor: 'var(--retro-teal)', color: 'var(--retro-teal)', fontSize: '0.7rem', padding: '4px 10px' }}
                                          onClick={() => handleToggleUserStatus(user, true)}
                                          disabled={isLoading}
                                        >
                                          RE-ENABLE
                                        </button>
                                      ) : (
                                        <button
                                          type="button"
                                          className="admin-card-view-btn"
                                          style={{ borderColor: 'var(--rocket-orange)', color: 'var(--rocket-orange)', fontSize: '0.7rem', padding: '4px 10px' }}
                                          onClick={() => handleToggleUserStatus(user, false)}
                                          disabled={isLoading}
                                        >
                                          REVOKE
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </article>
                    )
                  })}
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
