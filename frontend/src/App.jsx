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
import { generateRandomString, generateCodeChallenge } from './pkce.js'
import { auth, signInWithGoogle, signOutUser, signInWithEmail, sendPasswordReset, signInWithCustomToken } from './firebase/auth.js'

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
  const [isInitializing, setIsInitializing] = useState(true)

  // ========================================================
  // Authentication Listeners
  // ========================================================

  
  const authBackendUrl = window.location.hostname === 'localhost' ? 'http://localhost:4001' : 'https://auth-api.lanzar.me';
  
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const state = urlParams.get('state');

    if (code && state) {
      setIsLoading(true);
      const storedState = sessionStorage.getItem('pkce_state');
      const codeVerifier = sessionStorage.getItem('pkce_code_verifier');

      if (state !== storedState) {
        setAuthError('Authentication state mismatch.');
        setIsLoading(false);
      } else {
        const cleanRedirectUri = (window.location.origin + window.location.pathname).replace(/\/+$/, '') || window.location.origin;
        fetch(authBackendUrl + '/exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
              code,
              client_id: 'tickets',
              redirect_uri: cleanRedirectUri,
              code_verifier: codeVerifier
          })
        })
        .then(res => res.json().then(data => ({ ok: res.ok, data })))
        .then(({ ok, data }) => {
          if (!ok) throw new Error(data.error_description || data.error || 'Exchange failed');
          return signInWithCustomToken(data.custom_token);
        })
        .then(() => {
          window.history.replaceState({}, document.title, window.location.pathname);
          sessionStorage.removeItem('pkce_state');
          sessionStorage.removeItem('pkce_code_verifier');
        })
        .catch(err => {
          console.error('[AUTH] Exchange Error:', err);
          setAuthError('Failed to login via Auth Hub.');
          setIsLoading(false);
          window.history.replaceState({}, document.title, window.location.pathname);
        });
      }
    }
  }, []);

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
          setIsInitializing(false)
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
        setIsInitializing(false)
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

      let message = 'Something went wrong while signing you in with Google. Please try again.'
      if (error.code === 'auth/unauthorized-domain') {
        message = 'This domain is not authorized for Google Sign-In. Please add it to the authorized domains in the Firebase Console.'
      } else if (error.code === 'auth/popup-closed-by-user') {
        message = 'The sign-in popup was closed before completing authentication. Please try again.'
      } else if (error.code === 'auth/popup-blocked') {
        message = 'The sign-in popup was blocked by your browser. Please allow popups for this site and try again.'
      }

      setAuthError(message)
      setIsLoading(false)
    }
  }

  
  const initiateAuthHubLogin = async () => {
    setIsLoading(true);
    setAuthError(null);
    const state = generateRandomString();
    const codeVerifier = generateRandomString(64);
    const codeChallenge = await generateCodeChallenge(codeVerifier);

    sessionStorage.setItem('pkce_state', state);
    sessionStorage.setItem('pkce_code_verifier', codeVerifier);

    const redirectUri = (window.location.origin + window.location.pathname).replace(/\/+$/, '') || window.location.origin;
    const authHubUrl = 'https://auth.lanzar.me';
    const authUrlBase = window.location.hostname === 'localhost' ? 'http://localhost:4000' : authHubUrl;

    const authUrl = `${authUrlBase}?client_id=tickets&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`;
    window.location.href = authUrl;
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
      } else if (error.code === 'auth/operation-not-allowed') {
        message = 'Email/Password sign-in method is not enabled in the Firebase Console under Authentication > Sign-in method.'
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

  if (isInitializing) {
    return (
      <main className="ticket-terminal">
        <header className="ticket-header">
          <a href="https://lanzar.me" className="terminal-header-title-link" title="LANZAR Corporate Home">
            <span className="terminal-header-title">
              LANZAR SUPPORT TERMINAL
            </span>
          </a>
        </header>

        <section className="welcome-panel">
          <div className="welcome-copy">
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
                    Initializing...
                  </p>
                  <p className="signin-question">
                    Connecting to LANZAR launching facility support terminal...
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="stella-stage">
            <img
              src="/images/stella/stella-000.png"
              alt="Stella, LANZAR Support Hostess"
              className="stella"
            />
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="ticket-terminal">

      <header className="ticket-header">
        <a href="https://lanzar.me" className="terminal-header-title-link" title="LANZAR Corporate Home">
          <span className="terminal-header-title">
            LANZAR SUPPORT TERMINAL
          </span>
        </a>

        <div className="header-actions">
          <a
            href="https://lanzar.me"
            className="header-nav-link"
            title="Back to LANZAR Homepage"
          >
            ← LANZAR.ME
          </a>
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
                    {resetMode ? (
                      'Enter your email to request a password reset link.'
                    ) : (
                      <>
                        You just gotta sign in so we can direct<br />
                        you to the right service.
                      </>
                    )}
                  </p>

                  </div>

              </div>

              
    <div className="signin-form" style={{ alignItems: 'center' }}>
      <button 
        type="button" 
        className="google-signin-button" 
        onClick={initiateAuthHubLogin}
        disabled={isLoading}
      >
        {isLoading ? 'REDIRECTING...' : 'SIGN IN WITH LANZAR ID'}
      </button>
    </div>
  

              <p className="signin-note">
                We&apos;ll only show you the services
                available to your account.
              </p>

              {authError && (
                <p className="signin-error" role="alert" aria-live="assertive">
                  {authError}
                </p>
              )}
              {authSuccess && (
                <p className="signin-success" role="status" aria-live="polite" style={{ color: 'var(--retro-teal)', fontFamily: 'var(--font-code)', fontSize: '0.8rem', marginTop: '12px' }}>
                  {authSuccess}
                </p>
              )}

              <div className="no-account-section">
                <div className="no-account-divider">
                  <span className="no-account-divider-line"></span>
                  <span className="no-account-divider-text">NEW CLIENT?</span>
                  <span className="no-account-divider-line"></span>
                </div>

                <div className="no-account-actions">
                  <a
                    href="tel:+15085718819"
                    className="no-account-button call-button"
                    title="Call (508) 571-8819 to sign up"
                    id="btn-call-to-sign-up"
                  >
                    <svg className="action-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
                    </svg>
                    CALL TO SIGN UP
                  </a>

                  <a
                    href="mailto:jon@lanzar.me?subject=LANZAR%20Support%20Account%20Request&body=Hi%20Jon,%0A%0AI'd%20like%20to%20set%20up%20an%20account%20for%20the%20LANZAR%20Support%20Terminal.%0A%0AName:%20%0ACompany:%20%0APhone:%20"
                    className="no-account-button email-button"
                    title="Send an email to jon@lanzar.me to sign up"
                    id="btn-email-to-sign-up"
                  >
                    <svg className="action-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                      <polyline points="22,6 12,13 2,6"/>
                    </svg>
                    EMAIL TO SIGN UP
                  </a>

                  <a
                    href="https://lanzar.me"
                    className="no-account-button home-button"
                    title="Return to Lanzar Corporate Home"
                    id="btn-back-to-lanzar"
                  >
                    <svg className="action-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M19 12H5M12 19l-7-7 7-7"/>
                    </svg>
                    BACK TO LANZAR.ME
                  </a>
                </div>

                <p className="no-account-footnote">
                  Direct dispatch: <a href="tel:+15085718819">(508) 571-8819</a> &bull; <a href="mailto:jon@lanzar.me">jon@lanzar.me</a>
                </p>
              </div>

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

                <div className="no-account-actions unauthorized-actions">
                  <a
                    href="tel:+15085718819"
                    className="no-account-button call-button"
                    title="Call (508) 571-8819 to register"
                  >
                    <svg className="action-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
                    </svg>
                    CALL TO SIGN UP
                  </a>

                  <a
                    href={`mailto:jon@lanzar.me?subject=LANZAR%20Support%20Access%20Request&body=Hi%20Jon,%0A%0AMy%20account%20(${encodeURIComponent(currentUser?.email || '')})%20needs%20access%20to%20the%20LANZAR%20Support%20Terminal.`}
                    className="no-account-button email-button"
                    title="Send an email to jon@lanzar.me to sign up"
                  >
                    <svg className="action-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                      <polyline points="22,6 12,13 2,6"/>
                    </svg>
                    EMAIL TO SIGN UP
                  </a>

                  <a
                    href="https://lanzar.me"
                    className="no-account-button home-button"
                    title="Return to LANZAR Homepage"
                  >
                    <svg className="action-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M19 12H5M12 19l-7-7 7-7"/>
                    </svg>
                    BACK TO LANZAR.ME
                  </a>

                  <button
                    className="google-signin-button signout-button"
                    type="button"
                    onClick={handleSignOut}
                    disabled={isLoading}
                  >
                    {isLoading
                      ? 'SIGNING OUT...'
                      : 'SIGN OUT'}
                  </button>
                </div>

                <p className="no-account-footnote">
                  Direct dispatch: <a href="tel:+15085718819">(508) 571-8819</a> &bull; <a href="mailto:jon@lanzar.me">jon@lanzar.me</a>
                </p>

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
                <div className="stella-dialogue admin-dialogue">

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