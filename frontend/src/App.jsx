/*
    App.jsx

    LANZAR Support Tickets application shell.

    Responsibilities

    - Render the authentication terminal
    - Manage Firebase authentication state
    - Validate LANZAR customer authorization
    - Coordinate LANZAR service selection
    - Coordinate ticket detail workflow
    - Select Stella's presentation pose by workflow stage
*/

// ==========================
// React
// ==========================

import { useState, useEffect } from 'react'

// ==========================
// Authentication
// ==========================

import { onAuthStateChanged } from 'firebase/auth'
import { auth, signInWithGoogle, signOutUser, signInWithEmail, sendPasswordReset } from './firebase/auth.js'

// ==========================
// Customer & Admin
// ==========================

import { getAuthorizedCustomer } from './firebase/customers.js'
import { getAuthorizedAdmin } from './firebase/admins.js'

// ==========================
// Components
// ==========================

import ServiceSelector from './components/ServiceSelector.jsx'
import TicketDetails from './components/TicketDetails.jsx'
import AdminPortal from './components/AdminPortal.jsx'

// ==========================
// Styles
// ==========================

import './components/ServiceSelector.css'
import './components/TicketDetails.css'
import './components/SignIn.css'
import './components/AdminPortal.css'

// ==========================
// Stella Poses
// ==========================

const stellaPoses = {
  signIn: '/images/stella/stella-000.png',
  welcome: '/images/stella/stella-001.png',
  ticketDetails: '/images/stella/stella-002.png',
  ticketReview: '/images/stella/stella-003.png',
  ticketFinal: '/images/stella/stella-004.png',
}

// ==========================
// Application
// ==========================

function App() {
  const [
    isAuthenticated,
    setIsAuthenticated,
  ] = useState(false)

  const [
    customer,
    setCustomer,
  ] = useState(null)

  const [
    isAdmin,
    setIsAdmin,
  ] = useState(false)

  const [
    viewMode,
    setViewMode,
  ] = useState('customer') // 'customer', 'admin', or 'unauthorized'

  const [
    adminSelectedTicket,
    setAdminSelectedTicket,
  ] = useState(null)

  const [
    selectedService,
    setSelectedService,
  ] = useState(null)

  const [
    ticketStage,
    setTicketStage,
  ] = useState('details')

  const [
    authError,
    setAuthError,
  ] = useState(null)

  const [
    isLoading,
    setIsLoading,
  ] = useState(false)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [resetMode, setResetMode] = useState(false)
  const [authSuccess, setAuthSuccess] = useState(null)

  // ========================================================
  // Authentication Listeners
  // ========================================================

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setIsLoading(true)
        setAuthError(null)

        try {
          console.log('[AUTH] Login started for user:', user.email)

          // 1. Check if user is an authorized admin (safely handle permission errors)
          let authorizedAdmin = null
          try {
            console.log('[AUTH] Admin authorization check started')
            authorizedAdmin = await getAuthorizedAdmin(user.uid)
          } catch (adminError) {
            console.log(
              '[AUTH] Admin check skipped or denied permission:',
              adminError.message
            )
            // This is expected for standard customer accounts under Firestore rules
          }

          if (authorizedAdmin) {
            console.log('[AUTH] Google authentication succeeded (Admin role)')
            console.log('[AUTH] Firebase UID:', user.uid)
            console.log('[AUTH] Admin routing complete')

            setIsAdmin(true)
            setViewMode('admin')
            setIsAuthenticated(true)

            // Also load customer record if they exist so they can toggle views
            const authorizedCustomer = await getAuthorizedCustomer(user.uid)
            if (authorizedCustomer) {
              setCustomer(authorizedCustomer)
            }
            return
          }

          // 2. Check if user is an authorized customer
          console.log('[AUTH] Customer lookup started')
          const authorizedCustomer = await getAuthorizedCustomer(user.uid)

          if (authorizedCustomer) {
            console.log('[AUTH] Google authentication succeeded (Customer role)')
            console.log('[AUTH] Firebase UID:', user.uid)
            console.log('[AUTH] Customer found')
            console.log('[AUTH] Authorized services:', authorizedCustomer.services)
            console.log('[AUTH] Customer routing complete')

            setCustomer(authorizedCustomer)
            setViewMode('customer')
            setIsAuthenticated(true)
            return
          }

          // 3. User is authenticated with Google but not in LANZAR registry
          console.warn(
            '[AUTH ERROR] LANZAR authorization failed for authenticated account:',
            user.email
          )
          setAuthError(
            'We could not find an active LANZAR customer or admin account for this Google account.'
          )
          setViewMode('unauthorized')
          setIsAuthenticated(true)

        } catch (error) {
          console.error('[AUTH ERROR] Error during authorization checks:', error)
          setAuthError('Failed to verify account permissions.')
        } finally {
          setIsLoading(false)
        }
      } else {
        // Logged out state reset
        console.log('[AUTH] User logged out')
        setIsAuthenticated(false)
        setCustomer(null)
        setIsAdmin(false)
        setViewMode('customer')
        setSelectedService(null)
        setAdminSelectedTicket(null)
        setTicketStage('details')
        setIsLoading(false) // Reset loading state
      }
    })

    return () => unsubscribe()
  }, [])

  // ========================================================
  // Authentication Actions
  // ========================================================

  const handleGoogleSignIn = async () => {
    setIsLoading(true)
    setAuthError(null)
    setAuthSuccess(null)

    try {
      await signInWithGoogle()
      // The onAuthStateChanged listener handles routing post-signin
    } catch (error) {
      console.error(
        'LANZAR Google authentication failed:',
        error
      )

      setAuthError(
        'Something went wrong while signing you in with Google. Please try again.'
      )
      setIsLoading(false)
    }
  }

  const handleEmailSignIn = async (e) => {
    e.preventDefault()
    if (!email || !password) return

    setIsLoading(true)
    setAuthError(null)
    setAuthSuccess(null)

    try {
      await signInWithEmail(email.trim(), password)
      // The onAuthStateChanged listener handles routing post-signin
    } catch (error) {
      console.error(
        'LANZAR Email authentication failed:',
        error
      )
      
      let message = 'Incorrect email or password.'
      if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
        message = 'Incorrect email or password.'
      } else if (error.code === 'auth/invalid-email') {
        message = 'Please enter a valid email address.'
      } else if (error.code === 'auth/too-many-requests') {
        message = 'Access to this account has been temporarily disabled due to many failed login attempts.'
      } else if (error.code === 'auth/invalid-credential') {
        message = 'Incorrect email or password.'
      }
      
      setAuthError(message)
      setIsLoading(false)
    }
  }

  const handleForgotPassword = async (e) => {
    e.preventDefault()
    if (!email) return

    setIsLoading(true)
    setAuthError(null)
    setAuthSuccess(null)

    try {
      await sendPasswordReset(email.trim())
      setAuthSuccess('A secure password-reset invitation has been sent to your email address.')
      setEmail('')
    } catch (error) {
      console.error(
        'LANZAR Password reset failed:',
        error
      )
      
      let message = 'Failed to send password reset email.'
      if (error.code === 'auth/user-not-found') {
        message = 'No account exists with this email address.'
      } else if (error.code === 'auth/invalid-email') {
        message = 'Please enter a valid email address.'
      }
      
      setAuthError(message)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSignOut = async () => {
    setIsLoading(true)
    try {
      await signOutUser()
    } catch (error) {
      console.error('Sign out failed:', error)
    } finally {
      setIsLoading(false)
    }
  }

  // ========================================================
  // Service Selection
  // ========================================================

  const handleServiceSelect = (
    service
  ) => {
    setSelectedService(service)
    setTicketStage('details')
  }

  // ========================================================
  // Ticket Stage
  // ========================================================

  const handleTicketStageChange = (
    stage
  ) => {
    setTicketStage(stage)
  }

  // ========================================================
  // Ticket Back
  // ========================================================

  const handleTicketBack = () => {
    setSelectedService(null)
    setTicketStage('details')
  }

  // ========================================================
  // Stella Pose
  // ========================================================

  let stellaPose =
    stellaPoses.signIn

  if (isAuthenticated) {
    if (viewMode === 'admin') {
      if (adminSelectedTicket) {
        if (adminSelectedTicket.status === 'APPROVED') {
          stellaPose = stellaPoses.ticketFinal
        } else if (adminSelectedTicket.status === 'MORE_INFO') {
          stellaPose = stellaPoses.ticketReview
        } else {
          stellaPose = stellaPoses.ticketDetails
        }
      } else {
        stellaPose = stellaPoses.welcome
      }
    } else if (viewMode === 'unauthorized') {
      stellaPose = stellaPoses.signIn
    } else {
      // Customer mode
      if (!selectedService) {
        stellaPose =
          stellaPoses.welcome

      } else if (
        ticketStage === 'details'
      ) {
        stellaPose =
          stellaPoses.ticketDetails

      } else if (
        ticketStage === 'review'
      ) {
        stellaPose =
          stellaPoses.ticketReview

      } else if (
        ticketStage === 'final'
      ) {
        stellaPose =
          stellaPoses.ticketReview // Use double-check pose stella-003 for final check too

      } else if (
        ticketStage === 'success'
      ) {
        stellaPose =
          stellaPoses.ticketFinal
      }
    }
  }

  // ========================================================
  // Render
  // ========================================================

  return (
    <main className="ticket-terminal">

      <header className="ticket-header">
        <span className="terminal-header-title">
          LANZAR SUPPORT TERMINAL
        </span>

        <div className="header-actions">
          {isAuthenticated && isAdmin && customer && (
            <button
              className="role-toggle-button"
              type="button"
              onClick={() => {
                setViewMode(
                  viewMode === 'admin'
                    ? 'customer'
                    : 'admin'
                )
                setAdminSelectedTicket(null)
                setSelectedService(null)
                setTicketStage('details')
              }}
            >
              {viewMode === 'admin'
                ? '★ CUSTOMER MODE'
                : '⚙ ADMIN MODE'}
            </button>
          )}

          {isAuthenticated && (
            <button
              className="login-button logout-button"
              type="button"
              onClick={handleSignOut}
              disabled={isLoading}
            >
              {isLoading
                ? 'SIGNING OUT...'
                : 'SIGN OUT'}
            </button>
          )}
        </div>
      </header>

      <section className={`welcome-panel view-${viewMode}`}>

        <div className="welcome-copy">

          {/* ==================================================
              Sign In
              ================================================== */}

          {!isAuthenticated && (
            <div className="signin-content">

              <div className="stella-dialogue signin-dialogue">

                <img
                  src="/images/decorations/stella-dialog.svg"
                  alt=""
                  className="stella-dialogue-art"
                  aria-hidden="true"
                />

                <div className="stella-dialogue-content">

                  <p className="signin-greeting">
                    Hey, hun!
                  </p>

                  <p className="signin-question">
                    {resetMode
                      ? 'Enter your email to request a password reset link.'
                      : 'You just gotta sign in so we can direct you to the right service.'}
                  </p>

                  </div>

              </div>

              {resetMode ? (
                <form className="signin-form" onSubmit={handleForgotPassword}>
                  <div className="signin-field">
                    <label className="signin-field-label">EMAIL ADDRESS</label>
                    <input
                      type="email"
                      className="signin-input"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="e.g. customer@example.com"
                      disabled={isLoading}
                      required
                    />
                  </div>

                  <div className="signin-actions">
                    <button
                      type="button"
                      className="signin-back-link"
                      onClick={() => {
                        setResetMode(false)
                        setAuthError(null)
                        setAuthSuccess(null)
                      }}
                      disabled={isLoading}
                    >
                      ← Back to Login
                    </button>
                    <button
                      type="submit"
                      className="signin-submit-button"
                      disabled={isLoading}
                    >
                      {isLoading ? 'SENDING...' : 'SEND RESET EMAIL ✦'}
                    </button>
                  </div>
                </form>
              ) : (
                <form className="signin-form" onSubmit={handleEmailSignIn}>
                  <div className="signin-field">
                    <label className="signin-field-label">EMAIL ADDRESS</label>
                    <input
                      type="email"
                      className="signin-input"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="e.g. customer@example.com"
                      disabled={isLoading}
                      required
                    />
                  </div>

                  <div className="signin-field">
                    <div className="signin-field-header">
                      <label className="signin-field-label">PASSWORD</label>
                      <button
                        type="button"
                        className="signin-forgot-link"
                        onClick={() => {
                          setResetMode(true)
                          setAuthError(null)
                          setAuthSuccess(null)
                        }}
                        disabled={isLoading}
                      >
                        Forgot Password?
                      </button>
                    </div>
                    <input
                      type="password"
                      className="signin-input"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter password"
                      disabled={isLoading}
                      required
                    />
                  </div>

                  <button
                    type="submit"
                    className="signin-submit-button"
                    disabled={isLoading}
                  >
                    {isLoading ? 'SIGNING IN...' : 'SIGN IN ✦'}
                  </button>

                  <div className="signin-divider">
                    <span className="signin-divider-line"></span>
                    <span className="signin-divider-text">OR</span>
                    <span className="signin-divider-line"></span>
                  </div>

                  <button
                    className="google-signin-button"
                    type="button"
                    onClick={handleGoogleSignIn}
                    disabled={isLoading}
                  >
                    <svg
                      className="google-icon"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        fill="#4285F4"
                        d="M21.35 12.27c0-.71-.06-1.4-.18-2.06H12v3.9h5.24a4.48 4.48 0 0 1-1.94 2.94v2.45h3.14c1.84-1.69 2.91-4.18 2.91-7.23Z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 21.67c2.63 0 4.84-.87 6.45-2.36l-3.14-2.45c-.87.58-1.98.92-3.31.92-2.54 0-4.69-1.72-5.46-4.03H3.3A9.75 9.75 0 0 0 12 21.67Z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M6.54 13.75A5.86 5.86 0 0 1 6.23 12c0-.61.11-1.2.31-1.75V7.72H3.3A9.75 9.75 0 0 0 2.25 12c0 1.57.38 3.06 1.05 4.28l3.24-2.53Z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 6.22c1.43 0 2.72.49 3.73 1.46l2.8-2.8C16.84 3.29 14.63 2.33 12 2.33a9.74 9.74 0 0 0-8.7 5.39l3.24 2.53C6.85 7.94 9 6.22 12 6.22Z"
                      />
                    </svg>
                    SIGN IN WITH GOOGLE
                  </button>
                </form>
              )}

              <p className="signin-note">
                We&apos;ll only show you the services
                available to your account.
              </p>

              {authError && (
                <p className="signin-error">
                  {authError}
                </p>
              )}

              {authSuccess && (
                <p className="signin-success">
                  {authSuccess}
                </p>
              )}

            </div>
          )}

          {/* ==================================================
              Unauthorized
              ================================================== */}

          {isAuthenticated &&
            viewMode === 'unauthorized' && (
              <div className="signin-content">

                <div className="stella-dialogue signin-dialogue">

                  <img
                    src="/images/decorations/stella-dialog.svg"
                    alt=""
                    className="stella-dialogue-art"
                    aria-hidden="true"
                  />

                  <div className="stella-dialogue-content">

                    <p className="signin-greeting">
                      Oh, dear!
                    </p>

                    <p className="signin-question">
                      It looks like your account does
                      not have access to the LANZAR
                      Support Terminal.
                    </p>

                  </div>

                </div>

                <button
                  className="google-signin-button"
                  type="button"
                  onClick={handleSignOut}
                  disabled={isLoading}
                >
                  {isLoading
                    ? 'SIGNING OUT...'
                    : 'SIGN OUT'}
                </button>

                {authError && (
                  <p className="signin-error">
                    {authError}
                  </p>
                )}

              </div>
            )}

          {/* ==================================================
              Admin Portal
              ================================================== */}

          {isAuthenticated &&
            viewMode === 'admin' && (
              <>
                <div className="stella-dialogue">

                  <img
                    src="/images/decorations/stella-dialog.svg"
                    alt=""
                    className="stella-dialogue-art"
                    aria-hidden="true"
                  />

                  <div className="stella-dialogue-content">

                    <p className="stella-greeting">
                      Hey, Boss!
                    </p>

                    <p className="stella-question">
                      {adminSelectedTicket
                        ? adminSelectedTicket.status ===
                          'APPROVED'
                          ? `Ticket #${adminSelectedTicket.ticketNumber} is approved! Ready for launch.`
                          : adminSelectedTicket.status ===
                            'MORE_INFO'
                            ? `Clarification requested on #${adminSelectedTicket.ticketNumber}. Let's await details.`
                            : `Reviewing ticket #${adminSelectedTicket.ticketNumber}. What is the decision?`
                        : "Here's the queue of LANZAR support requests."}
                    </p>

                  </div>

                </div>

                <AdminPortal
                  onTicketSelect={
                    setAdminSelectedTicket
                  }
                  selectedTicket={
                    adminSelectedTicket
                  }
                />
              </>
            )}

          {/* ==================================================
              Service Selection
              ================================================== */}

          {isAuthenticated &&
            viewMode === 'customer' &&
            !selectedService && (
              <>
                <div className="stella-dialogue">

                  <img
                    src="/images/decorations/stella-dialog.svg"
                    alt=""
                    className="stella-dialogue-art"
                    aria-hidden="true"
                  />

                  <div className="stella-dialogue-content">

                    <p className="stella-greeting">
                      Hi, I&apos;m Stella.
                    </p>

                    <p className="stella-question">
                      What can we help you with today?
                    </p>

                  </div>

                </div>

                <div className="service-heading">

                  <span className="service-line" />

                  <span className="service-star">
                    ✦
                  </span>

                  <span className="service-heading-text">
                    SELECT A SERVICE
                  </span>

                  <span className="service-star">
                    ✦
                  </span>

                  <span className="service-line" />

                </div>

                <ServiceSelector
                  selectedService={
                    selectedService
                  }
                  onSelect={
                    handleServiceSelect
                  }
                  services={
                    customer?.services ?? []
                  }
                />

              </>
            )}

          {/* ==================================================
              Ticket Details
              ================================================== */}

          {isAuthenticated &&
            viewMode === 'customer' &&
            selectedService && (
              <TicketDetails
                selectedService={
                  selectedService
                }
                customer={customer}
                onBack={
                  handleTicketBack
                }
                onStageChange={
                  handleTicketStageChange
                }
              />
            )}

        </div>

        {/* ==================================================
            Stella
            ================================================== */}

        <div className="stella-stage">

          <img
            src={stellaPose}
            alt="Stella, LANZAR Support Hostess"
            className="stella"
          />

        </div>

      </section>

    </main>
  )
}

export default App