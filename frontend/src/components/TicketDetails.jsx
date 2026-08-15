/*
    TicketDetails.jsx

    LANZAR Support Tickets ticket detail workflow.

    Responsibilities

    - Present Stella's ticket dialogue
    - Display service-specific ticket requirements
    - Collect the initial ticket information
    - Present the ticket double-check screen
    - Present the final ticket submission screen
*/

// ==========================
// React & Auth & Firestore Services
// ==========================

import { useState } from 'react'
import { auth } from '../firebase/auth.js'
import { createTicket, getProposedTicketNumber } from '../firebase/tickets.js'
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || ''

// ==========================
// Service Configuration
// ==========================

const ticketTypes = {
  web: {
    title: 'WEB SUPPORT',

    options: [
      'Website issue',
      'Website change',
      'New website or project',
      'Domain or DNS',
      'Hosting',
      'Email',
      'SEO or analytics',
      'Other',
    ],

    prompt:
      'Tell me a little about what needs attention.',

    placeholder:
      'Describe the trouble you are running into...',
  },

  it: {
    title: 'IT SUPPORT',

    options: [
      'Computer or workstation',
      'Network or internet',
      'Printer or peripheral',
      'Software',
      'Account or access',
      'Security',
      'Hardware',
      'Other',
    ],

    prompt:
      'What seems to be happening?',

    placeholder:
      'Tell me what is going wrong...',
  },

  threadline: {
    title: 'THREADLINE SUPPORT',

    options: [
      'Import or upload',
      'Conversation parsing',
      'Search or timeline',
      'Report generation',
      'Account or access',
      'Bug or error',
      'Feature question',
      'Other',
    ],

    prompt:
      'Tell me what you are trying to accomplish.',

    placeholder:
      'Describe what you are trying to do and what happened...',
  },
}

// ==========================
// Component
// ==========================

function TicketDetails({
  selectedService,
  customer,
  onBack,
  onStageChange,
}) {
  const service =
    ticketTypes[selectedService]

  // ==========================
  // Workflow State
  // ==========================

  const [stage, setStage] =
    useState('details')

  const [problemType, setProblemType] =
    useState('')

  const [description, setDescription] =
    useState('')

  const [error, setError] =
    useState('')

  const [
    proposedTicketNumber,
    setProposedTicketNumber,
  ] = useState('')

  const [
    finalTicketNumber,
    setFinalTicketNumber,
  ] = useState('')

  const [isLoading, setIsLoading] =
    useState(false)

  // ==========================
  // Invalid Service
  // ==========================

  if (!service) {
    return null
  }

  // ==========================
  // Stage Change
  // ==========================

  const changeStage = (
    nextStage
  ) => {
    setStage(nextStage)

    if (onStageChange) {
      onStageChange(nextStage)
    }
  }

  // ==========================
  // Continue
  // ==========================

  const handleContinue = () => {
    setError('')

    if (!problemType) {
      setError(
        'Please select the type of trouble you are having.'
      )

      return
    }

    if (!description.trim()) {
      setError(
        'Please tell us a little about what is happening.'
      )

      return
    }

    changeStage('review')
  }

  // ==========================
  // Review Continue
  // ==========================

  const handleReviewContinue = async () => {
    setIsLoading(true)
    setError('')
    try {
      const num = await getProposedTicketNumber(selectedService)
      if (num) {
        setProposedTicketNumber(num)
      } else {
        setProposedTicketNumber(`LZ-${selectedService.toUpperCase()}-10203`)
      }
      changeStage('final')
    } catch (err) {
      console.error(err)
      setError('Failed to fetch the next ticket number.')
    } finally {
      setIsLoading(false)
    }
  }

  // ==========================
  // Submit Ticket
  // ==========================

  const handleSubmit = async () => {
    setIsLoading(true)
    setError('')
    try {
      const ticketNum = await createTicket(
        selectedService,
        customer,
        auth.currentUser,
        problemType,
        description
      )
      
      // Trigger new ticket email notification via backend
      try {
        const idToken = await auth.currentUser.getIdToken()
        await fetch(`${API_BASE_URL}/api/tickets/notify`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`
          },
          body: JSON.stringify({ ticketId: ticketNum })
        })
      } catch (emailErr) {
        console.error('Failed to trigger new ticket notification email:', emailErr)
      }

      setFinalTicketNumber(ticketNum)
      changeStage('success')
    } catch (err) {
      console.error(err)
      setError('Failed to submit ticket. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  // ==========================
  // Reset Form
  // ==========================

  const handleReset = () => {
    setProblemType('')
    setDescription('')
    setError('')
    setProposedTicketNumber('')
    setFinalTicketNumber('')
    changeStage('details')
    onBack()
  }

  // ==========================
  // Back
  // ==========================

  const handleBack = () => {
    setError('')

    if (stage === 'review') {
      changeStage('details')
      return
    }

    if (stage === 'final') {
      changeStage('review')
      return
    }

    onBack()
  }

  // ==========================
  // Details
  // ==========================

  if (stage === 'details') {
    return (
      <section className="ticket-details">

        <div className="ticket-dialogue">

          <img
            src="/images/decorations/stella-ticket-dialog.svg"
            alt=""
            className="ticket-dialogue-art"
            aria-hidden="true"
          />

          <div className="ticket-dialogue-content">

            <p className="ticket-greeting">
              Well, alright!
            </p>

            <p className="ticket-question">
              What seems to be the trouble we can
              help you straighten out today?
            </p>

          </div>

        </div>

        <div className="ticket-form">

          <div className="ticket-form-header">

            <span className="service-star">
              ✦
            </span>

            <span className="ticket-form-title">
              {service.title}
            </span>

            <span className="service-star">
              ✦
            </span>

          </div>

          <label
            className="ticket-field-label"
            htmlFor="ticket-type"
          >
            WHAT SEEMS TO BE THE TROUBLE?
          </label>

          <select
            id="ticket-type"
            className="ticket-select"
            value={problemType}
            onChange={(event) =>
              setProblemType(
                event.target.value
              )
            }
          >
            <option
              value=""
              disabled
            >
              Select a problem type
            </option>

            {service.options.map(
              (option) => (
                <option
                  key={option}
                  value={option}
                >
                  {option}
                </option>
              )
            )}

          </select>

          <label
            className="ticket-field-label"
            htmlFor="ticket-description"
          >
            {service.prompt}
          </label>

          <textarea
            id="ticket-description"
            className="ticket-textarea"
            placeholder={
              service.placeholder
            }
            rows="5"
            value={description}
            onChange={(event) =>
              setDescription(
                event.target.value
              )
            }
          />

          {error && (
            <p className="ticket-error">
              {error}
            </p>
          )}

          <div className="ticket-actions">

            <button
              type="button"
              className="ticket-back-button"
              onClick={handleBack}
            >
              ← BACK
            </button>

            <button
              type="button"
              className="ticket-next-button"
              onClick={handleContinue}
            >
              CONTINUE →
            </button>

          </div>

        </div>

      </section>
    )
  }

  // ==========================
  // Double Check
  // ==========================

  if (stage === 'review') {
    return (
      <section className="ticket-details ticket-review">

        <div className="ticket-dialogue">

          <img
            src="/images/decorations/stella-ticket-dialog.svg"
            alt=""
            className="ticket-dialogue-art"
            aria-hidden="true"
          />

          <div className="ticket-dialogue-content">

            <p className="ticket-greeting">
              Just one more look!
            </p>

            <p className="ticket-question">
              Let&apos;s make sure everything looks
              shipshape before we send it along.
            </p>

          </div>

        </div>

        <div className="ticket-form">

          <div className="ticket-form-header">

            <span className="service-star">
              ✦
            </span>

            <span className="ticket-form-title">
              DOUBLE CHECK
            </span>

            <span className="service-star">
              ✦
            </span>

          </div>

          <div className="ticket-review-field">

            <span className="ticket-field-label">
              SERVICE
            </span>

            <strong>
              {service.title}
            </strong>

          </div>

          <div className="ticket-review-field">

            <span className="ticket-field-label">
              PROBLEM
            </span>

            <strong>
              {problemType}
            </strong>

          </div>

          <div className="ticket-review-field">

            <span className="ticket-field-label">
              DETAILS
            </span>

            <p className="ticket-review-description">
              {description}
            </p>

          </div>

          {error && (
            <p className="ticket-error">
              {error}
            </p>
          )}

          <div className="ticket-actions">

            <button
              type="button"
              className="ticket-back-button"
              onClick={handleBack}
              disabled={isLoading}
            >
              ← BACK
            </button>

            <button
              type="button"
              className="ticket-next-button"
              onClick={
                handleReviewContinue
              }
              disabled={isLoading}
            >
              {isLoading ? 'LOADING...' : 'LOOKS GOOD →'}
            </button>

          </div>

        </div>

      </section>
    )
  }

  // ==========================
  // Success / Confirmation
  // ==========================

  if (stage === 'success') {
    return (
      <section className="ticket-details ticket-final">

        <div className="ticket-dialogue">

          <img
            src="/images/decorations/stella-ticket-dialog.svg"
            alt=""
            className="ticket-dialogue-art"
            aria-hidden="true"
          />

          <div className="ticket-dialogue-content">

            <p className="ticket-greeting">
              All set!
            </p>

            <p className="ticket-question">
              Your ticket has been submitted successfully. We&apos;ve got our best people on it and will get things rolling right away!
            </p>

          </div>

        </div>

        <div className="ticket-form">

          <div className="ticket-form-header">

            <span className="service-star">
              ✦
            </span>

            <span className="ticket-form-title">
              SUBMITTED TICKET
            </span>

            <span className="service-star">
              ✦
            </span>

          </div>

          <div className="ticket-review-field">

            <span className="ticket-field-label">
              TICKET NUMBER
            </span>

            <strong>
              #{finalTicketNumber}
            </strong>

          </div>

          <div className="ticket-review-field">

            <span className="ticket-field-label">
              SERVICE
            </span>

            <strong>
              {service.title}
            </strong>

          </div>

          <div className="ticket-review-field">

            <span className="ticket-field-label">
              PROBLEM TYPE
            </span>

            <strong>
              {problemType}
            </strong>

          </div>

          <div className="ticket-review-field">

            <span className="ticket-field-label">
              DETAILS
            </span>

            <p className="ticket-review-description">
              {description}
            </p>

          </div>

          <div className="ticket-actions" style={{ justifyContent: 'flex-end' }}>

            <button
              type="button"
              className="ticket-next-button"
              onClick={handleReset}
            >
              RETURN TO SERVICES
            </button>

          </div>

        </div>

      </section>
    )
  }

  // ==========================
  // Final Submission
  // ==========================

  return (
    <section className="ticket-details ticket-final">

      <div className="ticket-dialogue">

        <img
          src="/images/decorations/stella-ticket-dialog.svg"
          alt=""
          className="ticket-dialogue-art"
          aria-hidden="true"
        />

        <div className="ticket-dialogue-content">

          <p className="ticket-greeting">
            Here we go!
          </p>

          <p className="ticket-question">
            Here&apos;s your ticket! Just give it
            one last look, then hit submit and
            we&apos;ll get things rolling.
          </p>

        </div>

      </div>

      <div className="ticket-form">

        <div className="ticket-form-header">

          <span className="service-star">
            ✦
          </span>

          <span className="ticket-form-title">
            TICKET: #{proposedTicketNumber}
          </span>

          <span className="service-star">
            ✦
          </span>

        </div>

        <div className="ticket-review-field">

          <span className="ticket-field-label">
            PROBLEM
          </span>

          <strong>
            {problemType}
          </strong>

        </div>

        <div className="ticket-review-field">

          <span className="ticket-field-label">
            DETAILS
          </span>

          <p className="ticket-review-description">
            {description}
          </p>

        </div>

        {error && (
          <p className="ticket-error">
            {error}
          </p>
        )}

        <div className="ticket-actions">

          <button
            type="button"
            className="ticket-back-button"
            onClick={handleBack}
            disabled={isLoading}
          >
            ← BACK
          </button>

          <button
            type="button"
            className="ticket-next-button"
            onClick={handleSubmit}
            disabled={isLoading}
          >
            {isLoading ? 'SUBMITTING...' : 'SUBMIT TICKET →'}
          </button>

        </div>

      </div>

    </section>
  )
}

export default TicketDetails