type SendEmailParams = {
  to: string
  subject: string
  html: string
  text?: string
}

type EmailTemplateParams = {
  appName?: string | null
  title: string
  greeting?: string | null
  intro: string
  outro?: string | null
  footer?: string | null
  highlightLabel?: string | null
  highlightValue?: string | null
}

function getResendConfig() {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM

  if (!apiKey || !from) {
    throw new Error('Configuracao de e-mail ausente. Defina RESEND_API_KEY e EMAIL_FROM.')
  }

  return { apiKey, from }
}

function getAppName(appName?: string | null) {
  return appName || process.env.APP_NAME || 'CRM'
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function normalizeMultilineHtml(value: string) {
  return escapeHtml(value).replace(/\n/g, '<br />')
}

export function buildEmailTemplate({
  appName,
  title,
  greeting,
  intro,
  outro,
  footer,
  highlightLabel,
  highlightValue,
}: EmailTemplateParams) {
  const resolvedAppName = getAppName(appName)
  const resolvedFooter =
    footer || 'Esta e uma mensagem automatica. Se voce nao reconhece esta acao, ignore este e-mail.'

  const html = `
    <div style="margin:0; padding:32px 16px; background:#f4f7fb; font-family:Arial, sans-serif; color:#111827;">
      <div style="max-width:560px; margin:0 auto; background:#ffffff; border:1px solid #e5e7eb; border-radius:18px; overflow:hidden; box-shadow:0 10px 30px rgba(15,23,42,0.08);">
        <div style="padding:24px 28px; background:linear-gradient(135deg, #0f172a 0%, #1d4ed8 100%); color:#ffffff;">
          <div style="font-size:12px; letter-spacing:0.14em; text-transform:uppercase; opacity:0.8;">${escapeHtml(resolvedAppName)}</div>
          <h1 style="margin:10px 0 0; font-size:24px; line-height:1.3;">${escapeHtml(title)}</h1>
        </div>
        <div style="padding:28px;">
          ${greeting ? `<p style="margin:0 0 16px; font-size:15px;">${normalizeMultilineHtml(greeting)}</p>` : ''}
          <p style="margin:0 0 16px; font-size:15px; line-height:1.7;">${normalizeMultilineHtml(intro)}</p>
          ${
            highlightValue
              ? `
                <div style="margin:24px 0; border:1px solid #dbeafe; background:#eff6ff; border-radius:14px; padding:18px 20px; text-align:center;">
                  ${highlightLabel ? `<div style="font-size:12px; letter-spacing:0.08em; text-transform:uppercase; color:#1d4ed8; margin-bottom:8px;">${escapeHtml(highlightLabel)}</div>` : ''}
                  <div style="font-size:30px; font-weight:700; letter-spacing:0.24em; color:#0f172a;">${escapeHtml(highlightValue)}</div>
                </div>
              `
              : ''
          }
          ${outro ? `<p style="margin:0 0 16px; font-size:15px; line-height:1.7;">${normalizeMultilineHtml(outro)}</p>` : ''}
          <div style="margin-top:24px; padding-top:18px; border-top:1px solid #e5e7eb; font-size:13px; line-height:1.7; color:#6b7280;">
            ${normalizeMultilineHtml(resolvedFooter)}
          </div>
        </div>
      </div>
    </div>
  `

  const textParts = [
    resolvedAppName,
    title,
    greeting || null,
    intro,
    highlightValue ? `${highlightLabel ? `${highlightLabel}: ` : ''}${highlightValue}` : null,
    outro || null,
    resolvedFooter,
  ].filter(Boolean)

  return {
    html,
    text: textParts.join('\n\n'),
  }
}

export async function sendEmail({ to, subject, html, text }: SendEmailParams) {
  const { apiKey, from } = getResendConfig()

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      html,
      text,
    }),
  })

  if (!response.ok) {
    const data = await response.text()
    throw new Error(`Falha ao enviar e-mail: ${data}`)
  }
}
