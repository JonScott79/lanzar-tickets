/*
    questionTrees.js

    LANZAR Support Tickets — Configuration-Driven Question & Branch Engine

    Responsibilities
    - Define service categories and issue subcategories
    - Configure conditional follow-up questions based on selected issue types
    - Define asset type filtering rules per category
*/

export const serviceCategoryTrees = {
  it: {
    title: 'IT SUPPORT',
    categories: [
      {
        id: 'computer',
        label: 'Computer or workstation',
        prompt: 'What seems to be happening with the computer?',
        requireAsset: true,
        assetTypeFilter: ['workstation', 'server', 'pc', 'laptop'],
        assetLabel: 'WHICH COMPUTER?',
        issueTypes: [
          {
            id: 'won_t_log_in',
            label: "Won't log in / Password rejected",
            questions: [
              {
                id: 'loginScope',
                label: 'Is this affecting one user or multiple users?',
                type: 'select',
                options: ['One user', 'Multiple users', 'Entire office'],
                required: true,
              },
              {
                id: 'errorMessage',
                label: 'Is there an error message on screen?',
                type: 'text',
                placeholder: 'e.g. Incorrect password or Account is locked',
              },
            ],
          },
          {
            id: 'slow',
            label: 'Computer is running slow',
            questions: [
              {
                id: 'slowScope',
                label: 'Is the entire computer slow or only one program?',
                type: 'select',
                options: ['Entire computer', 'Specific application / program'],
                required: true,
              },
              {
                id: 'whenStarted',
                label: 'When did the slowness begin?',
                type: 'text',
                placeholder: 'e.g. This morning after reboot',
              },
              {
                id: 'intermittent',
                label: 'Is it constant or intermittent?',
                type: 'select',
                options: ['Constant (all the time)', 'Intermittent (comes and goes)'],
              },
            ],
          },
          {
            id: 'won_t_start',
            label: "Won't start / No power",
            questions: [
              {
                id: 'powerLight',
                label: 'Are any power lights or fans turning on?',
                type: 'select',
                options: ['No lights or sound', 'Lights on but screen is black', 'Beeping sound on startup'],
                required: true,
              },
            ],
          },
          {
            id: 'frozen',
            label: 'Frozen / Unresponsive screen',
            questions: [
              {
                id: 'mouseMove',
                label: 'Can you move the mouse cursor?',
                type: 'select',
                options: ['No, cursor is completely frozen', 'Yes, cursor moves but clicks do nothing'],
              },
            ],
          },
          {
            id: 'error_message',
            label: 'Displaying an error message',
            questions: [
              {
                id: 'errorText',
                label: 'What does the error message say?',
                type: 'text',
                placeholder: 'Type the exact error text if possible...',
                required: true,
              },
            ],
          },
          {
            id: 'network_conn',
            label: 'Network / Internet connection drop on this computer',
            questions: [
              {
                id: 'otherDevicesAffected',
                label: 'Are other computers nearby able to connect?',
                type: 'select',
                options: ['Yes, other devices work fine', 'No, multiple devices lost connection', 'Unsure'],
              },
            ],
          },
          {
            id: 'other',
            label: 'Other computer issue',
            questions: [],
          },
        ],
      },

      {
        id: 'printer',
        label: 'Printer or peripheral',
        prompt: 'What seems to be the problem with the printer or device?',
        requireAsset: true,
        assetTypeFilter: ['printer', 'peripheral', 'scanner'],
        assetLabel: 'WHICH PRINTER OR PERIPHERAL?',
        issueTypes: [
          {
            id: 'wont_print',
            label: "Won't print",
            questions: [
              {
                id: 'queueStatus',
                label: 'Does the document remain stuck in the print queue?',
                type: 'select',
                options: ['Yes, stuck in queue', 'No, queue clears but nothing prints', 'Unsure'],
              },
              {
                id: 'printerLight',
                label: 'Does the printer display an error light or screen code?',
                type: 'text',
                placeholder: 'e.g. Red light blinking, Paper Jam message',
              },
              {
                id: 'affectingOthers',
                label: 'Can anyone else print to this printer?',
                type: 'select',
                options: ['Yes, others can print', 'No, no one can print', 'Unsure'],
              },
            ],
          },
          {
            id: 'offline',
            label: 'Printer shows Offline',
            questions: [
              {
                id: 'powerStatus',
                label: 'Is the printer powered on with screen active?',
                type: 'select',
                options: ['Yes, powered on', 'No, powered off / dead', 'Unsure'],
                required: true,
              },
            ],
          },
          {
            id: 'paper_jam',
            label: 'Paper jam',
            questions: [
              {
                id: 'jamCleared',
                label: 'Have you attempted to clear jammed paper from trays/doors?',
                type: 'select',
                options: ['Yes, cleared visible paper but error remains', 'No, paper is visible inside unit'],
              },
            ],
          },
          {
            id: 'print_quality',
            label: 'Poor print quality (streaks, faded, smudges)',
            questions: [
              {
                id: 'qualityIssue',
                label: 'Describe the print quality issue:',
                type: 'text',
                placeholder: 'e.g. Black streaks across page, text is faded',
              },
            ],
          },
          {
            id: 'cannot_find',
            label: 'Computer cannot find printer',
            questions: [],
          },
          {
            id: 'other',
            label: 'Other printer issue',
            questions: [],
          },
        ],
      },

      {
        id: 'network',
        label: 'Network or internet',
        prompt: 'Tell us about the network or connectivity problem.',
        requireAsset: false,
        issueTypes: [
          {
            id: 'no_internet',
            label: 'No Internet access',
            questions: [
              {
                id: 'affectedScope',
                label: 'Who or what is affected?',
                type: 'select',
                options: ['Only one computer', 'Multiple computers', 'Entire office'],
                required: true,
              },
              {
                id: 'whenStarted',
                label: 'When did the Internet drop start?',
                type: 'text',
                placeholder: 'e.g. About 20 minutes ago',
              },
            ],
          },
          {
            id: 'slow_internet',
            label: 'Slow Internet connection',
            questions: [
              {
                id: 'affectedScope',
                label: 'Is the slowness affecting one device or the whole office?',
                type: 'select',
                options: ['One device', 'Multiple devices / Whole office'],
              },
            ],
          },
          {
            id: 'wifi_issue',
            label: 'Wi-Fi problem',
            questions: [
              {
                id: 'wifiName',
                label: 'Which Wi-Fi network name (SSID) are you connecting to?',
                type: 'text',
                placeholder: 'e.g. Office_Guest or Staff_5G',
              },
            ],
          },
          {
            id: 'file_share',
            label: 'Shared folder / Network drive unavailable',
            questions: [
              {
                id: 'sharePath',
                label: 'Which folder or drive letter (e.g. Z:\\ drive) is missing?',
                type: 'text',
                placeholder: 'e.g. \\\\server\\DTWIN or S:\\ Drive',
              },
            ],
          },
          {
            id: 'other',
            label: 'Other network problem',
            questions: [],
          },
        ],
      },

      {
        id: 'software',
        label: 'Software or application',
        prompt: 'Tell us about the application or software issue.',
        requireAsset: false,
        issueTypes: [
          {
            id: 'wont_open',
            label: "Program won't open",
            questions: [
              {
                id: 'appName',
                label: 'Which software program or application?',
                type: 'text',
                placeholder: 'e.g. Dentech, Outlook, Excel, Chrome',
                required: true,
              },
            ],
          },
          {
            id: 'crashes',
            label: 'Program crashes or closes unexpectedly',
            questions: [
              {
                id: 'appName',
                label: 'Which software program?',
                type: 'text',
                placeholder: 'e.g. Dentech, Microsoft Word',
                required: true,
              },
              {
                id: 'crashTrigger',
                label: 'Does it crash during a specific action?',
                type: 'text',
                placeholder: 'e.g. When printing a chart or opening patient file',
              },
            ],
          },
          {
            id: 'error_message',
            label: 'Application displays an error message',
            questions: [
              {
                id: 'appName',
                label: 'Which software program?',
                type: 'text',
                placeholder: 'e.g. Dentech, Practice Management',
                required: true,
              },
              {
                id: 'errorText',
                label: 'What is the error code or message?',
                type: 'text',
                placeholder: 'Type the error message details...',
              },
            ],
          },
          {
            id: 'other',
            label: 'Other software issue',
            questions: [],
          },
        ],
      },

      {
        id: 'email',
        label: 'Email support',
        prompt: 'Tell us about your email issue.',
        requireAsset: false,
        issueTypes: [
          {
            id: 'cant_send',
            label: "Can't send emails",
            questions: [
              {
                id: 'affectedAccount',
                label: 'Which email address is having issues?',
                type: 'text',
                placeholder: 'e.g. staff@bostonsmile.com',
                required: true,
              },
              {
                id: 'errorMessage',
                label: 'Do you get a bounce-back message or error code?',
                type: 'text',
                placeholder: 'e.g. 550 Relay Denied or Undeliverable',
              },
            ],
          },
          {
            id: 'cant_receive',
            label: "Can't receive emails",
            questions: [
              {
                id: 'affectedAccount',
                label: 'Which email address is affected?',
                type: 'text',
                placeholder: 'e.g. boston@bostonsmile.com',
                required: true,
              },
            ],
          },
          {
            id: 'spam_phishing',
            label: 'Spam or suspicious email report',
            questions: [
              {
                id: 'senderEmail',
                label: 'Who is the sender email address of the suspicious email?',
                type: 'text',
                placeholder: 'e.g. unknown-sender@suspicious-domain.com',
              },
            ],
          },
          {
            id: 'other',
            label: 'Other email issue',
            questions: [],
          },
        ],
      },

      {
        id: 'account_login',
        label: 'Account or login access',
        prompt: 'Tell us what account or system access is needed.',
        requireAsset: false,
        issueTypes: [
          {
            id: 'password_rejected',
            label: 'Password rejected or forgot password',
            questions: [
              {
                id: 'targetSystem',
                label: 'What system are you trying to sign into?',
                type: 'select',
                options: ['Computer / Windows Login', 'Email', 'Practice Management Software', 'Wi-Fi', 'Other'],
                required: true,
              },
              {
                id: 'targetUsername',
                label: 'What is your username or account name?',
                type: 'text',
                placeholder: 'e.g. jscott or boston@bostonsmile.com',
                required: true,
              },
            ],
          },
          {
            id: 'account_locked',
            label: 'Account locked out',
            questions: [
              {
                id: 'targetSystem',
                label: 'Which system locked your account?',
                type: 'select',
                options: ['Computer / Windows Domain', 'Email', 'Practice Software', 'Other'],
                required: true,
              },
            ],
          },
          {
            id: 'other',
            label: 'Other account access issue',
            questions: [],
          },
        ],
      },

      {
        id: 'security',
        label: 'Security or suspicious activity',
        prompt: 'Security reports are handled with priority. Please describe what you observed.',
        requireAsset: false,
        issueTypes: [
          {
            id: 'suspicious_email',
            label: 'Suspicious email / Phishing attempt',
            questions: [
              {
                id: 'clickedLink',
                label: 'Did anyone click links or download attachments in the message?',
                type: 'select',
                options: ['No, only viewed the message', 'Yes, clicked a link', 'Yes, opened an attachment', 'Unsure'],
                required: true,
              },
            ],
          },
          {
            id: 'popup_warning',
            label: 'Suspicious pop-up or virus alert',
            questions: [
              {
                id: 'popupText',
                label: 'What does the pop-up or warning say?',
                type: 'text',
                placeholder: 'e.g. Computer Infected Call This Number',
              },
            ],
          },
          {
            id: 'lost_stolen_device',
            label: 'Lost or stolen device',
            questions: [
              {
                id: 'deviceInfo',
                label: 'What device was lost/stolen (e.g. laptop, phone, tablet)?',
                type: 'text',
                placeholder: 'e.g. Staff Dell Laptop',
                required: true,
              },
            ],
          },
          {
            id: 'other',
            label: 'Other security event',
            questions: [],
          },
        ],
      },

      {
        id: 'server',
        label: 'Server or infrastructure',
        prompt: 'Server and infrastructure ticket.',
        requireAsset: true,
        assetTypeFilter: ['server'],
        assetLabel: 'WHICH SERVER?',
        issueTypes: [
          {
            id: 'offline',
            label: 'Server unresponsive or offline',
            questions: [
              {
                id: 'serverImpact',
                label: 'What services or applications are down?',
                type: 'text',
                placeholder: 'e.g. Dentech practice database, shared files, domain login',
                required: true,
              },
            ],
          },
          {
            id: 'slow_server',
            label: 'Server performance is slow',
            questions: [],
          },
          {
            id: 'other',
            label: 'Other server issue',
            questions: [],
          },
        ],
      },

      {
        id: 'other',
        label: 'Other IT issue',
        prompt: 'Please describe the trouble you are experiencing.',
        requireAsset: false,
        issueTypes: [
          {
            id: 'general_other',
            label: 'General issue',
            questions: [
              {
                id: 'whoAffected',
                label: 'Who or what is affected?',
                type: 'text',
                placeholder: 'e.g. Staff at front desk',
              },
            ],
          },
        ],
      },
    ],
  },

  web: {
    title: 'WEB SUPPORT',
    categories: [
      {
        id: 'website_issue',
        label: 'Website issue / bug',
        prompt: 'Tell us about the issue with your website.',
        issueTypes: [
          { id: 'page_broken', label: 'Page error or broken link', questions: [] },
          { id: 'contact_form', label: 'Contact form not sending messages', questions: [] },
          { id: 'other', label: 'Other website issue', questions: [] },
        ],
      },
      {
        id: 'website_change',
        label: 'Website text or photo update',
        prompt: 'Describe the update or change you would like made to the website.',
        issueTypes: [{ id: 'update', label: 'Content update request', questions: [] }],
      },
      {
        id: 'domain_dns',
        label: 'Domain or DNS',
        prompt: 'Tell us about your domain or DNS inquiry.',
        issueTypes: [{ id: 'domain', label: 'Domain renewal or DNS record change', questions: [] }],
      },
      {
        id: 'other',
        label: 'Other web request',
        prompt: 'Describe what you need help with.',
        issueTypes: [{ id: 'other', label: 'General web request', questions: [] }],
      },
    ],
  },

  threadline: {
    title: 'THREADLINE SUPPORT',
    categories: [
      {
        id: 'import_upload',
        label: 'Import or data upload',
        prompt: 'Describe what data you are attempting to import.',
        issueTypes: [{ id: 'import', label: 'Data import issue', questions: [] }],
      },
      {
        id: 'parsing',
        label: 'Conversation parsing',
        prompt: 'Tell us about the parsing or timeline question.',
        issueTypes: [{ id: 'parsing', label: 'Parsing issue', questions: [] }],
      },
      {
        id: 'bug_error',
        label: 'Bug or application error',
        prompt: 'Describe the bug or error encountered in Threadline.',
        issueTypes: [{ id: 'bug', label: 'App error', questions: [] }],
      },
      {
        id: 'other',
        label: 'Other Threadline inquiry',
        prompt: 'Tell us what you are trying to accomplish.',
        issueTypes: [{ id: 'other', label: 'General Threadline question', questions: [] }],
      },
    ],
  },
}
