/*
    TicketDetails.jsx

    LANZAR Support Tickets — Dynamic, Customer-Aware Ticket Intake Workflow

    Responsibilities
    - Load customer account assets and locations dynamically (path-scoped)
    - Render configuration-driven category and subcategory issue selections
    - Render conditional follow-up questions dynamically
    - Present a structured ticket double-check summary screen
    - Submit structured ticket payloads to Firestore and notify admin via backend
*/

import { useState, useEffect } from 'react'
import { auth } from '../firebase/auth.js'
import { createTicket, getProposedTicketNumber } from '../firebase/tickets.js'
import { getAccountAssets, getAccountLocations } from '../firebase/accountResources.js'
import { serviceCategoryTrees } from '../config/questionTrees.js'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || ''

function TicketDetails({
  selectedService,
  customer,
  onBack,
  onStageChange,
}) {
  const serviceTree = serviceCategoryTrees[selectedService]

  // ==========================
  // Workflow State
  // ==========================

  const [stage, setStage] = useState('details') // 'details' | 'review' | 'final' | 'success'

  // Selection state
  const [selectedCategoryId, setSelectedCategoryId] = useState('')
  const [selectedAssetId, setSelectedAssetId] = useState('')
  const [manualAssetName, setManualAssetName] = useState('')
  const [selectedLocationId, setSelectedLocationId] = useState('')
  const [selectedIssueTypeId, setSelectedIssueTypeId] = useState('')
  const [answers, setAnswers] = useState({})
  const [description, setDescription] = useState('')

  // Account resources state
  const [accountAssets, setAccountAssets] = useState([])
  const [accountLocations, setAccountLocations] = useState([])
  const [isLoadingResources, setIsLoadingResources] = useState(false)

  // Status & Error state
  const [error, setError] = useState('')
  const [proposedTicketNumber, setProposedTicketNumber] = useState('')
  const [finalTicketNumber, setFinalTicketNumber] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  // ==========================
  // Account Resources Fetching
  // ==========================

  useEffect(() => {
    async function loadResources() {
      if (!customer?.accountId) {
        setAccountAssets([])
        setAccountLocations([])
        return
      }

      setIsLoadingResources(true)
      try {
        const [assets, locations] = await Promise.all([
          getAccountAssets(customer.accountId),
          getAccountLocations(customer.accountId)
        ])
        setAccountAssets(assets)
        setAccountLocations(locations)

        // Auto-select location if account has exactly 1 location
        if (locations.length === 1) {
          setSelectedLocationId(locations[0].id)
        }
      } catch (err) {
        console.warn('[TICKET INTAKE WARN] Resource load failed:', err.message)
      } finally {
        setIsLoadingResources(false)
      }
    }

    loadResources()
  }, [customer?.accountId])

  if (!serviceTree) {
    return null
  }

  // Active Category Object
  const currentCategory = serviceTree.categories.find(c => c.id === selectedCategoryId)

  // Filtered Assets for Selected Category
  const filteredAssets = accountAssets.filter(asset => {
    if (!currentCategory?.assetTypeFilter) return true
    return currentCategory.assetTypeFilter.includes(asset.type?.toLowerCase())
  })

  // Active Issue Type Object
  const currentIssueType = currentCategory?.issueTypes.find(i => i.id === selectedIssueTypeId)

  // Active Location Object
  const currentLocation = accountLocations.find(l => l.id === selectedLocationId)

  // Active Asset Object
  const currentAsset = accountAssets.find(a => a.id === selectedAssetId)
  const resolvedAssetName = currentAsset
    ? `${currentAsset.name} (${currentAsset.type})`
    : manualAssetName.trim() || ''

  // ==========================
  // Handlers
  // ==========================

  const changeStage = (nextStage) => {
    setStage(nextStage)
    if (onStageChange) {
      onStageChange(nextStage)
    }
  }

  const handleCategoryChange = (catId) => {
    setSelectedCategoryId(catId)
    setSelectedAssetId('')
    setManualAssetName('')
    setSelectedIssueTypeId('')
    setAnswers({})
    setError('')
  }

  const handleIssueTypeChange = (issueId) => {
    setSelectedIssueTypeId(issueId)
    setAnswers({})
    setError('')
  }

  const handleAnswerChange = (questionId, value) => {
    setAnswers(prev => ({
      ...prev,
      [questionId]: value
    }))
  }

  const handleContinue = () => {
    setError('')

    if (!selectedCategoryId) {
      setError('Please select a problem category.')
      return
    }

    if (currentCategory?.issueTypes?.length > 0 && !selectedIssueTypeId) {
      setError('Please select the specific issue type.')
      return
    }

    // Validate required questions
    if (currentIssueType?.questions) {
      for (const q of currentIssueType.questions) {
        if (q.required && (!answers[q.id] || !answers[q.id].trim())) {
          setError(`Please answer required question: "${q.label}"`)
          return
        }
      }
    }

    if (!description.trim()) {
      setError('Please provide a brief description of what is happening.')
      return
    }

    changeStage('review')
  }

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
      setError('Failed to fetch ticket number proposal.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleSubmit = async () => {
    setIsLoading(true)
    setError('')

    const structuredPayload = {
      subcategory: currentIssueType?.label || null,
      issueType: currentIssueType?.label || null,
      locationId: selectedLocationId || null,
      locationName: currentLocation?.name || null,
      assetId: selectedAssetId || null,
      assetName: resolvedAssetName || null,
      answers: answers || {},
    }

    try {
      const categoryLabel = currentCategory?.label || selectedCategoryId
      const ticketNum = await createTicket(
        selectedService,
        customer,
        auth.currentUser,
        categoryLabel,
        description,
        structuredPayload
      )
      
      // Trigger backend email notification
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
        console.error('Failed to trigger email notification:', emailErr)
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

  const handleReset = () => {
    setSelectedCategoryId('')
    setSelectedAssetId('')
    setManualAssetName('')
    setSelectedIssueTypeId('')
    setAnswers({})
    setDescription('')
    setError('')
    setProposedTicketNumber('')
    setFinalTicketNumber('')
    changeStage('details')
    onBack()
  }

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
  // Details Stage Render
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
            <p className="ticket-greeting">Well, alright!</p>
            <p className="ticket-question">
              {currentCategory?.prompt || 'What seems to be the trouble we can help you with today?'}
            </p>
          </div>
        </div>

        <div className="ticket-form">
          <div className="ticket-form-header">
            <span className="service-star">✦</span>
            <span className="ticket-form-title">{serviceTree.title}</span>
            <span className="service-star">✦</span>
          </div>

          {/* 1. Category Selection */}
          <label className="ticket-field-label" htmlFor="ticket-category">
            WHAT SEEMS TO BE THE TROUBLE?
          </label>
          <select
            id="ticket-category"
            className="ticket-select"
            value={selectedCategoryId}
            onChange={(e) => handleCategoryChange(e.target.value)}
          >
            <option value="" disabled>
              Select a category
            </option>
            {serviceTree.categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.label}
              </option>
            ))}
          </select>

          {/* 2. Asset Selector (if category supports assets or assets exist) */}
          {selectedCategoryId && currentCategory?.requireAsset && (
            <div style={{ marginTop: '16px' }}>
              <label className="ticket-field-label" htmlFor="ticket-asset">
                {currentCategory.assetLabel || 'WHICH DEVICE OR ASSET?'}
              </label>
              {filteredAssets.length > 0 ? (
                <select
                  id="ticket-asset"
                  className="ticket-select"
                  value={selectedAssetId}
                  onChange={(e) => setSelectedAssetId(e.target.value)}
                >
                  <option value="">Select an authorized asset (optional)</option>
                  {filteredAssets.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.name} {asset.hostname ? `(${asset.hostname})` : ''} {asset.type ? `- ${asset.type.toUpperCase()}` : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  className="ticket-select"
                  placeholder="Enter computer/device name (optional)"
                  value={manualAssetName}
                  onChange={(e) => setManualAssetName(e.target.value)}
                />
              )}
            </div>
          )}

          {/* 3. Location Selector (if customer has multiple locations) */}
          {selectedCategoryId && accountLocations.length > 1 && (
            <div style={{ marginTop: '16px' }}>
              <label className="ticket-field-label" htmlFor="ticket-location">
                WHICH LOCATION?
              </label>
              <select
                id="ticket-location"
                className="ticket-select"
                value={selectedLocationId}
                onChange={(e) => setSelectedLocationId(e.target.value)}
              >
                <option value="">Select location (optional)</option>
                {accountLocations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* 4. Issue Type / Subcategory Selection */}
          {selectedCategoryId && currentCategory?.issueTypes?.length > 0 && (
            <div style={{ marginTop: '16px' }}>
              <label className="ticket-field-label" htmlFor="ticket-issue-type">
                WHAT SPECIFICALLY IS WRONG?
              </label>
              <select
                id="ticket-issue-type"
                className="ticket-select"
                value={selectedIssueTypeId}
                onChange={(e) => handleIssueTypeChange(e.target.value)}
              >
                <option value="" disabled>
                  Select specific issue
                </option>
                {currentCategory.issueTypes.map((issue) => (
                  <option key={issue.id} value={issue.id}>
                    {issue.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* 5. Conditional Follow-up Questions */}
          {currentIssueType?.questions?.map((q) => (
            <div key={q.id} style={{ marginTop: '16px' }}>
              <label className="ticket-field-label" htmlFor={`question-${q.id}`}>
                {q.label.toUpperCase()} {q.required ? '*' : ''}
              </label>
              {q.type === 'select' ? (
                <select
                  id={`question-${q.id}`}
                  className="ticket-select"
                  value={answers[q.id] || ''}
                  onChange={(e) => handleAnswerChange(q.id, e.target.value)}
                >
                  <option value="">Select answer</option>
                  {q.options.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  id={`question-${q.id}`}
                  className="ticket-select"
                  placeholder={q.placeholder || ''}
                  value={answers[q.id] || ''}
                  onChange={(e) => handleAnswerChange(q.id, e.target.value)}
                />
              )}
            </div>
          ))}

          {/* 6. Description Textarea */}
          <div style={{ marginTop: '16px' }}>
            <label className="ticket-field-label" htmlFor="ticket-description">
              ADDITIONAL DETAILS / DESCRIPTION *
            </label>
            <textarea
              id="ticket-description"
              className="ticket-textarea"
              placeholder="Describe what happened or any additional context..."
              rows="4"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {error && <p className="ticket-error">{error}</p>}

          <div className="ticket-actions">
            <button type="button" className="ticket-back-button" onClick={handleBack}>
              ← BACK
            </button>
            <button type="button" className="ticket-next-button" onClick={handleContinue}>
              CONTINUE →
            </button>
          </div>
        </div>
      </section>
    )
  }

  // ==========================
  // Review / Double-Check Stage
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
            <p className="ticket-greeting">Just one more look!</p>
            <p className="ticket-question">
              Let&apos;s make sure everything looks shipshape before we send it along.
            </p>
          </div>
        </div>

        <div className="ticket-form">
          <div className="ticket-form-header">
            <span className="service-star">✦</span>
            <span className="ticket-form-title">DOUBLE CHECK</span>
            <span className="service-star">✦</span>
          </div>

          <div className="ticket-review-field">
            <span className="ticket-field-label">SERVICE</span>
            <strong>{serviceTree.title}</strong>
          </div>

          <div className="ticket-review-field">
            <span className="ticket-field-label">CATEGORY</span>
            <strong>{currentCategory?.label || selectedCategoryId}</strong>
          </div>

          {currentIssueType && (
            <div className="ticket-review-field">
              <span className="ticket-field-label">SPECIFIC ISSUE</span>
              <strong>{currentIssueType.label}</strong>
            </div>
          )}

          {resolvedAssetName && (
            <div className="ticket-review-field">
              <span className="ticket-field-label">AFFECTED ASSET / DEVICE</span>
              <strong>{resolvedAssetName}</strong>
            </div>
          )}

          {currentLocation && (
            <div className="ticket-review-field">
              <span className="ticket-field-label">LOCATION</span>
              <strong>{currentLocation.name}</strong>
            </div>
          )}

          {/* Render Answer Summary */}
          {Object.keys(answers).length > 0 && (
            <div className="ticket-review-field">
              <span className="ticket-field-label">DIAGNOSTIC ANSWERS</span>
              <div style={{ marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {Object.entries(answers).map(([qKey, val]) => {
                  const qObj = currentIssueType?.questions?.find(q => q.id === qKey)
                  const label = qObj?.label || qKey
                  return (
                    <p key={qKey} style={{ margin: 0, fontSize: '0.85rem' }}>
                      <strong>{label}:</strong> {val}
                    </p>
                  )
                })}
              </div>
            </div>
          )}

          <div className="ticket-review-field">
            <span className="ticket-field-label">DETAILS</span>
            <p className="ticket-review-description">{description}</p>
          </div>

          {error && <p className="ticket-error">{error}</p>}

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
              onClick={handleReviewContinue}
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
  // Success Stage
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
            <p className="ticket-greeting">All set!</p>
            <p className="ticket-question">
              Your ticket has been submitted successfully. We&apos;ve got our best people on it and will get things rolling right away!
            </p>
          </div>
        </div>

        <div className="ticket-form">
          <div className="ticket-form-header">
            <span className="service-star">✦</span>
            <span className="ticket-form-title">SUBMITTED TICKET</span>
            <span className="service-star">✦</span>
          </div>

          <div className="ticket-review-field">
            <span className="ticket-field-label">TICKET NUMBER</span>
            <strong>#{finalTicketNumber}</strong>
          </div>

          <div className="ticket-review-field">
            <span className="ticket-field-label">SERVICE</span>
            <strong>{serviceTree.title}</strong>
          </div>

          <div className="ticket-review-field">
            <span className="ticket-field-label">CATEGORY</span>
            <strong>{currentCategory?.label || selectedCategoryId}</strong>
          </div>

          {resolvedAssetName && (
            <div className="ticket-review-field">
              <span className="ticket-field-label">ASSET</span>
              <strong>{resolvedAssetName}</strong>
            </div>
          )}

          <div className="ticket-review-field">
            <span className="ticket-field-label">DETAILS</span>
            <p className="ticket-review-description">{description}</p>
          </div>

          <div className="ticket-actions" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="ticket-next-button" onClick={handleReset}>
              RETURN TO SERVICES
            </button>
          </div>
        </div>
      </section>
    )
  }

  // ==========================
  // Final Submission Stage
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
          <p className="ticket-greeting">Here we go!</p>
          <p className="ticket-question">
            Here&apos;s your ticket! Just give it one last look, then hit submit and we&apos;ll get things rolling.
          </p>
        </div>
      </div>

      <div className="ticket-form">
        <div className="ticket-form-header">
          <span className="service-star">✦</span>
          <span className="ticket-form-title">TICKET: #{proposedTicketNumber}</span>
          <span className="service-star">✦</span>
        </div>

        <div className="ticket-review-field">
          <span className="ticket-field-label">CATEGORY</span>
          <strong>{currentCategory?.label || selectedCategoryId}</strong>
        </div>

        {currentIssueType && (
          <div className="ticket-review-field">
            <span className="ticket-field-label">ISSUE</span>
            <strong>{currentIssueType.label}</strong>
          </div>
        )}

        {resolvedAssetName && (
          <div className="ticket-review-field">
            <span className="ticket-field-label">ASSET</span>
            <strong>{resolvedAssetName}</strong>
          </div>
        )}

        <div className="ticket-review-field">
          <span className="ticket-field-label">DETAILS</span>
          <p className="ticket-review-description">{description}</p>
        </div>

        {error && <p className="ticket-error">{error}</p>}

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