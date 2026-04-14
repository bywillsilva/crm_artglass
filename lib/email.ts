type SendEmailParams = {
  to: string
  subject: string
  html: string
  text?: string
}

function getResendConfig() {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM

  if (!apiKey || !from) {
    throw new Error('Configuracao de e-mail ausente. Defina RESEND_API_KEY e EMAIL_FROM.')
  }

  return { apiKey, from }
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
